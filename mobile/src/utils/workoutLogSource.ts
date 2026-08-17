import { GUIDED_WARMUP_EXERCISE_NAME } from "./guidedWarmupComplete";
import { isPlannerLoggedWorkout, toLocalDateKey, type WorkoutHistoryMatchItem } from "./workoutPlannerLog";

export type WorkoutLogSource =
  | "manual"
  | "workout_planner"
  | "guided_warmup"
  | "active_session";

export type WorkoutLogSourceItem = {
  exerciseName?: string | null;
  notes?: string | null;
};

export function isGuidedWarmupLog(item: WorkoutLogSourceItem): boolean {
  const name = String(item.exerciseName || "").trim().toLowerCase();
  return name === GUIDED_WARMUP_EXERCISE_NAME.toLowerCase();
}

export function isActiveSessionLog(item: WorkoutLogSourceItem): boolean {
  const notes = String(item.notes || "").toLowerCase();
  return notes.startsWith("active_session") || notes.startsWith("active_session_partial");
}

export function isActiveSessionPartialLog(item: WorkoutLogSourceItem): boolean {
  return String(item.notes || "").toLowerCase().startsWith("active_session_partial");
}

/** Where this history row was logged — used for Session History labels. */
export function resolveWorkoutLogSource(item: WorkoutLogSourceItem): WorkoutLogSource {
  if (isPlannerLoggedWorkout(item)) return "workout_planner";
  if (isGuidedWarmupLog(item)) return "guided_warmup";
  if (isActiveSessionLog(item)) return "active_session";
  return "manual";
}

export const WORKOUT_LOG_SOURCE_I18N_KEY: Record<WorkoutLogSource, string> = {
  manual: "workoutLog.source.manual",
  workout_planner: "workoutLog.source.workoutPlanner",
  guided_warmup: "workoutLog.source.guidedWarmup",
  active_session: "workoutLog.source.activeSession",
};

export function findGuidedWarmupLogForDay(
  items: WorkoutHistoryMatchItem[],
  dayKey: string,
): WorkoutHistoryMatchItem | undefined {
  return items.find(
    (item) => isGuidedWarmupLog(item) && toLocalDateKey(item.date) === dayKey,
  );
}
