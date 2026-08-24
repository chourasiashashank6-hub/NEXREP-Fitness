/**
 * Run: npx --yes tsx src/utils/guidedWarmupComplete.test.ts
 */
import type { GuidedWarmupSession } from "../store/guidedWarmupStore";
import {
  buildGuidedWarmupCompletePayload,
  estimateCurrentPhaseKcalSoFar,
  estimateGuidedWarmupKcal,
  estimateWarmupKcalSoFar,
  finalizePhaseDurations,
  GUIDED_WARMUP_EXERCISE_NAME,
} from "./guidedWarmupComplete";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const phases = [
  {
    id: "walk-1",
    type: "walk" as const,
    label: "Walk",
    duration_sec: 300,
    speed_kmh: 5,
    incline_level: 5,
    met: 4.5,
  },
  {
    id: "run-1",
    type: "run" as const,
    label: "Run",
    duration_sec: 600,
    speed_kmh: 9,
    incline_level: 1,
    met: 9,
  },
];

const baseSession: GuidedWarmupSession = {
  session_id: "warmup-test-1",
  plan_day_id: "plan-1",
  plan_day_number: 1,
  day_label: "Aug 13",
  started_at: "2026-08-13T10:00:00.000Z",
  active_started_at: "2026-08-13T10:00:05.000Z",
  status: "completed",
  current_phase_index: 1,
  phase_ends_at: null,
  preparing_ends_at: null,
  paused_at: null,
  paused_remaining_sec: null,
  phase_actual_durations_sec: [300, 600],
  phases,
  estimated_kcal: 120,
  actual_kcal: null,
  weight_kg: 75,
};

const expectedKcal = Math.round(
  (4.5 * 75 * (300 / 3600) + 9 * 75 * (600 / 3600)) / 5,
) * 5;
assert(
  estimateGuidedWarmupKcal(phases, [300, 600], 75) === expectedKcal,
  "kcal estimate uses actual phase durations and MET",
);

const payload = buildGuidedWarmupCompletePayload(baseSession, "completed", [300, 600]);
assert(payload !== null, "payload built for completed session");
assert(payload!.set_logs.length === 2, "one set log per completed phase");
assert(payload!.set_logs[0].exercise_name === GUIDED_WARMUP_EXERCISE_NAME, "exercise name is Guided Warm-up");
assert(payload!.set_logs[0].weight_kg === null, "no weight for cardio warm-up");

const partialSession: GuidedWarmupSession = {
  ...baseSession,
  status: "active",
  phase_actual_durations_sec: [180],
  current_phase_index: 1,
  phase_ends_at: new Date(Date.now() + 400_000).toISOString(),
};
const partialDurations = finalizePhaseDurations(partialSession);
assert(partialDurations.length >= 1, "partial session keeps completed phase durations");

const activeSession: GuidedWarmupSession = {
  ...baseSession,
  status: "active",
  phase_actual_durations_sec: [180],
  current_phase_index: 1,
  phase_ends_at: new Date(Date.now() + 400_000).toISOString(),
};
const cumulativeKcal = estimateWarmupKcalSoFar(activeSession);
const phaseOnlyKcal = estimateCurrentPhaseKcalSoFar(activeSession);
assert(cumulativeKcal > phaseOnlyKcal, "cumulative warm-up kcal exceeds current phase only");
assert(phaseOnlyKcal >= 0, "current phase kcal is non-negative");

console.log("guidedWarmupComplete.test.ts: all assertions passed");
