export type PlannedExercise = { name: string };

export type SessionSlotFill = {
  key: string;
  label: string;
  filled: boolean;
};

export function sameExerciseName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * One box per exercise in today's planned workout.
 * Filled when a same-day workout log matches that exercise name
 * (same rule Workout Log uses for session count / Done).
 */
export function fillSessionSlots(
  plannedExercises: PlannedExercise[] | null | undefined,
  loggedExerciseNames: string[],
): SessionSlotFill[] {
  const plan = Array.isArray(plannedExercises) ? plannedExercises : [];
  return plan.map((ex, index) => {
    const name = String(ex?.name || "").trim() || `Exercise ${index + 1}`;
    const filled = loggedExerciseNames.some((logged) => sameExerciseName(logged, name));
    return {
      key: `session-ex-${index}-${name}`,
      label: name,
      filled,
    };
  });
}
