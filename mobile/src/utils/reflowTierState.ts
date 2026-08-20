import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "smart_reflow_tier3_ack_v1";
const MAX_STORED = 24;

export type Tier3PromptOutcome = "declined" | "accepted";

export function buildReflowTierStateId(planId: number, month: number, year: number): string {
  return `${planId}:${year}-${String(month).padStart(2, "0")}`;
}

type StoredTier3Ack = {
  id: string;
  outcome: Tier3PromptOutcome;
  missedDayCount: number;
};

async function readStoredAcks(): Promise<StoredTier3Ack[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.id === "string") : [];
  } catch {
    return [];
  }
}

export async function getTier3PromptAck(stateId: string): Promise<StoredTier3Ack | null> {
  const entries = await readStoredAcks();
  return entries.find((entry) => entry.id === stateId) ?? null;
}

export async function isTier3PromptAcknowledged(stateId: string): Promise<boolean> {
  return (await getTier3PromptAck(stateId)) != null;
}

export async function acknowledgeTier3Prompt(
  stateId: string,
  outcome: Tier3PromptOutcome,
  missedDayCount: number,
): Promise<void> {
  const entries = await readStoredAcks().then((list) => list.filter((entry) => entry.id !== stateId));
  entries.push({ id: stateId, outcome, missedDayCount });
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_STORED)));
}

export async function shouldSkipTier3ReflowScan(stateId: string): Promise<boolean> {
  return isTier3PromptAcknowledged(stateId);
}
