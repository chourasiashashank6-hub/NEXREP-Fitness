import type { WorkoutDayPlan, WorkoutExercise, WorkoutPlanCurrent } from "../types/planner";
import type { ReflowTaggedExercise } from "./reflowExerciseMeta";
import { REFLOW_MAX_EXERCISES_PER_DAY } from "./reflowMuscleCompat";

/** Typical generated plan size before Smart Reflow additions. */
export const PLANNER_BASE_EXERCISES_PER_DAY = 6;

function estimateDurationMin(exercises: WorkoutExercise[]): number {
  if (!exercises.length) return 0;
  return Math.max(1, exercises.reduce((sum, exercise) => sum + Math.max(1, Number(exercise.sets) || 3) * 3, 0));
}

export function plannerDayNeedsSanitization(day: WorkoutDayPlan): boolean {
  if (day.is_rest_day || day.locked || !day.exercises?.length) return false;
  if (day.exercises.length > REFLOW_MAX_EXERCISES_PER_DAY) return true;
  return day.exercises.some((exercise) => Boolean((exercise as ReflowTaggedExercise).reflow_source_day));
}

/** Strip Smart Reflow additions and trim overloaded days back to the base plan size. */
export function sanitizePlannerDayDetail(
  day: WorkoutDayPlan,
  baseExerciseCount = PLANNER_BASE_EXERCISES_PER_DAY,
): WorkoutDayPlan {
  if (day.is_rest_day || day.locked || !day.exercises?.length) return day;
  if (!plannerDayNeedsSanitization(day)) return day;

  const withoutReflow = day.exercises.filter(
    (exercise) => !(exercise as ReflowTaggedExercise).reflow_source_day,
  );
  const targetCount = Math.min(baseExerciseCount, REFLOW_MAX_EXERCISES_PER_DAY);
  const exercises =
    withoutReflow.length > targetCount ? withoutReflow.slice(0, targetCount) : withoutReflow;

  return {
    ...day,
    exercises,
    estimated_duration_min: estimateDurationMin(exercises),
  };
}

/** Sanitize today's embedded day on a current-plan payload (Home, Game Plan, sessions). */
export function sanitizeWorkoutPlanCurrent(plan: WorkoutPlanCurrent | null): WorkoutPlanCurrent | null {
  if (!plan?.today) return plan;
  const today = sanitizePlannerDayDetail(plan.today);
  if (today === plan.today) return plan;
  return { ...plan, today };
}
