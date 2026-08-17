import axios from "axios";
import { getWorkoutHistory } from "../api/workout";
import {
  applySmartReflow,
  fetchWorkoutPlanCurrent,
  fetchWorkoutPlanDay,
  fetchWorkoutPlanMonth,
} from "../api/workoutPlanner";
import type { WorkoutPlanCurrent } from "../types/planner";
import {
  buildSmartReflowPatches,
  daySnapshotFromPlanDay,
  type ReflowDaySnapshot,
} from "../utils/smartReflow";

export type SmartReflowRunResult =
  | { status: "skipped"; reason: string }
  | { status: "noop" }
  | { status: "applied"; patchCount: number; plan: WorkoutPlanCurrent };

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

export async function runSmartReflowDetection(currentPlan: WorkoutPlanCurrent): Promise<SmartReflowRunResult> {
  try {
    const [{ days }, { items }] = await Promise.all([fetchWorkoutPlanMonth(), getWorkoutHistory(24 * 14)]);
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

    for (const overview of currentPlan.month_overview) {
      if (overview.is_past || overview.is_rest_day) continue;
      if (snapshots.some((snapshot) => snapshot.day === overview.day)) continue;
      try {
        const detail = await fetchWorkoutPlanDay(overview.day);
        if (detail.locked) continue;
        snapshots.push(daySnapshotFromPlanDay(detail, overview));
      } catch (error) {
        logReflowFailure(`load day ${overview.day}`, error);
      }
    }

    const patches = buildSmartReflowPatches(currentPlan, snapshots, items);
    if (!patches.length) {
      return { status: "noop" };
    }

    await applySmartReflow({ plan_id: currentPlan.plan_id, patches });
    const refreshed = await fetchWorkoutPlanCurrent();
    if (!refreshed) {
      return { status: "applied", patchCount: patches.length, plan: currentPlan };
    }
    return { status: "applied", patchCount: patches.length, plan: refreshed };
  } catch (error) {
    logReflowFailure("detection", error);
    return { status: "skipped", reason: "error" };
  }
}
