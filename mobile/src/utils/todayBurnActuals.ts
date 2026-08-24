import { isGuidedWarmupLog } from "./workoutLogSource";

export type TodayBurnHistoryItem = {
  date: string;
  caloriesBurned?: number;
  exerciseName?: string | null;
};

export function summarizeTodayBurnActuals(
  history: ReadonlyArray<TodayBurnHistoryItem>,
  isSameLocalDay: (isoDate: string, day: Date) => boolean,
  day: Date = new Date(),
): { warmupKcal: number; sessionKcal: number } {
  let warmupKcal = 0;
  let sessionKcal = 0;

  for (const item of history) {
    if (!item?.date || !isSameLocalDay(item.date, day)) continue;
    const kcal = Math.max(0, Number(item.caloriesBurned) || 0);
    if (isGuidedWarmupLog(item)) warmupKcal += kcal;
    else sessionKcal += kcal;
  }

  return { warmupKcal, sessionKcal };
}
