import type { WorkoutDayPlan, WorkoutExercise, WorkoutPlanCurrent } from "../types/planner";
import type { ReflowTaggedExercise } from "./reflowExerciseMeta";
import { isExerciseCompatibleWithDay, REFLOW_MAX_EXERCISES_PER_DAY } from "./reflowMuscleCompat";

/** Typical generated plan size before Smart Reflow additions. */
export const PLANNER_BASE_EXERCISES_PER_DAY = 6;

function estimateDurationMin(exercises: WorkoutExercise[]): number {
  if (!exercises.length) return 0;
  return Math.max(1, exercises.reduce((sum, exercise) => sum + Math.max(1, Number(exercise.sets) || 3) * 3, 0));
}

function exerciseNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function hasDuplicateExerciseNames(exercises: WorkoutExercise[]): boolean {
  const seen = new Set<string>();
  for (const exercise of exercises) {
    const key = exerciseNameKey(exercise.name);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function dedupeExercises(exercises: WorkoutExercise[]): WorkoutExercise[] {
  const seen = new Set<string>();
  const kept: WorkoutExercise[] = [];
  for (const exercise of exercises) {
    const key = exerciseNameKey(exercise.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(exercise);
  }
  return kept;
}

function hasIncompatibleReflowExercise(day: WorkoutDayPlan): boolean {
  return day.exercises.some((exercise) => {
    const sourceDay = (exercise as ReflowTaggedExercise).reflow_source_day;
    if (typeof sourceDay !== "number" || sourceDay <= 0) return false;
    return !isExerciseCompatibleWithDay(exercise, day);
  });
}

function trimExercisesToCap(exercises: WorkoutExercise[]): WorkoutExercise[] {
  const trimmed = [...exercises];
  while (trimmed.length > REFLOW_MAX_EXERCISES_PER_DAY) {
    const reflowIndex = trimmed.findIndex(
      (exercise) => typeof (exercise as ReflowTaggedExercise).reflow_source_day === "number",
    );
    if (reflowIndex >= 0) {
      trimmed.splice(reflowIndex, 1);
      continue;
    }
    trimmed.pop();
  }
  return trimmed;
}

export function plannerDayNeedsSanitization(day: WorkoutDayPlan): boolean {
  if (day.is_rest_day || day.locked || !day.exercises?.length) return false;
  if (day.exercises.length > REFLOW_MAX_EXERCISES_PER_DAY) return true;
  if (hasDuplicateExerciseNames(day.exercises)) return true;
  if (hasIncompatibleReflowExercise(day)) return true;
  const hasReflow = day.exercises.some((exercise) => Boolean((exercise as ReflowTaggedExercise).reflow_source_day));
  if (!hasReflow && day.exercises.length > PLANNER_BASE_EXERCISES_PER_DAY) return true;
  return false;
}

/** Repair invalid planner day states (cap, duplicates, incompatible reflow) — keep valid reflow writes. */
export function sanitizePlannerDayDetail(
  day: WorkoutDayPlan,
  baseExerciseCount = PLANNER_BASE_EXERCISES_PER_DAY,
): WorkoutDayPlan {
  if (day.is_rest_day || day.locked || !day.exercises?.length) return day;
  if (!plannerDayNeedsSanitization(day)) return day;

  let exercises = dedupeExercises(day.exercises).filter((exercise) => {
    const sourceDay = (exercise as ReflowTaggedExercise).reflow_source_day;
    if (typeof sourceDay !== "number" || sourceDay <= 0) return true;
    return isExerciseCompatibleWithDay(exercise, day);
  });
  exercises = trimExercisesToCap(exercises);

  const hasReflow = exercises.some((exercise) => Boolean((exercise as ReflowTaggedExercise).reflow_source_day));
  if (!hasReflow && exercises.length > baseExerciseCount) {
    exercises = exercises.slice(0, baseExerciseCount);
  }

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
