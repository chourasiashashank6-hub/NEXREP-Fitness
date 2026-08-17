import type { WorkoutHistoryItem } from "../api/workout";
import i18n from "../i18n";
import type { MuscleStatus } from "../types/workoutCoach";
import { inferMusclesFromWorkout, parseWorkoutTimestamp } from "./workoutMuscleInfer";

const BASE_MUSCLES = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"] as const;

export type MuscleRecoveryGroup = {
  name: string;
  status: MuscleStatus;
  recoveryPercent: number;
  lastTrainedLabel: string;
};

function relativeLabel(dateIso: string): string {
  const d = new Date(dateIso).getTime();
  const now = Date.now();
  const hours = Math.max(0, Math.round((now - d) / (1000 * 60 * 60)));
  if (hours < 24) return i18n.t("coach.common.today");
  const days = Math.round(hours / 24);
  if (days === 1) return i18n.t("coach.common.yesterday");
  return i18n.t("coach.common.daysAgo", { count: days });
}

export type RecoveryHistoryItem = Pick<WorkoutHistoryItem, "date" | "exerciseName"> &
  Partial<Pick<WorkoutHistoryItem, "type" | "notes" | "bodyPart">>;

/** Same recovery computation as Workout Coach Muscle Recovery Map — no AI narrative. */
export function buildMuscleRecoveryGroups(items: RecoveryHistoryItem[]): MuscleRecoveryGroup[] {
  const sorted = [...items].sort((a, b) => {
    const ta = parseWorkoutTimestamp(a.date) ?? 0;
    const tb = parseWorkoutTimestamp(b.date) ?? 0;
    return tb - ta;
  });
  const now = Date.now();
  const lastTrained = new Map<string, number>();

  for (const w of sorted) {
    const muscles = inferMusclesFromWorkout(w);
    const ts = parseWorkoutTimestamp(w.date);
    if (ts == null) continue;
    for (const m of muscles) {
      if (!BASE_MUSCLES.includes(m as (typeof BASE_MUSCLES)[number])) continue;
      if (!lastTrained.has(m) || ts > (lastTrained.get(m) || 0)) lastTrained.set(m, ts);
    }
  }

  return BASE_MUSCLES.map((m) => {
    const ts = lastTrained.get(m);
    const hrs = ts ? Math.max(0, (now - ts) / (1000 * 60 * 60)) : 168;
    const recoveryPercent = Math.max(12, Math.min(96, Math.round((Math.min(168, hrs) / 168) * 100)));
    const status: MuscleStatus =
      recoveryPercent < 28 ? "sore" : recoveryPercent < 52 ? "tired" : recoveryPercent < 76 ? "ready" : "fresh";
    return {
      name: m,
      status,
      recoveryPercent,
      lastTrainedLabel: ts ? relativeLabel(new Date(ts).toISOString()) : i18n.t("coach.common.notTrainedRecently"),
    };
  });
}

/** Planner focus labels like "Arms" map onto recovery groups (Biceps + Triceps). */
export function expandFocusMusclesForRecovery(focusMuscles: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of focusMuscles ?? []) {
    const name = raw.trim();
    if (!name) continue;
    if (name.toLowerCase() === "arms") {
      out.push("Biceps", "Triceps");
      continue;
    }
    out.push(name);
  }
  return [...new Set(out)];
}

/** First sore muscle in today's planned focus list, if any. */
export function firstSoreFocusMuscle(
  groups: MuscleRecoveryGroup[],
  focusMuscles: string[] | null | undefined,
): MuscleRecoveryGroup | null {
  const focusSet = new Set(expandFocusMusclesForRecovery(focusMuscles));
  if (!focusSet.size) return null;
  return groups.find((g) => g.status === "sore" && focusSet.has(g.name)) ?? null;
}
