/**
 * Helpers for Workout Planner ↔ Workout Log checkbox sync.
 * Logging always goes through addWorkout/deleteWorkout (same as manual Log form).
 */

import type { WorkoutExercise } from "../types/planner";

export type WorkoutHistoryMatchItem = {
  id: number;
  exerciseName: string;
  notes?: string | null;
  date: string;
};

/** Stable key for planner exercise ↔ workout log matching. */
export function exerciseLogKey(exercise: Pick<WorkoutExercise, "name">, index: number): string {
  return `n:${index}:${(exercise.name || "").trim().toLowerCase()}`;
}

export function parsePlannerReps(reps: string | number): number {
  const n = typeof reps === "number" ? reps : parseInt(String(reps), 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Approximate session time from plan sets/reps/rest — same volume model as server MET estimate. */
export function estimatePlannerTimeTaken(exercise: Pick<WorkoutExercise, "sets" | "reps" | "rest_seconds">): {
  timeTaken: string;
  durationMin: number;
} {
  const sets = Math.max(1, Number(exercise.sets) || 1);
  const reps = parsePlannerReps(exercise.reps);
  const restSec = Math.max(0, Number(exercise.rest_seconds) || 45);
  const activeSeconds = sets * reps * 2.2;
  const restSeconds = Math.max(0, sets - 1) * restSec;
  const totalSeconds = Math.max(60, Math.round(activeSeconds + restSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    timeTaken: `${minutes}:${String(seconds).padStart(2, "0")}`,
    durationMin: Math.max(1, Math.ceil(totalSeconds / 60)),
  };
}

export function toLocalDateKey(value: unknown, now = new Date()): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  // Silence unused — kept for callers that may want "today" fallback later.
  void now;
  return `${y}-${m}-${day}`;
}

export function isPlannerLoggedWorkout(item: Pick<WorkoutHistoryMatchItem, "notes">): boolean {
  const notes = String(item.notes || "").toLowerCase();
  return notes.includes("source=workout_planner");
}

export function findPlannerWorkoutLog(
  items: WorkoutHistoryMatchItem[],
  exercise: Pick<WorkoutExercise, "name">,
  dayKey: string,
): WorkoutHistoryMatchItem | undefined {
  const targetName = (exercise.name || "").trim().toLowerCase();
  return items.find((item) => {
    if (!isPlannerLoggedWorkout(item)) return false;
    if (toLocalDateKey(item.date) !== dayKey) return false;
    return (item.exerciseName || "").trim().toLowerCase() === targetName;
  });
}

export function buildLoggedExerciseIdMap(
  items: WorkoutHistoryMatchItem[],
  exercises: Pick<WorkoutExercise, "name">[],
  dayKey: string,
): Record<string, number> {
  const next: Record<string, number> = {};
  exercises.forEach((ex, i) => {
    const match = findPlannerWorkoutLog(items, ex, dayKey);
    if (match?.id != null) next[exerciseLogKey(ex, i)] = match.id;
  });
  return next;
}
