import { resolveMetForExercise } from "./exerciseMetLookup";

const DEFAULT_MET = 5.0;

export function calcSetKcal({
  exerciseName,
  userWeightKg,
  metValue,
  setDurationSec = 45,
  restDurationSec = 90,
}: {
  exerciseName: string;
  userWeightKg: number;
  /** When omitted, resolved from the global exercise catalog (same source as server DB). */
  metValue?: number;
  setDurationSec?: number;
  restDurationSec?: number;
}): number {
  const met = metValue != null && metValue > 0 ? metValue : resolveMetForExercise(exerciseName);
  return Math.round(met * userWeightKg * ((setDurationSec + restDurationSec) / 3600));
}

export function calcExerciseEstimateKcal(
  exerciseName: string,
  setsRemaining: number,
  userWeightKg: number,
  metValue?: number,
): number {
  const met = metValue != null && metValue > 0 ? metValue : resolveMetForExercise(exerciseName);
  return calcSetKcal({ exerciseName, userWeightKg, metValue: met }) * setsRemaining;
}

/** @deprecated Use resolveMetForExercise from exerciseMetLookup.ts */
export function metForExercise(name: string): number {
  return resolveMetForExercise(name) || DEFAULT_MET;
}
