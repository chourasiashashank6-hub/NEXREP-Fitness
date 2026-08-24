import type { WorkoutDayPlan, WorkoutExercise } from "../types/planner";
import type { ReflowMove } from "./reflowNotifyMessage";

export type ReflowTaggedExercise = WorkoutExercise & {
  reflow_source_day?: number;
};

export function tagExerciseForReflow(exercise: WorkoutExercise, sourceDay: number): ReflowTaggedExercise {
  return { ...exercise, reflow_source_day: sourceDay };
}

export function countReflowedExercises(exercises: WorkoutExercise[]): {
  count: number;
  sourceDays: number[];
} {
  const sourceDays = new Set<number>();
  let count = 0;
  for (const exercise of exercises) {
    const sourceDay = (exercise as ReflowTaggedExercise).reflow_source_day;
    if (typeof sourceDay === "number" && sourceDay > 0) {
      count += 1;
      sourceDays.add(sourceDay);
    }
  }
  return { count, sourceDays: [...sourceDays].sort((a, b) => a - b) };
}

/** Build move metadata from persisted day payloads after a reflow write. */
export function extractReflowMovesFromDays(days: WorkoutDayPlan[]): ReflowMove[] {
  const moves: ReflowMove[] = [];
  for (const day of days) {
    for (const exercise of day.exercises ?? []) {
      const sourceDay = (exercise as ReflowTaggedExercise).reflow_source_day;
      if (typeof sourceDay !== "number" || sourceDay <= 0) continue;
      moves.push({
        name: exercise.name,
        sourceDay,
        targetDay: day.day,
      });
    }
  }
  return moves;
}
