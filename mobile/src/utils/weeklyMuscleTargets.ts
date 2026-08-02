const BASE_MUSCLES = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"] as const;

const BASE_SETS_BY_WORKOUTS_PER_WEEK: { max: number; sets: number }[] = [
  { max: 2, sets: 8 },
  { max: 4, sets: 14 },
  { max: 6, sets: 18 },
  { max: Infinity, sets: 20 },
];

const FOCUS_MUSCLE_MAP: Record<string, string[]> = {
  Chest: ["Chest"],
  Back: ["Back"],
  Shoulders: ["Shoulders"],
  Legs: ["Legs"],
  Arms: ["Triceps", "Biceps"],
  Core: [],
  Balanced: [],
};

const FOCUS_BONUS_SETS = 4;

export function getMuscleWeeklyTargets(
  workoutsPerWeek: number | null | undefined,
  focusMuscles: string[] | null | undefined,
): Record<string, number> {
  const base = BASE_SETS_BY_WORKOUTS_PER_WEEK.find((b) => (workoutsPerWeek ?? 4) <= b.max)!.sets;

  const bonusedMuscles = new Set((focusMuscles ?? []).flatMap((m) => FOCUS_MUSCLE_MAP[m] ?? []));

  const targets: Record<string, number> = {};
  for (const muscle of BASE_MUSCLES) {
    targets[muscle] = base + (bonusedMuscles.has(muscle) ? FOCUS_BONUS_SETS : 0);
  }
  return targets;
}

export function getTargetWeeklySets(
  workoutsPerWeek: number | null | undefined,
  focusMuscles: string[] | null | undefined,
): number {
  return Object.values(getMuscleWeeklyTargets(workoutsPerWeek, focusMuscles)).reduce((s, v) => s + v, 0);
}
