import { todayLocal } from "../api/caloriesLog";

export type DayMeta = {
  date: string;
  dayLabel: string;
  dayNum: number;
  foodLogged: boolean;
  workoutDone: boolean;
  isToday: boolean;
};

export type StreakMeta = {
  streak: number;
  emoji: string;
  label: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseServerDateLocal(value: string): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  const normalized =
    /^\d{4}-\d{2}-\d{2}T/.test(raw) && !/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeDateKey(value: string): string {
  const parsed = parseServerDateLocal(value);
  if (!parsed) return String(value).slice(0, 10);
  return formatDateKey(parsed);
}

export function listPastDateKeys(days: number, anchor = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(anchor);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(formatDateKey(d));
  }
  return out;
}

function buildActivitySets(
  calorieLogs: { date: string; total_calories: number }[],
  workoutItems: { date: string; caloriesBurned?: number }[],
) {
  const foodDates = new Set<string>();
  for (const log of calorieLogs) {
    if (Number(log.total_calories) > 0) {
      foodDates.add(normalizeDateKey(log.date));
    }
  }
  const workoutDates = new Set<string>();
  for (const item of workoutItems) {
    if (item?.date) workoutDates.add(normalizeDateKey(item.date));
  }
  return { foodDates, workoutDates };
}

function isDayActive(dateKey: string, foodDates: Set<string>, workoutDates: Set<string>): boolean {
  return foodDates.has(dateKey) || workoutDates.has(dateKey);
}

/** Consecutive days (food and/or workout) ending today or yesterday if today is still empty. */
export function computeCombinedStreak(
  calorieLogs: { date: string; total_calories: number }[],
  workoutItems: { date: string; caloriesBurned?: number }[],
): number {
  const { foodDates, workoutDates } = buildActivitySets(calorieLogs, workoutItems);
  const todayKey = todayLocal();
  let streak = 0;
  let startOffset = isDayActive(todayKey, foodDates, workoutDates) ? 0 : 1;

  for (let i = startOffset; i < 366; i++) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d);
    if (isDayActive(key, foodDates, workoutDates)) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export function getStreakMeta(streak: number): StreakMeta {
  if (streak <= 0) {
    return { streak: 0, emoji: "🔥", label: "Start your streak today" };
  }
  if (streak === 1) {
    return { streak, emoji: "🔥", label: "Great start — keep it going!" };
  }
  if (streak < 7) {
    return { streak, emoji: "🔥", label: "Building momentum" };
  }
  if (streak < 30) {
    return { streak, emoji: "🔥", label: "You're on fire!" };
  }
  return { streak, emoji: "🔥", label: "Unstoppable streak!" };
}

/** Seven calendar days oldest → newest; today is the last item. */
export function getLast7DaysMeta(
  calorieLogs: { date: string; total_calories: number }[],
  workoutItems: { date: string; caloriesBurned?: number }[],
): DayMeta[] {
  const { foodDates, workoutDates } = buildActivitySets(calorieLogs, workoutItems);
  const todayKey = todayLocal();
  const out: DayMeta[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const date = formatDateKey(d);
    const isToday = date === todayKey;
    out.push({
      date,
      dayLabel: isToday ? "Today" : DAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
      foodLogged: foodDates.has(date),
      workoutDone: workoutDates.has(date),
      isToday,
    });
  }

  return out;
}
