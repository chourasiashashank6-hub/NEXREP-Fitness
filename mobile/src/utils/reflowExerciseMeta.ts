import type { WorkoutExercise } from "../types/planner";

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
