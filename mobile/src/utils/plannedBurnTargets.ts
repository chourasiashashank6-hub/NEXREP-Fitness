import type { WorkoutPlanCurrent } from "../types/planner";
import {
  generatePreworkoutPlan,
  type PreworkoutProfile,
} from "./generatePreworkoutPlan";
import { sanitizePlannerDayDetail, sanitizeWorkoutPlanCurrent } from "./sanitizePlannerDay";
import { calcExerciseEstimateKcal } from "./sessionCalories";
import { isWorkoutRestDay } from "./workoutRestDay";

export type PlannedBurnActivityKind = "cardioWarmup" | "workoutSession";

export type PlannedBurnActivity = {
  id: string;
  kind: PlannedBurnActivityKind;
  /** Workout split name when kind is workoutSession. */
  sessionLabel: string;
  kcal: number;
};

export type PlannedBurnTargets = {
  minBurnTarget: number;
  bestResultsBurnTarget: number;
  activities: PlannedBurnActivity[];
};

export function toPreworkoutProfile(
  onboarding:
    | {
        goal?: { type?: string; pace?: string; difficulty?: string };
        personal?: { weight_kg?: number; weight_lb?: number; unit_system?: string };
      }
    | null
    | undefined,
  weightKgOverride?: number,
): PreworkoutProfile | null {
  if (!onboarding) return null;
  const goal = onboarding.goal ?? {};
  const personal = onboarding.personal ?? {};
  const fromPersonal =
    personal.unit_system === "metric"
      ? Number(personal.weight_kg)
      : Number(personal.weight_lb) / 2.20462;
  const weightKg =
    weightKgOverride != null && Number.isFinite(weightKgOverride) && weightKgOverride > 0
      ? weightKgOverride
      : fromPersonal;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  return {
    primaryGoal: String(goal.type ?? "muscle_gain"),
    goalPace: String(goal.pace ?? "moderate"),
    difficulty: String(goal.difficulty ?? "intermediate"),
    weightKg,
  };
}

export function computePlannedBurnActivities(opts: {
  restDayActive: boolean;
  hasWorkoutPlannerAccess: boolean;
  todayWorkoutPlan: WorkoutPlanCurrent | null | undefined;
  preworkoutProfile: PreworkoutProfile | null;
  preWorkoutEnabled?: boolean;
  weightKg: number;
}): PlannedBurnActivity[] {
  if (opts.restDayActive || !opts.hasWorkoutPlannerAccess) return [];

  const sanitizedPlan = sanitizeWorkoutPlanCurrent(opts.todayWorkoutPlan);
  const today = sanitizedPlan?.today ?? null;
  const day = today ? sanitizePlannerDayDetail(today) : null;
  if (!day || isWorkoutRestDay(day)) return [];

  const activities: PlannedBurnActivity[] = [];
  const weightKg = Number.isFinite(opts.weightKg) && opts.weightKg > 0 ? opts.weightKg : 70;

  if (opts.preWorkoutEnabled !== false && opts.preworkoutProfile) {
    const preworkout = generatePreworkoutPlan(opts.preworkoutProfile, day.focus_muscles ?? []);
    if (preworkout.kind === "cardio" && preworkout.estimatedKcal > 0) {
      activities.push({
        id: "cardio-warmup",
        kind: "cardioWarmup",
        sessionLabel: "",
        kcal: preworkout.estimatedKcal,
      });
    }
  }

  const exercises = day.exercises ?? [];
  if (exercises.length > 0) {
    const sessionKcal = exercises.reduce(
      (sum, ex) => sum + calcExerciseEstimateKcal(ex.name, Number(ex.sets) || 0, weightKg),
      0,
    );
    if (sessionKcal > 0) {
      activities.push({
        id: "workout-session",
        kind: "workoutSession",
        sessionLabel: String(day.split_name || "").trim() || "Workout",
        kcal: sessionKcal,
      });
    }
  }

  return activities;
}

export function computePlannedBurnTargets(opts: {
  minBurnTarget: number;
  activities: PlannedBurnActivity[];
}): PlannedBurnTargets {
  const minBurnTarget = Math.max(0, Math.round(Number(opts.minBurnTarget) || 0));
  const activitySum = opts.activities.reduce(
    (sum, activity) => sum + Math.max(0, Math.round(Number(activity.kcal) || 0)),
    0,
  );
  const bestResultsBurnTarget = activitySum > 0 ? activitySum : minBurnTarget;
  return {
    minBurnTarget,
    bestResultsBurnTarget,
    activities: opts.activities,
  };
}

export function activityLabelForCaption(
  activity: PlannedBurnActivity,
  labels: { cardioWarmup: string; workoutSession: (name: string) => string },
): string {
  if (activity.kind === "cardioWarmup") return labels.cardioWarmup;
  return labels.workoutSession(activity.sessionLabel);
}
