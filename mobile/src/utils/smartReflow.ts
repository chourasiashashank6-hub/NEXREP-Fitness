import type { WorkoutHistoryItem } from "../api/workout";
import type { WorkoutDayPlan, WorkoutExercise, WorkoutPlanCurrent } from "../types/planner";
import { pickPriorityExercises } from "./exerciseCompoundLookup";
import { tagExerciseForReflow } from "./reflowExerciseMeta";
import {
  estimatePlannerTimeTaken,
  hasAnyPlannerLogForDay,
} from "./workoutPlannerLog";

export type ReflowDaySnapshot = {
  day: number;
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

function mergeUniqueExercises(
  base: WorkoutExercise[],
  additions: WorkoutExercise[],
  sourceDay?: number,
): WorkoutExercise[] {
  const names = new Set(base.map((exercise) => exercise.name.trim().toLowerCase()));
  const merged = [...base];
  for (const exercise of additions) {
    const key = exercise.name.trim().toLowerCase();
    if (!key || names.has(key)) continue;
    merged.push(sourceDay ? tagExerciseForReflow(exercise, sourceDay) : exercise);
    names.add(key);
  }
  return merged;
}

export function buildSmartReflowPatches(
  plan: WorkoutPlanCurrent,
  daySnapshots: ReflowDaySnapshot[],
  historyItems: WorkoutHistoryItem[],
): SmartReflowPatch[] {
  const snapshotByDay = new Map(daySnapshots.map((snapshot) => [snapshot.day, snapshot]));
  const exercisesToMove: Array<{ sourceDay: number; exercise: WorkoutExercise }> = [];

  for (const overview of plan.month_overview) {
    if (!overview.is_past || overview.is_rest_day) continue;
    const snapshot = snapshotByDay.get(overview.day);
    if (!snapshot || snapshot.exercises.length === 0) continue;
    const key = dayKey(plan, overview.day);
    if (hasAnyPlannerLogForDay(historyItems, snapshot.exercises, key)) continue;
    for (const exercise of pickPriorityExercises(snapshot.exercises, 2)) {
      exercisesToMove.push({ sourceDay: overview.day, exercise });
    }
  }

  if (!exercisesToMove.length) return [];

  const targetDays = plan.month_overview
    .filter((overview) => !overview.is_past && !overview.is_rest_day)
    .map((overview) => snapshotByDay.get(overview.day))
    .filter((snapshot): snapshot is ReflowDaySnapshot => Boolean(snapshot))
    .filter((snapshot) => !snapshot.locked)
    .filter((snapshot) => !hasAnyPlannerLogForDay(historyItems, snapshot.exercises, dayKey(plan, snapshot.day)))
    .slice(0, 2);

  if (!targetDays.length) return [];

  const patches: SmartReflowPatch[] = [];
  const queue = [...exercisesToMove];

  for (const target of targetDays) {
    const additions: Array<{ sourceDay: number; exercise: WorkoutExercise }> = [];
    while (queue.length > 0 && additions.length < 2) {
      additions.push(queue.shift()!);
    }
    if (!additions.length) break;
    let exercises = [...target.exercises];
    for (const item of additions) {
      exercises = mergeUniqueExercises(exercises, [item.exercise], item.sourceDay);
    }
    patches.push({
      day: target.day,
      exercises,
      estimated_duration_min: estimateDayDuration(exercises),
    });
  }

  return patches;
}

export function daySnapshotFromPlanDay(day: WorkoutDayPlan, overview: WorkoutPlanCurrent["month_overview"][number]): ReflowDaySnapshot {
  return {
    day: day.day,
    is_rest_day: day.is_rest_day,
    is_past: overview.is_past,
    is_today: overview.is_today,
    is_future: overview.is_future,
    locked: day.locked,
    exercises: day.exercises ?? [],
    estimated_duration_min: day.estimated_duration_min ?? 0,
  };
}
