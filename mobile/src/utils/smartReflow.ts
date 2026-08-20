import type { WorkoutHistoryItem } from "../api/workout";
import type { WorkoutDayPlan, WorkoutExercise, WorkoutPlanCurrent } from "../types/planner";
import { tagExerciseForReflow } from "./reflowExerciseMeta";
import type { ReflowMove } from "./reflowNotifyMessage";
import {
  isExerciseCompatibleWithDay,
  REFLOW_MAX_EXERCISES_PER_DAY,
  remainingReflowSlots,
} from "./reflowMuscleCompat";
import { assessReflowTier, collectReflowCandidates, type ReflowTierAssessment } from "./smartReflowTiers";
import {
  estimatePlannerTimeTaken,
  hasAnyPlannerLogForDay,
} from "./workoutPlannerLog";

export type ReflowDaySnapshot = {
  day: number;
  split_name: string;
  focus_muscles: string[];
  is_rest_day: boolean;
  is_past: boolean;
  is_today: boolean;
  is_future: boolean;
  locked?: boolean;
  exercises: WorkoutExercise[];
  estimated_duration_min: number;
};

export type SmartReflowPatch = {
  day: number;
  exercises: WorkoutExercise[];
  estimated_duration_min: number;
};

function dayKey(plan: WorkoutPlanCurrent, day: number): string {
  return `${plan.year}-${String(plan.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function estimateDayDuration(exercises: WorkoutExercise[]): number {
  if (!exercises.length) return 0;
  const totalMin = exercises.reduce((sum, exercise) => sum + estimatePlannerTimeTaken(exercise).durationMin, 0);
  return Math.max(1, totalMin);
}

function exerciseNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function collectExerciseNamesOnFutureDays(
  plan: WorkoutPlanCurrent,
  snapshotByDay: Map<number, ReflowDaySnapshot>,
): Set<string> {
  const names = new Set<string>();
  for (const overview of plan.month_overview) {
    if (overview.is_past || overview.is_rest_day) continue;
    const snapshot = snapshotByDay.get(overview.day);
    if (!snapshot) continue;
    for (const exercise of snapshot.exercises) {
      const key = exerciseNameKey(exercise.name);
      if (key) names.add(key);
    }
  }
  return names;
}

function mergeUniqueExercises(
  base: WorkoutExercise[],
  additions: WorkoutExercise[],
  sourceDay: number | undefined,
  targetDay: number,
): { exercises: WorkoutExercise[]; added: WorkoutExercise[] } {
  const names = new Set(base.map((exercise) => exerciseNameKey(exercise.name)));
  const merged = [...base];
  const added: WorkoutExercise[] = [];
  for (const exercise of additions) {
    const key = exerciseNameKey(exercise.name);
    if (!key) continue;
    if (names.has(key)) {
      console.warn(
        `[smart-reflow] skipped duplicate "${exercise.name}" when reflowing from day ${sourceDay ?? "?"} into day ${targetDay}`,
      );
      continue;
    }
    const tagged = sourceDay ? tagExerciseForReflow(exercise, sourceDay) : exercise;
    merged.push(tagged);
    added.push(tagged);
    names.add(key);
  }
  return { exercises: merged, added };
}

function isEligibleTargetDay(
  plan: WorkoutPlanCurrent,
  snapshot: ReflowDaySnapshot,
  historyItems: WorkoutHistoryItem[],
): boolean {
  if (snapshot.is_past || snapshot.is_rest_day || snapshot.locked) return false;
  if (hasAnyPlannerLogForDay(historyItems, snapshot.exercises, dayKey(plan, snapshot.day))) return false;
  return remainingReflowSlots(snapshot.exercises.length) > 0;
}

export type SmartReflowBuildResult = {
  patches: SmartReflowPatch[];
  moves: ReflowMove[];
  assessment: ReflowTierAssessment;
};

export function buildSmartReflowPatches(
  plan: WorkoutPlanCurrent,
  daySnapshots: ReflowDaySnapshot[],
  historyItems: WorkoutHistoryItem[],
): SmartReflowBuildResult {
  const assessment = assessReflowTier(plan, daySnapshots, historyItems);
  if (
    assessment.tier === 0 ||
    assessment.tier === 3 ||
    assessment.entirePlanPeriodMissed
  ) {
    return { patches: [], moves: [], assessment };
  }

  const snapshotByDay = new Map(daySnapshots.map((snapshot) => [snapshot.day, snapshot]));
  const futureDayExerciseNames = collectExerciseNamesOnFutureDays(plan, snapshotByDay);
  const exercisesToMove = collectReflowCandidates(
    assessment,
    snapshotByDay,
    futureDayExerciseNames,
    exerciseNameKey,
  );

  if (!exercisesToMove.length) return { patches: [], moves: [], assessment };

  const targetDays = plan.month_overview
    .map((overview) => snapshotByDay.get(overview.day))
    .filter((snapshot): snapshot is ReflowDaySnapshot => Boolean(snapshot))
    .filter((snapshot) => isEligibleTargetDay(plan, snapshot, historyItems))
    .sort((a, b) => a.day - b.day);

  if (!targetDays.length) return { patches: [], moves: [], assessment };

  const workingExercises = new Map<number, WorkoutExercise[]>(
    targetDays.map((target) => [target.day, [...target.exercises]]),
  );
  const moves: ReflowMove[] = [];

  for (const item of exercisesToMove) {
    const key = exerciseNameKey(item.exercise.name);
    if (!key) continue;

    for (const target of targetDays) {
      const current = workingExercises.get(target.day);
      if (!current) continue;
      if (remainingReflowSlots(current.length) <= 0) continue;
      if (current.some((exercise) => exerciseNameKey(exercise.name) === key)) continue;
      if (!isExerciseCompatibleWithDay(item.exercise, target)) continue;

      const merged = mergeUniqueExercises(current, [item.exercise], item.sourceDay, target.day);
      if (!merged.added.length) continue;
      if (merged.exercises.length > REFLOW_MAX_EXERCISES_PER_DAY) continue;

      workingExercises.set(target.day, merged.exercises);
      for (const exercise of merged.added) {
        moves.push({
          name: exercise.name,
          sourceDay: item.sourceDay,
          targetDay: target.day,
        });
      }
      break;
    }
  }

  const patches: SmartReflowPatch[] = [];
  for (const target of targetDays) {
    const original = target.exercises;
    const updated = workingExercises.get(target.day);
    if (!updated || updated.length <= original.length) continue;
    patches.push({
      day: target.day,
      exercises: updated,
      estimated_duration_min: estimateDayDuration(updated),
    });
  }

  return { patches, moves, assessment };
}

export function daySnapshotFromPlanDay(
  day: WorkoutDayPlan,
  overview: WorkoutPlanCurrent["month_overview"][number],
): ReflowDaySnapshot {
  return {
    day: day.day,
    split_name: day.split_name || overview.split_name,
    focus_muscles: day.focus_muscles ?? [],
    is_rest_day: day.is_rest_day,
    is_past: overview.is_past,
    is_today: overview.is_today,
    is_future: overview.is_future,
    locked: day.locked,
    exercises: day.exercises ?? [],
    estimated_duration_min: day.estimated_duration_min ?? 0,
  };
}

export function daySnapshotFromMonthDay(
  day: {
    day: number;
    split_name?: string;
    focus_muscles?: string[];
    is_rest_day: boolean;
    is_past: boolean;
    is_today: boolean;
    is_future: boolean;
    locked?: boolean;
    exercises?: WorkoutExercise[];
    estimated_duration_min?: number;
  },
  overview: WorkoutPlanCurrent["month_overview"][number],
): ReflowDaySnapshot {
  return {
    day: day.day,
    split_name: day.split_name || overview.split_name,
    focus_muscles: day.focus_muscles ?? [],
    is_rest_day: day.is_rest_day,
    is_past: day.is_past,
    is_today: day.is_today,
    is_future: day.is_future,
    locked: day.locked,
    exercises: day.exercises ?? [],
    estimated_duration_min: day.estimated_duration_min ?? 0,
  };
}
