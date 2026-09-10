import AsyncStorage from "@react-native-async-storage/async-storage";
import { localDateIso } from "./localDate";

const STORAGE_KEY = "smart_reflow_daily_run_v1";
const MAX_STORED = 12;

export type StoredDailyRun = {
  planId: number;
  localDate: string;
};

async function readStoredRuns(): Promise<StoredDailyRun[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredDailyRun =>
        entry != null &&
        typeof entry.planId === "number" &&
        typeof entry.localDate === "string",
    );
  } catch {
    return [];
  }
}

export function hasDailyRunForPlan(
  entries: StoredDailyRun[],
  planId: number,
  today: string,
): boolean {
  return entries.some((entry) => entry.planId === planId && entry.localDate === today);
}

/** True when repair + reflow already ran today (IST) for this plan. */
export async function wasDailyReflowPipelineRunToday(
  planId: number,
  today = localDateIso(),
): Promise<boolean> {
  const entries = await readStoredRuns();
  return hasDailyRunForPlan(entries, planId, today);
}

export async function markDailyReflowPipelineRun(
  planId: number,
  today = localDateIso(),
): Promise<void> {
  const entries = await readStoredRuns().then((list) =>
    list.filter((entry) => entry.planId !== planId),
  );
  entries.push({ planId, localDate: today });
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_STORED)));
}
