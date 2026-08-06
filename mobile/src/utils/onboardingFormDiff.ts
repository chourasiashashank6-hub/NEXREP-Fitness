import type { TFunction } from "i18next";
import type { OnboardingData } from "../types/onboarding";

export type OnboardingFormChange = {
  key: string;
  label: string;
  from: string;
  to: string;
};

function valEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a) === String(b);
}

function displayValue(value: unknown, t: TFunction): string {
  if (value == null || value === "") return t("onboarding.unsaved.empty");
  if (Array.isArray(value)) {
    if (value.length === 0) return t("onboarding.unsaved.empty");
    return value.map(String).join(", ");
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}

type FieldDef = {
  key: string;
  labelKey: string;
  read: (data: OnboardingData) => unknown;
};

const FIELDS: FieldDef[] = [
  { key: "name", labelKey: "onboarding.unsaved.fields.name", read: (d) => d.personal.name?.trim() || null },
  { key: "age", labelKey: "stalePlan.fields.age", read: (d) => d.personal.age },
  { key: "biological_sex", labelKey: "stalePlan.fields.biological_sex", read: (d) => d.personal.sex },
  {
    key: "unit_system",
    labelKey: "onboarding.unsaved.fields.unitSystem",
    read: (d) => d.personal.unit_system,
  },
  {
    key: "height",
    labelKey: "stalePlan.fields.height_cm",
    read: (d) =>
      d.personal.unit_system === "metric"
        ? (d.personal.height_cm != null ? `${d.personal.height_cm} cm` : null)
        : (d.personal.height_in != null ? `${d.personal.height_in} in` : null),
  },
  {
    key: "current_weight",
    labelKey: "stalePlan.fields.current_weight_kg",
    read: (d) =>
      d.personal.unit_system === "metric"
        ? (d.personal.weight_kg != null ? `${d.personal.weight_kg} kg` : null)
        : (d.personal.weight_lb != null ? `${d.personal.weight_lb} lb` : null),
  },
  { key: "primary_goal", labelKey: "stalePlan.fields.primary_goal", read: (d) => d.goal.type },
  { key: "goal_pace", labelKey: "stalePlan.fields.goal_pace", read: (d) => d.goal.pace },
  { key: "difficulty", labelKey: "stalePlan.fields.difficulty", read: (d) => d.goal.difficulty },
  {
    key: "target_weight",
    labelKey: "stalePlan.fields.target_weight_kg",
    read: (d) =>
      d.personal.unit_system === "metric"
        ? (d.goal.target_weight_kg != null ? `${d.goal.target_weight_kg} kg` : null)
        : (d.goal.target_weight_lb != null ? `${d.goal.target_weight_lb} lb` : null),
  },
  {
    key: "muscle_focus",
    labelKey: "stalePlan.fields.muscle_focus",
    read: (d) => d.goal.focus_muscles ?? (d.goal.focus_muscle ? [d.goal.focus_muscle] : []),
  },
  {
    key: "target_lifts",
    labelKey: "onboarding.unsaved.fields.targetLifts",
    read: (d) => (d.goal.target_lifts ?? []).map((l) => l.exercise_name).filter(Boolean),
  },
  {
    key: "daily_activity_level",
    labelKey: "stalePlan.fields.daily_activity_level",
    read: (d) => d.activity.level,
  },
  { key: "workouts_per_week", labelKey: "stalePlan.fields.workouts_per_week", read: (d) => d.activity.workouts_per_week },
  { key: "workout_types", labelKey: "stalePlan.fields.workout_types", read: (d) => d.activity.workout_types ?? [] },
  { key: "diet_type", labelKey: "stalePlan.fields.diet_type", read: (d) => d.dietary.diet_type },
  { key: "food_allergies", labelKey: "stalePlan.fields.food_allergies", read: (d) => d.dietary.allergies ?? [] },
  { key: "meals_per_day", labelKey: "stalePlan.fields.meals_per_day", read: (d) => d.dietary.meals_per_day },
  {
    key: "body_type",
    labelKey: "stalePlan.fields.body_type_current",
    read: (d) => d.body_type?.current_body_id || null,
  },
  {
    key: "goal_body_type",
    labelKey: "stalePlan.fields.body_type_goal",
    read: (d) => d.body_type?.goal_body_id || null,
  },
  {
    key: "weigh_in_reminder",
    labelKey: "onboarding.unsaved.fields.weighInReminder",
    read: (d) => d.app_setup.weigh_in_reminder_enabled,
  },
  {
    key: "water_goal",
    labelKey: "onboarding.unsaved.fields.waterGoal",
    read: (d) => d.app_setup.water_intake_goal_liters,
  },
];

/** List human-readable field changes between saved baseline and current form state. */
export function listOnboardingFormChanges(
  baseline: OnboardingData,
  current: OnboardingData,
  t: TFunction,
): OnboardingFormChange[] {
  const out: OnboardingFormChange[] = [];
  for (const field of FIELDS) {
    const prevVal = field.read(baseline);
    const nextVal = field.read(current);
    if (valEq(prevVal, nextVal)) continue;
    out.push({
      key: field.key,
      label: t(field.labelKey),
      from: displayValue(prevVal, t),
      to: displayValue(nextVal, t),
    });
  }
  return out;
}
