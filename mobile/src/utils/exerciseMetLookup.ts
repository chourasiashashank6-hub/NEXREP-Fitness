import { GLOBAL_EXERCISES } from "../constants/GlobalExercisesData";

const DEFAULT_MET = 5.0;

const metByExactName = new Map<string, number>();
const metByExerciseId = new Map<number, number>();

for (const exercise of GLOBAL_EXERCISES) {
  metByExactName.set(exercise.name.trim().toLowerCase(), exercise.met_value);
  if (typeof exercise.id === "number") {
    metByExerciseId.set(exercise.id, exercise.met_value);
  }
  for (const alias of exercise.aliases) {
    metByExactName.set(alias.trim().toLowerCase(), exercise.met_value);
  }
}

/** Mirrors server exercise_met_service — prefers exercise_id when present. */
export function resolveMetForExercise(exerciseName: string, exerciseId?: number | null): number {
  if (exerciseId != null && metByExerciseId.has(exerciseId)) {
    const byId = metByExerciseId.get(exerciseId)!;
    if (byId > 0) return byId;
  }

  const key = exerciseName.trim().toLowerCase();
  if (!key) return DEFAULT_MET;

  const exact = metByExactName.get(key);
  if (exact != null && exact > 0) return exact;

  const partialMatches = GLOBAL_EXERCISES.filter((exercise) => {
    const catalogName = exercise.name.trim().toLowerCase();
    return catalogName.includes(key) || key.includes(catalogName);
  });
  if (partialMatches.length === 1) {
    return partialMatches[0].met_value > 0 ? partialMatches[0].met_value : DEFAULT_MET;
  }

  return DEFAULT_MET;
}
