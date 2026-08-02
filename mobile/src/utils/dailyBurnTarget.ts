/**
 * Daily burn target shown as Home "to burn" and Workout Log "target".
 * Prefer live goal-progress fields, then onboarding timeline; fallback 20% of daily delta.
 */
export function resolveDailyBurnTarget(input?: {
  exercise_delta_kcal?: unknown;
  daily_delta_kcal?: unknown;
  timeline?: Record<string, unknown> | null;
} | null): number {
  const timeline = (input?.timeline ?? {}) as Record<string, unknown>;
  const dailyDelta = Number(input?.daily_delta_kcal ?? timeline.daily_delta_kcal);
  const deltaDisplay = Number.isFinite(dailyDelta) ? Math.round(Math.abs(dailyDelta)) : 200;
  const exerciseDelta = Number(input?.exercise_delta_kcal ?? timeline.exercise_delta_kcal);
  if (Number.isFinite(exerciseDelta)) return Math.max(0, Math.round(Math.abs(exerciseDelta)));
  return Math.max(0, Math.round(deltaDisplay * 0.2));
}
