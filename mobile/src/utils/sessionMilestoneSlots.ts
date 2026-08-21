import type { WorkoutPlanCurrent } from "../types/planner";
import { isPlannerLoggedWorkout, toLocalDateKey } from "./workoutPlannerLog";
import { isWorkoutRestDay } from "./workoutRestDay";
import { sanitizePlannerDayDetail } from "./sanitizePlannerDay";

export type PlannedExercise = { name: string };

export type SessionSlotFill = {
  key: string;
  label: string;
  filled: boolean;
  /** Manual log not in today's plan — render with distinct "extra" styling. */
  isExtra?: boolean;
};

export type SessionMilestoneHistoryItem = {
  id?: number;
  date?: string;
  exerciseName?: string;
  notes?: string | null;
};

export function sameExerciseName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * One box per exercise in today's planned workout.
 * Filled when a same-day workout log matches that exercise name
 * (same rule Workout Log uses for session count / Done).
 */
export function fillSessionSlots(
  plannedExercises: PlannedExercise[] | null | undefined,
  loggedExerciseNames: string[],
): SessionSlotFill[] {
  const plan = Array.isArray(plannedExercises) ? plannedExercises : [];
  return plan.map((ex, index) => {
    const name = String(ex?.name || "").trim() || `Exercise ${index + 1}`;
    const filled = loggedExerciseNames.some((logged) => sameExerciseName(logged, name));
    return {
      key: `session-ex-${index}-${name}`,
      label: name,
      filled,
    };
  });
}

/** Manual logs whose exercise name is not in today's plan — shown as bonus boxes after planned slots. */
export function appendExtraManualSessionSlots(
  plannedSlots: SessionSlotFill[],
  plannedExercises: PlannedExercise[],
  todayLogs: SessionMilestoneHistoryItem[],
): SessionSlotFill[] {
  const plan = Array.isArray(plannedExercises) ? plannedExercises : [];
  const extras = todayLogs.filter((item) => {
    if (isPlannerLoggedWorkout(item)) return false;
    const name = String(item.exerciseName || "").trim();
    if (!name) return false;
    return !plan.some((planned) => sameExerciseName(planned.name, name));
  });
  const extraSlots = extras.map((log, index) => ({
    key: `extra-session-${log.id ?? index}-${String(log.exerciseName).trim().toLowerCase()}`,
    label: String(log.exerciseName).trim(),
    filled: true,
    isExtra: true,
  }));
  return [...plannedSlots, ...extraSlots];
}

export function sessionMilestonePlannedTarget(items: SessionSlotFill[]): number {
  return items.filter((item) => !item.isExtra).length;
}

export function sessionMilestonePlannedFilled(items: SessionSlotFill[]): number {
  return items.filter((item) => !item.isExtra && item.filled).length;
}

/** Free tier: one milestone box per manually logged exercise (no planner plan slots). */
export function buildManualSessionMilestones(
  logs: Array<{ id: number; exerciseName: string }>,
): SessionSlotFill[] {
  return logs.map((log) => ({
    key: `manual-session-${log.id}`,
    label: String(log.exerciseName || "").trim() || "Exercise",
    filled: true,
  }));
}

/**
 * Canonical today session milestone slots — shared by Home and Workout Log.
 * Planner: one box per exercise in today's plan, filled by name match.
 * Free tier: one filled box per manual log (planner checkbox logs excluded).
 */
export function buildTodaySessionMilestoneItems(opts: {
  hasWorkoutPlannerAccess: boolean;
  todayWorkoutPlan: WorkoutPlanCurrent | null | undefined;
  workoutHistory: SessionMilestoneHistoryItem[];
  todayKey?: string | null;
}): SessionSlotFill[] {
  const todayKey = opts.todayKey ?? toLocalDateKey(new Date()) ?? "";
  const todayLogs = opts.workoutHistory.filter(
    (item) => item?.date && item.exerciseName && toLocalDateKey(item.date) === todayKey,
  );

  if (!opts.hasWorkoutPlannerAccess) {
    return buildManualSessionMilestones(
      todayLogs
        .filter((item) => !isPlannerLoggedWorkout(item))
        .map((item, index) => ({
          id: item.id ?? index,
          exerciseName: String(item.exerciseName),
        })),
    );
  }

  const todayPlanDay = opts.todayWorkoutPlan?.today ?? null;
  const sanitizedDay = todayPlanDay ? sanitizePlannerDayDetail(todayPlanDay) : null;
  const planned =
    sanitizedDay && !isWorkoutRestDay(sanitizedDay) ? sanitizedDay.exercises ?? [] : [];
  const plannedSlots = fillSessionSlots(
    planned,
    todayLogs.map((item) => String(item.exerciseName)),
  );
  return appendExtraManualSessionSlots(plannedSlots, planned, todayLogs);
}
