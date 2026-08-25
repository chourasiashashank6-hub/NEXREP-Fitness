import { resolveMetForExercise } from "./exerciseMetLookup";

const DEFAULT_MET = 5.0;

/** Active session (Option A) — mirrors server session_calories.py */
export const ACTIVE_SESSION_CALORIE_DEFAULTS = {
  BASELINE_WORK_SEC: 45,
  BASELINE_REPS: 10,
  DEFAULT_REST_SEC: 90,
  DENSITY_EXPONENT: 0.35,
  REP_MULT_MIN: 0.8,
  REP_MULT_MAX: 1.2,
  MIN_WORK_SEC: 1,
} as const;

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

export function calcActiveSetKcal({
  exerciseName,
  userWeightKg,
  metValue,
  workSec,
  restSec,
  reps,
  prescribedReps,
  prescribedWorkSec = ACTIVE_SESSION_CALORIE_DEFAULTS.BASELINE_WORK_SEC,
}: {
  exerciseName: string;
  userWeightKg: number;
  metValue?: number;
  workSec?: number | null;
  restSec?: number | null;
  reps?: number | null;
  prescribedReps?: number | null;
  prescribedWorkSec?: number;
}): number {
  const met = metValue != null && metValue > 0 ? metValue : resolveMetForExercise(exerciseName);
  const weight = Math.max(0, Number(userWeightKg) || 0);
  const rest = Math.max(0, restSec ?? ACTIVE_SESSION_CALORIE_DEFAULTS.DEFAULT_REST_SEC);
  const baselineReps = Math.max(1, prescribedReps ?? ACTIVE_SESSION_CALORIE_DEFAULTS.BASELINE_REPS);
  const baselineWork = Math.max(
    ACTIVE_SESSION_CALORIE_DEFAULTS.MIN_WORK_SEC,
    prescribedWorkSec ?? ACTIVE_SESSION_CALORIE_DEFAULTS.BASELINE_WORK_SEC,
  );

  let work: number | null = workSec != null && workSec > 0 ? workSec : null;
  const repsValid = reps != null && reps > 0;

  if (!repsValid && work == null) {
    return Math.max(1, calcSetKcal({ exerciseName, userWeightKg: weight, metValue: met }));
  }

  if (!repsValid && work != null) {
    return Math.max(1, Math.round(met * weight * ((work + rest) / 3600)));
  }

  const repsEff = Math.max(1, reps ?? baselineReps);
  if (work == null) work = baselineWork;
  work = Math.max(ACTIVE_SESSION_CALORIE_DEFAULTS.MIN_WORK_SEC, work);

  const baselineDensity = baselineReps / baselineWork;
  const actualDensity = repsEff / work;
  const densityRatio = baselineDensity > 0 ? actualDensity / baselineDensity : 1;
  const repMultiplier = Math.max(
    ACTIVE_SESSION_CALORIE_DEFAULTS.REP_MULT_MIN,
    Math.min(ACTIVE_SESSION_CALORIE_DEFAULTS.REP_MULT_MAX, densityRatio ** ACTIVE_SESSION_CALORIE_DEFAULTS.DENSITY_EXPONENT),
  );
  const effectiveMet = met * repMultiplier;
  return Math.max(1, Math.round(effectiveMet * weight * ((work + rest) / 3600)));
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
