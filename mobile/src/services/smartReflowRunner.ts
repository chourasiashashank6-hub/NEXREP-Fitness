import axios from "axios";
import { getWorkoutHistory } from "../api/workout";
import {
  applySmartReflow,
  fetchWorkoutPlanCurrent,
  fetchWorkoutPlanDay,
  fetchWorkoutPlanMonth,
} from "../api/workoutPlanner";
import { updateGamePlanCacheWorkoutPlan } from "../store/gamePlanCache";
import type { WorkoutPlanCurrent } from "../types/planner";
import {
  buildSmartReflowPatches,
  daySnapshotFromPlanDay,
  type ReflowDaySnapshot,
  type SmartReflowPatch,
} from "../utils/smartReflow";
import { extractReflowMoves, type ReflowMove } from "../utils/reflowNotifyMessage";

export type SmartReflowRunResult =
  | { status: "skipped"; reason: string }
  | { status: "noop" }
  | { status: "applied"; patchCount: number; appliedDays: number[]; plan: WorkoutPlanCurrent; moves: ReflowMove[]; patches: SmartReflowPatch[] };

function logReflowFailure(context: string, error: unknown) {
  if (axios.isAxiosError(error)) {
    console.warn(
      `[smart-reflow] ${context} failed:`,
      error.response?.status ?? "network",
      error.response?.data ?? error.message,
    );
    return;
  }
  console.warn(`[smart-reflow] ${context} failed:`, error);
}

/** Fetch only the day snapshots reflow may need — not every future day in the month. */
async function loadReflowSnapshots(currentPlan: WorkoutPlanCurrent): Promise<ReflowDaySnapshot[]> {
  const { days } = await fetchWorkoutPlanMonth();
  const snapshots: ReflowDaySnapshot[] = days
    .filter((day) => (day.exercises?.length ?? 0) > 0)
    .map((day) => ({
      day: day.day,
      is_rest_day: day.is_rest_day,
      is_past: day.is_past,
      is_today: day.is_today,
      is_future: day.is_future,
      locked: day.locked,
      exercises: day.exercises ?? [],
      estimated_duration_min: day.estimated_duration_min,
    }));

  const snapshotDays = new Set(snapshots.map((snapshot) => snapshot.day));
  const candidateDays = currentPlan.month_overview
    .filter((overview) => !overview.is_past && !overview.is_rest_day)
    .slice(0, 2)
    .map((overview) => overview.day)
    .filter((day) => !snapshotDays.has(day));

  if (!candidateDays.length) return snapshots;

  const fetched = await Promise.all(
    candidateDays.map(async (day) => {
      const overview = currentPlan.month_overview.find((entry) => entry.day === day);
      if (!overview) return null;
      try {
        const detail = await fetchWorkoutPlanDay(day);
        if (detail.locked) return null;
        return daySnapshotFromPlanDay(detail, overview);
      } catch (error) {
        logReflowFailure(`load day ${day}`, error);
        return null;
      }
    }),
  );

  return [...snapshots, ...fetched.filter((snapshot): snapshot is ReflowDaySnapshot => snapshot != null)];
}

export async function runSmartReflowDetection(currentPlan: WorkoutPlanCurrent): Promise<SmartReflowRunResult> {
  try {
    const [snapshots, { items }] = await Promise.all([
      loadReflowSnapshots(currentPlan),
      getWorkoutHistory(24 * 14),
    ]);

    const patches = buildSmartReflowPatches(currentPlan, snapshots, items);
    if (!patches.length) {
      return { status: "noop" };
    }

    const { applied_days: appliedDays = [] } = await applySmartReflow({
      plan_id: currentPlan.plan_id,
      patches,
    });
    const refreshed = await fetchWorkoutPlanCurrent();
    const plan = refreshed ?? currentPlan;
    updateGamePlanCacheWorkoutPlan(plan);
    const moves = extractReflowMoves(patches);
    return {
      status: "applied",
      patchCount: patches.length,
      appliedDays,
      plan,
      moves,
      patches,
    };
  } catch (error) {
    logReflowFailure("detection", error);
    return { status: "skipped", reason: "error" };
  }
}
