import type { StrengthProgress } from "../api/strength";
import type { WorkoutHistoryItem } from "../api/workout";
import { normalizeExerciseName } from "./exerciseGuidanceLookup";

export type ExerciseBest = {
  weight_kg: number;
  reps: number;
  estimated_1rm_kg: number;
  date: string | null;
};

export function exercisesMatch(left: string, right: string): boolean {
  const a = normalizeExerciseName(left);
  const b = normalizeExerciseName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function upsertBest(
  map: Map<string, ExerciseBest>,
  exerciseName: string,
  candidate: ExerciseBest,
) {
  if (candidate.estimated_1rm_kg <= 0) return;

  let existingKey: string | null = null;
  for (const key of map.keys()) {
    if (exercisesMatch(key, exerciseName)) {
      existingKey = key;
      break;
    }
  }

  if (!existingKey) {
    map.set(normalizeExerciseName(exerciseName), candidate);
    return;
  }

  const existing = map.get(existingKey)!;
  if (candidate.estimated_1rm_kg > existing.estimated_1rm_kg) {
    map.set(existingKey, candidate);
  }
}

/** Build exercise → best lift map from strength progress + workout history (one prefetch). */
export function buildExerciseBestMap(
  strengthProgress: StrengthProgress | null | undefined,
  historyItems: WorkoutHistoryItem[],
): Map<string, ExerciseBest> {
  const map = new Map<string, ExerciseBest>();

  for (const lift of strengthProgress?.lifts ?? []) {
    if (!lift.best_lift || lift.current_best_1rm_kg <= 0) continue;
    upsertBest(map, lift.exercise_name, {
      weight_kg: lift.best_lift.weight_kg,
      reps: lift.best_lift.reps,
      estimated_1rm_kg: lift.current_best_1rm_kg,
      date: lift.best_lift.date,
    });
  }

  for (const item of historyItems) {
    const strengthLift = item.strengthLift;
    if (!strengthLift || strengthLift.estimated_1rm_kg <= 0) continue;
    upsertBest(map, strengthLift.exercise_name || item.exerciseName, {
      weight_kg: strengthLift.weight_kg,
      reps: strengthLift.reps,
      estimated_1rm_kg: strengthLift.estimated_1rm_kg,
      date: strengthLift.date,
    });
  }

  return map;
}

export function lookupExerciseBest(
  map: Map<string, ExerciseBest>,
  exerciseName: string,
): ExerciseBest | null {
  for (const [key, value] of map.entries()) {
    if (exercisesMatch(key, exerciseName)) return value;
  }
  return null;
}
