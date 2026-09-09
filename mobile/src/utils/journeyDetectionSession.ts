import { runJourneyDetection } from "../api/journey";

/** Once per app session per domain+date — avoids re-running detection on remount/back. */
const ranKeys = new Set<string>();

export async function runJourneyDetectionOnce(localDate: string, domain?: string): Promise<void> {
  const key = `${domain ?? "all"}:${localDate}`;
  if (ranKeys.has(key)) return;
  ranKeys.add(key);
  await runJourneyDetection(localDate);
}
