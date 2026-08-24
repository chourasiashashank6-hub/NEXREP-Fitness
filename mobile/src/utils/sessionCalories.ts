// Authoritative per-exercise burn model — mirrored by server session_calories.py.
const MET_DEFAULTS: Record<string, number> = {
  // compound lifts
  squat: 6.0,
  deadlift: 6.0,
  "bench press": 6.0,
  "overhead press": 6.0,
  "barbell row": 6.0,
  "pull-up": 6.0,
  "chin-up": 6.0,
};
const DEFAULT_MET = 5.0;

export function metForExercise(name: string): number {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(MET_DEFAULTS)) {
    if (key.includes(k)) return v;
  }
  return DEFAULT_MET;
}

export function calcSetKcal({
  exerciseName,
  userWeightKg,
  setDurationSec = 45,
  restDurationSec = 90,
}: {
  exerciseName: string;
  userWeightKg: number;
  setDurationSec?: number;
  restDurationSec?: number;
}): number {
  const met = metForExercise(exerciseName);
  return Math.round(met * userWeightKg * ((setDurationSec + restDurationSec) / 3600));
}

export function calcExerciseEstimateKcal(
  exerciseName: string,
  setsRemaining: number,
  userWeightKg: number,
): number {
  return calcSetKcal({ exerciseName, userWeightKg }) * setsRemaining;
}
