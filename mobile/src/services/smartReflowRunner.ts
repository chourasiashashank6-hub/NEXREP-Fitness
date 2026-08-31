/**
 * Smart reflow runner — client computes patch proposals; server applies and persists.
 *
 * Architecture: mobile `smartReflow.ts` detects missed workouts and builds patches;
 * `applySmartReflow` POSTs to the server, which validates via `plan_reflow_service.py`.
 * UI must treat reflow as final only after `applySmartReflow` succeeds (see `status: "applied"`).
 * Weekly compensation cron on the server is a separate scheduled path — not client-preview.
 */
import axios from "axios";
import { getWorkoutHistory } from "../api/workout";
import {
  applySmartReflow,
  fetchWorkoutPlanCurrent,
  fetchWorkoutPlanDay,
  fetchWorkoutPlanMonth,
  repairSmartReflow,
} from "../api/workoutPlanner";
import { updateGamePlanCacheWorkoutPlan } from "../store/gamePlanCache";
import type { WorkoutPlanCurrent } from "../types/planner";
import {
  buildSmartReflowPatches,
  daySnapshotFromMonthDay,
  daySnapshotFromPlanDay,
  type ReflowDaySnapshot,
  type SmartReflowPatch,
} from "../utils/smartReflow";
import { extractReflowMovesFromDays } from "../utils/reflowExerciseMeta";
import type { ReflowMove } from "../utils/reflowNotifyMessage";
import {
  acknowledgeTier3Prompt,
  buildReflowTierStateId,
  isTier3PromptAcknowledged,
  shouldSkipTier3ReflowScan,
} from "../utils/reflowTierState";
import type { ReflowTierAssessment } from "../utils/smartReflowTiers";

export type SmartReflowRunResult =
  | { status: "skipped"; reason: string }
  | { status: "noop" }
  | { status: "applied"; patchCount: number; appliedDays: number[]; plan: WorkoutPlanCurrent; moves: ReflowMove[]; patches: SmartReflowPatch[] }
  | { status: "tier3_prompt"; assessment: ReflowTierAssessment; stateId: string }
  | { status: "full_month_reset"; assessment: ReflowTierAssessment };

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

/** Load past source days from month data and fetch full detail for all future target days. */
async function loadReflowSnapshots(currentPlan: WorkoutPlanCurrent): Promise<ReflowDaySnapshot[]> {
  const { days: monthDays } = await fetchWorkoutPlanMonth();
  const overviewByDay = new Map(currentPlan.month_overview.map((overview) => [overview.day, overview]));
  const snapshots: ReflowDaySnapshot[] = [];
  const loadedDays = new Set<number>();

  for (const day of monthDays) {
    if (day.is_rest_day || day.is_future) continue;
    const overview = overviewByDay.get(day.day);
    if (!overview) continue;
    snapshots.push(daySnapshotFromMonthDay(day, overview));
    loadedDays.add(day.day);
  }

  const futureTargetDays = currentPlan.month_overview
    .filter((overview) => !overview.is_past && !overview.is_rest_day)
    .map((overview) => overview.day);

  const fetched = await Promise.all(
    futureTargetDays.map(async (day) => {
      if (loadedDays.has(day)) return null;
      const overview = overviewByDay.get(day);
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

export async function runSmartReflowDetection(
  currentPlan: WorkoutPlanCurrent,
  opts?: { skipRepair?: boolean },
): Promise<SmartReflowRunResult> {
  try {
    const stateId = buildReflowTierStateId(currentPlan.plan_id, currentPlan.month, currentPlan.year);
    if (await shouldSkipTier3ReflowScan(stateId)) {
      return { status: "skipped", reason: "tier3_acknowledged" };
    }

    if (!opts?.skipRepair) {
      await repairSmartReflow(currentPlan.plan_id).catch(() => undefined);
    }

    const [snapshots, { items }] = await Promise.all([
      loadReflowSnapshots(currentPlan),
      getWorkoutHistory(24 * 14),
    ]);

    const { patches, assessment } = buildSmartReflowPatches(currentPlan, snapshots, items);

    if (assessment.entirePlanPeriodMissed) {
      return { status: "full_month_reset", assessment };
    }

    if (assessment.tier === 3) {
      if (await isTier3PromptAcknowledged(stateId)) {
        return { status: "skipped", reason: "tier3_acknowledged" };
      }
      return { status: "tier3_prompt", assessment, stateId };
    }

    if (!patches.length) {
      return { status: "noop" };
    }

    const applyResult = await applySmartReflow({
      plan_id: currentPlan.plan_id,
      patches,
    });
    const appliedDays = applyResult.applied_days ?? [];
    if (!appliedDays.length) {
      return { status: "noop" };
    }

    let persistedDays = applyResult.days ?? [];
    if (!persistedDays.length) {
      persistedDays = await Promise.all(appliedDays.map((day) => fetchWorkoutPlanDay(day)));
    }
    const moves = extractReflowMovesFromDays(persistedDays);
    if (!moves.length) {
      return { status: "noop" };
    }

    const refreshed = await fetchWorkoutPlanCurrent();
    const plan = refreshed ?? currentPlan;
    updateGamePlanCacheWorkoutPlan(plan);
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

export async function markTier3ReflowDeclined(stateId: string, missedDayCount: number): Promise<void> {
  await acknowledgeTier3Prompt(stateId, "declined", missedDayCount);
}

export async function markTier3ReflowAccepted(stateId: string, missedDayCount: number): Promise<void> {
  await acknowledgeTier3Prompt(stateId, "accepted", missedDayCount);
}
