import { GLOBAL_EXERCISES } from "../constants/GlobalExercisesData";
import type { WorkoutExercise } from "../types/planner";

const compoundByName = new Map<string, boolean>();

for (const exercise of GLOBAL_EXERCISES) {
  compoundByName.set(exercise.name.trim().toLowerCase(), exercise.is_compound);
  for (const alias of exercise.aliases) {
    compoundByName.set(alias.trim().toLowerCase(), exercise.is_compound);
  }
}

export function isCompoundExercise(name: string): boolean {
  const key = name.trim().toLowerCase();
  if (compoundByName.has(key)) return compoundByName.get(key)!;
  return true;
}

export function pickPriorityExercises(exercises: WorkoutExercise[], max = 2): WorkoutExercise[] {
  return [...exercises]
    .sort((a, b) => {
      const aCompound = isCompoundExercise(a.name) ? 0 : 1;
      const bCompound = isCompoundExercise(b.name) ? 0 : 1;
      if (aCompound !== bCompound) return aCompound - bCompound;
      return 0;
    })
    .slice(0, max);
}

/** Compound-only candidates for Smart Reflow (isolation stays unrecovered). */
export function pickCompoundReflowCandidates(exercises: WorkoutExercise[], max = 3): WorkoutExercise[] {
  return pickPriorityExercises(
    exercises.filter((exercise) => isCompoundExercise(exercise.name)),
    max,
  );
}
