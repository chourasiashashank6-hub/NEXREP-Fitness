/**
 * Wraps the onboarding save flow with a stale-plan confirmation step.
 *
 * Usage:
 *   const { saveWithCheck, modalProps } = useOnboardingStalePlanCheck();
 *   // Render <StalePlanModal {...modalProps} /> somewhere in the component tree
 *   // Call saveWithCheck() instead of saveAndExit()
 */

import { useRef, useState } from "react";
import { fetchOnboardingMe } from "../api/onboarding";
import { generateWeekPlan } from "../api/mealPlanner";
import { generateWorkoutPlan, regenerateWorkoutMonthPlan } from "../api/workoutPlanner";
import { fetchWorkoutPlanCurrent } from "../api/workoutPlanner";
import { detectAffectedPlanners } from "../utils/stalePlanDiff";
import { useOnboardingSaveAndExit } from "./useOnboardingSaveAndExit";
import { useOnboardingContext } from "./OnboardingContext";
import type { OnboardingData } from "../types/onboarding";
import i18n from "../i18n";
import { notifyUser } from "../utils/notify";

type PlannerKey = "meal" | "workout";

const FIELD_LABELS_I18N: Record<string, string> = {
  age:                  "stalePlan.fields.age",
  biological_sex:       "stalePlan.fields.biological_sex",
  height_cm:            "stalePlan.fields.height_cm",
  current_weight_kg:    "stalePlan.fields.current_weight_kg",
  primary_goal:         "stalePlan.fields.primary_goal",
  goal_pace:            "stalePlan.fields.goal_pace",
  target_weight_kg:     "stalePlan.fields.target_weight_kg",
  daily_activity_level: "stalePlan.fields.daily_activity_level",
  diet_type:            "stalePlan.fields.diet_type",
  food_allergies:       "stalePlan.fields.food_allergies",
  meals_per_day:        "stalePlan.fields.meals_per_day",
  difficulty:           "stalePlan.fields.difficulty",
  body_type:            "stalePlan.fields.body_type_current",
  workouts_per_week:    "stalePlan.fields.workouts_per_week",
  workout_types:        "stalePlan.fields.workout_types",
  muscle_focus:         "stalePlan.fields.muscle_focus",
};

export type StalePlanModalProps = {
  visible: boolean;
  affectedPlanners: PlannerKey[];
  changedFieldLabels: string[];
  regenerating: boolean;
  onRegenerateNow: () => void;
  onDoItLater: () => void;
};

export function useOnboardingStalePlanCheck() {
  const { data } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();

  const [modalVisible, setModalVisible] = useState(false);
  const [affectedPlanners, setAffectedPlanners] = useState<PlannerKey[]>([]);
  const [changedFieldLabels, setChangedFieldLabels] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);

  // Resolve after the modal decision
  const resolveRef = useRef<((action: "regenerate" | "later") => void) | null>(null);

  const saveWithCheck = async () => {
    // Fetch current server-stored onboarding to diff against
    let prev: OnboardingData | null = null;
    try {
      const remote = await fetchOnboardingMe();
      prev = remote?.onboarding ?? null;
    } catch {
      /* No previous data — no diff needed, proceed normally */
    }

    if (prev) {
      const affected = detectAffectedPlanners(prev, data);
      if (affected.length > 0) {
        // Build field labels for display — we can't perfectly enumerate changed fields
        // client-side (the diff is field-key based), so show planner impact only.
        const fieldKeys = Object.keys(FIELD_LABELS_I18N).filter((k) => {
          // Check if the field matches an impacted planner
          const impact = getMealWorkoutImpact(k);
          const { meal, workout } = impact;
          return (meal && affected.includes("meal")) || (workout && affected.includes("workout"));
        });
        const labels = fieldKeys.map((k) => i18n.t(FIELD_LABELS_I18N[k] ?? k));

        setAffectedPlanners(affected);
        setChangedFieldLabels(labels);
        setModalVisible(true);

        const action = await new Promise<"regenerate" | "later">((resolve) => {
          resolveRef.current = resolve;
        });

        if (action === "regenerate") {
          // Save first, then regenerate affected planners
          await saveAndExit();
          setRegenerating(true);
          try {
            if (affected.includes("meal")) {
              // Use current date as local_date context
              const today = new Date();
              const weekStart = today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1);
              await generateWeekPlan("budget", weekStart > 0 ? weekStart : 1).catch(() => undefined);
            }
            if (affected.includes("workout")) {
              try {
                const existing = await fetchWorkoutPlanCurrent();
                if (existing?.plan_id) {
                  await regenerateWorkoutMonthPlan(existing.plan_id);
                } else {
                  await generateWorkoutPlan([]);
                }
              } catch {
                /* best effort */
              }
            }
            notifyUser(i18n.t("stalePlan.regenerated"), i18n.t("stalePlan.regenerated"));
          } catch {
            notifyUser(i18n.t("common.error"), i18n.t("stalePlan.regenerateFailed"));
          } finally {
            setRegenerating(false);
          }
          return;
        }
        // "later" — fall through to normal save
      }
    }

    await saveAndExit();
  };

  const handleRegenerateNow = () => {
    setModalVisible(false);
    resolveRef.current?.("regenerate");
  };

  const handleDoItLater = () => {
    setModalVisible(false);
    resolveRef.current?.("later");
  };

  const modalProps: StalePlanModalProps = {
    visible: modalVisible,
    affectedPlanners,
    changedFieldLabels,
    regenerating,
    onRegenerateNow: handleRegenerateNow,
    onDoItLater: handleDoItLater,
  };

  return { saveWithCheck, saving: saving || regenerating, modalProps };
}

function getMealWorkoutImpact(field: string): { meal: boolean; workout: boolean } {
  const map: Record<string, { meal: boolean; workout: boolean }> = {
    age:                  { meal: true,  workout: false },
    biological_sex:       { meal: true,  workout: false },
    height_cm:            { meal: true,  workout: false },
    current_weight_kg:    { meal: true,  workout: true  },
    primary_goal:         { meal: true,  workout: true  },
    goal_pace:            { meal: true,  workout: false },
    target_weight_kg:     { meal: true,  workout: false },
    daily_activity_level: { meal: true,  workout: false },
    diet_type:            { meal: true,  workout: false },
    food_allergies:       { meal: true,  workout: false },
    meals_per_day:        { meal: true,  workout: false },
    difficulty:           { meal: false, workout: true  },
    body_type:            { meal: false, workout: true  },
    workouts_per_week:    { meal: false, workout: true  },
    workout_types:        { meal: false, workout: true  },
    muscle_focus:         { meal: false, workout: true  },
  };
  return map[field] ?? { meal: false, workout: false };
}
