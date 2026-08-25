import type { WorkoutDayPlan, WorkoutPlanCurrent } from "../types/planner";

/**
 * Same rest-day detection as Workout Log → Planner (R marker / REST DAY banner).
 * Keep this as the single source of truth — do not fork a second definition.
 */
export function isWorkoutRestDay(
  day: Pick<WorkoutDayPlan, "is_rest_day" | "split_name"> | null | undefined,
): boolean {
  if (!day) return true;
  return Boolean(day.is_rest_day);
}

/**
 * Home rest-day UI requires Elite access + a generated plan + today rest.
 * Any missing piece keeps the normal workout-day Home UI.
 */
export function isHomeRestDayActive(opts: {
  hasWorkoutPlannerAccess: boolean;
  plan: WorkoutPlanCurrent | null | undefined;
}): boolean {
  const hasGeneratedPlan = Boolean(opts.plan?.plan_id);
  const todayIsRestDay = hasGeneratedPlan && isWorkoutRestDay(opts.plan?.today ?? null);
  return Boolean(opts.hasWorkoutPlannerAccess && hasGeneratedPlan && todayIsRestDay);
}
