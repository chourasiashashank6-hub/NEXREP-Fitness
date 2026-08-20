import AsyncStorage from "@react-native-async-storage/async-storage";
import { todayLocal } from "../api/caloriesLog";
import type { CoachCadence } from "../hooks/useCoachRedesign";

const STORAGE_KEY = "refresh_usage_counts_v1";

function parseLocalDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Period bucket for cadence-scoped refresh usage (informational counts only). */
export function periodKeyForCadence(cadence: CoachCadence, localDate: string): string {
  const date = parseLocalDate(localDate);
  if (cadence === "daily") return localDate;
  if (cadence === "weekly") {
    const weekday = date.getDay();
    const diff = weekday === 0 ? -6 : 1 - weekday;
    const monday = new Date(date);
    monday.setDate(date.getDate() + diff);
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, "0");
    const d = String(monday.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (cadence === "monthly") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${date.getFullYear()}`;
}

export function coachRefreshUsageKey(
  domain: "nutrition" | "workout",
  cadence: CoachCadence,
  localDate = todayLocal(),
): string {
  return `coach:${domain}:${cadence}:${periodKeyForCadence(cadence, localDate)}`;
}

export function mealWeekRefreshUsageKey(weekStart: string): string {
  return `meal:week:${weekStart}`;
}

async function readCounts(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function getRefreshUsageCount(key: string): Promise<number> {
  const counts = await readCounts();
  const value = counts[key];
  return typeof value === "number" && value >= 0 ? value : 0;
}

export async function incrementRefreshUsageCount(key: string): Promise<number> {
  const counts = await readCounts();
  const next = (counts[key] ?? 0) + 1;
  counts[key] = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  return next;
}
