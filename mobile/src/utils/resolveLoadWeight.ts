import { GLOBAL_EXERCISES } from "../constants/GlobalExercisesData";
import type { SetLog } from "../store/workoutSessionStore";

const BODYWEIGHT_EQUIPMENT = new Set(["body weight", "bodyweight", "none", "bw"]);

export function parseRecommendedWeightMidpoint(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (lowered === "bodyweight" || lowered === "body weight" || lowered === "bw") {
    return 0;
  }
  const nums = text.match(/[\d.]+/g)?.map(Number).filter((n) => Number.isFinite(n)) ?? [];
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[nums.length - 1]) / 2;
}

function findGlobalExercise(exerciseName: string) {
  const key = exerciseName.trim().toLowerCase();
  if (!key) return undefined;
  const exact = GLOBAL_EXERCISES.find((ex) => ex.name.trim().toLowerCase() === key);
  if (exact) return exact;
  return GLOBAL_EXERCISES.find((ex) =>
    ex.aliases.some((alias) => alias.trim().toLowerCase() === key),
  );
}

/** Client-side bodyweight detection — skip load prompt for these exercises. */
export function isBodyweightExerciseClient(exerciseName: string): boolean {
  const ex = findGlobalExercise(exerciseName);
  if (!ex) return false;
  const equipment = ex.equipment.trim().toLowerCase();
  return BODYWEIGHT_EQUIPMENT.has(equipment);
}

/** In-session prefill: last logged weight for this exercise, else server hint. */
export function resolvePrefillLoadKg(
  exerciseName: string,
  setLogs: SetLog[],
  serverPrefillKg?: number | null,
): number | null {
  const inSession = [...setLogs]
    .reverse()
    .find(
      (log) =>
        log.exercise_name === exerciseName &&
        log.weight_kg != null &&
        Number.isFinite(log.weight_kg) &&
        log.weight_kg > 0,
    );
  if (inSession?.weight_kg != null) {
    return inSession.weight_kg;
  }
  if (serverPrefillKg != null && Number.isFinite(serverPrefillKg) && serverPrefillKg > 0) {
    return serverPrefillKg;
  }
  return null;
}

export function formatPrefillWeight(kg: number | null): string {
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return "";
  return String(Math.round(kg * 10) / 10);
}
