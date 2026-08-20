import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReflowMove } from "./reflowNotifyMessage";

const STORAGE_KEY = "smart_reflow_acknowledged_v1";
const MAX_STORED = 50;

export function buildReflowAdaptationId(planId: number, moves: ReflowMove[]): string {
  const signature = moves
    .map((move) => `${move.sourceDay}>${move.targetDay}:${move.name.trim().toLowerCase()}`)
    .sort()
    .join("|");
  return `${planId}:${signature}`;
}

async function readAcknowledgedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function isReflowAdaptationAcknowledged(adaptationId: string): Promise<boolean> {
  const ids = await readAcknowledgedIds();
  return ids.includes(adaptationId);
}

export async function acknowledgeReflowAdaptation(adaptationId: string): Promise<void> {
  const ids = await readAcknowledgedIds();
  if (ids.includes(adaptationId)) return;
  const next = [...ids, adaptationId].slice(-MAX_STORED);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
