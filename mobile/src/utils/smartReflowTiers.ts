import type { WorkoutHistoryItem } from "../api/workout";
import type { WorkoutExercise, WorkoutPlanCurrent } from "../types/planner";
import { pickCompoundReflowCandidates } from "./exerciseCompoundLookup";
import { collectLoggedPlannerExerciseNames, hasAnyPlannerLogForDay } from "./workoutPlannerLog";
import type { ReflowDaySnapshot } from "./smartReflow";

/** Tier 2 begins at this many missed training days (inclusive). */
export const REFLOW_TIER2_MIN_MISSED_DAYS = 5;
/** Tier 3 begins here — reflow stops and a regenerate prompt is shown instead. */
export const REFLOW_TIER3_MIN_MISSED_DAYS = 10;
/** Max compound exercises to pull from each missed day (source-side cap). */
export const REFLOW_COMPOUND_LIMIT_PER_MISSED_DAY = 3;

export type ReflowTier = 0 | 1 | 2 | 3;

export type MissedReflowDay = {
  day: number;
  exercises: WorkoutExercise[];
};

export type ReflowTierAssessment = {
  tier: ReflowTier;
  missedDays: MissedReflowDay[];
  missedDayCount: number;
  entirePlanPeriodMissed: boolean;
};

function dayKey(plan: WorkoutPlanCurrent, day: number): string {
  return `${plan.year}-${String(plan.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Missed-day definition for Smart Reflow tiers — matches buildSmartReflowPatches source-day
 * detection (planner-checkbox logs only, not weekly review's any-workout rule).
 */
export function assessReflowTier(
  plan: WorkoutPlanCurrent,
  daySnapshots: ReflowDaySnapshot[],
  historyItems: WorkoutHistoryItem[],
): ReflowTierAssessment {
  const snapshotByDay = new Map(daySnapshots.map((snapshot) => [snapshot.day, snapshot]));
  const missedDays: MissedReflowDay[] = [];

  for (const overview of plan.month_overview) {
    if (!overview.is_past || overview.is_rest_day) continue;
    const snapshot = snapshotByDay.get(overview.day);
    if (!snapshot || snapshot.exercises.length === 0) continue;
    if (hasAnyPlannerLogForDay(historyItems, snapshot.exercises, dayKey(plan, overview.day))) continue;
    missedDays.push({ day: overview.day, exercises: snapshot.exercises });
  }

  missedDays.sort((a, b) => a.day - b.day);
  const missedDayCount = missedDays.length;
  const missedDayNumbers = missedDays.map((entry) => entry.day);
  const entirePlanPeriodMissed = isEntirePlanPeriodMissed(plan, missedDayNumbers);

  let tier: ReflowTier = 0;
  if (missedDayCount >= REFLOW_TIER3_MIN_MISSED_DAYS) tier = 3;
  else if (missedDayCount >= REFLOW_TIER2_MIN_MISSED_DAYS) tier = 2;
  else if (missedDayCount > 0) tier = 1;

  return { tier, missedDays, missedDayCount, entirePlanPeriodMissed };
}

/** True when every past training day was missed and no future training days remain. */
export function isEntirePlanPeriodMissed(plan: WorkoutPlanCurrent, missedDayNumbers: number[]): boolean {
  const trainingDays = plan.month_overview.filter((overview) => !overview.is_rest_day);
  if (!trainingDays.length) return false;

  const missedSet = new Set(missedDayNumbers);
  const pastTraining = trainingDays.filter((overview) => overview.is_past);
  const futureTraining = trainingDays.filter((overview) => !overview.is_past);
  if (!pastTraining.length || futureTraining.length > 0) return false;

  return pastTraining.every((overview) => missedSet.has(overview.day));
}

export function collectReflowCandidates(
  assessment: ReflowTierAssessment,
  snapshotByDay: Map<number, ReflowDaySnapshot>,
  historyItems: WorkoutHistoryItem[],
  exerciseNameKey: (name: string) => string,
): Array<{ sourceDay: number; exercise: WorkoutExercise }> {
  const items: Array<{ sourceDay: number; exercise: WorkoutExercise }> = [];
  const loggedExerciseNames = collectLoggedPlannerExerciseNames(historyItems);

  for (const missed of assessment.missedDays) {
    const snapshot = snapshotByDay.get(missed.day);
    if (!snapshot) continue;
    const otherDayExerciseNames = collectExerciseNamesOnOtherDays(snapshotByDay, missed.day, exerciseNameKey);
    const stillOnSourceDay = snapshot.exercises.filter((exercise) => {
      const key = exerciseNameKey(exercise.name);
      if (!key) return false;
      if (otherDayExerciseNames.has(key)) return false;
      if (loggedExerciseNames.has(key)) return false;
      return true;
    });
    for (const exercise of pickCompoundReflowCandidates(
      stillOnSourceDay,
      REFLOW_COMPOUND_LIMIT_PER_MISSED_DAY,
    )) {
      items.push({ sourceDay: missed.day, exercise });
    }
  }

  if (assessment.tier === 2) {
    items.sort((a, b) => b.sourceDay - a.sourceDay);
  } else {
    items.sort((a, b) => a.sourceDay - b.sourceDay);
  }

  return items;
}

/** Names on any other training day — catches reflow targets that are now in the past. */
function collectExerciseNamesOnOtherDays(
  snapshotByDay: Map<number, ReflowDaySnapshot>,
  excludeDay: number,
  exerciseNameKey: (name: string) => string,
): Set<string> {
  const names = new Set<string>();
  for (const snapshot of snapshotByDay.values()) {
    if (snapshot.is_rest_day || snapshot.day === excludeDay) continue;
    for (const exercise of snapshot.exercises) {
      const key = exerciseNameKey(exercise.name);
      if (key) names.add(key);
    }
  }
  return names;
}
