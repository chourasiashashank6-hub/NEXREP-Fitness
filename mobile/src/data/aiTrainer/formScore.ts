import type { AiRepEvent } from "./types";

/** Form score: start 100; −4 critical, −1 minor, +0.5 consecutive clean; clamp 40–100. */
export function scoreSetFromReps(
  reps: AiRepEvent[],
  checkSeverity: Record<string, "critical" | "minor"> = {},
): number {
  let score = 100;
  let cleanStreak = 0;
  for (const rep of reps) {
    if (rep.verdict === "clean") {
      cleanStreak += 1;
      score += 0.5;
      continue;
    }
    cleanStreak = 0;
    for (const id of rep.failedChecks) {
      const sev = checkSeverity[id] || "critical";
      score -= sev === "critical" ? 4 : 1;
    }
  }
  void cleanStreak;
  return Math.max(40, Math.min(100, Math.round(score * 10) / 10));
}

export function histogramFromReps(reps: AiRepEvent[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const rep of reps) {
    for (const id of rep.failedChecks) {
      h[id] = (h[id] || 0) + 1;
    }
  }
  return h;
}
