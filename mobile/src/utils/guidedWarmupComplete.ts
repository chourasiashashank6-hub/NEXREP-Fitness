import type { CompleteSessionPayload } from "../api/workoutSessions";
import type { GuidedWarmupSession } from "../store/guidedWarmupStore";
import { getPhaseRemainingSec } from "../store/guidedWarmupStore";
import type { WarmupPhase } from "./generatePreworkoutPlan";

export const GUIDED_WARMUP_EXERCISE_NAME = "Guided Warm-up";

function roundToNearest5(value: number): number {
  return Math.round(value / 5) * 5;
}

export function currentPhaseActualSec(session: GuidedWarmupSession): number {
  const phase = session.phases[session.current_phase_index];
  if (!phase) return 0;
  const remaining = getPhaseRemainingSec(session);
  return Math.max(0, phase.duration_sec - remaining);
}

/** Completed phase durations plus the in-progress phase (if any). */
export function finalizePhaseDurations(session: GuidedWarmupSession): number[] {
  const durations = [...session.phase_actual_durations_sec];
  if (session.status === "completed") return durations;
  const partial = currentPhaseActualSec(session);
  if (partial > 0) durations.push(partial);
  return durations;
}

export function estimateGuidedWarmupKcal(
  phases: WarmupPhase[],
  phaseDurationsSec: number[],
  weightKg: number,
): number {
  const raw = phaseDurationsSec.reduce((sum, durationSec, index) => {
    const phase = phases[index];
    if (!phase || durationSec <= 0) return sum;
    return sum + phase.met * weightKg * (durationSec / 3600);
  }, 0);
  return roundToNearest5(raw);
}

export function buildGuidedWarmupCompletePayload(
  session: GuidedWarmupSession,
  status: "completed" | "abandoned",
  phaseDurationsSec: number[],
): CompleteSessionPayload | null {
  if (phaseDurationsSec.every((d) => d <= 0)) return null;

  const endedAt = new Date();
  const setLogs: CompleteSessionPayload["set_logs"] = [];
  let cursor = new Date(session.active_started_at ?? session.started_at);
  let setNumber = 1;

  for (let i = 0; i < phaseDurationsSec.length; i++) {
    const durationSec = phaseDurationsSec[i];
    if (durationSec <= 0) continue;
    const startedAt = new Date(cursor);
    const completedAt = new Date(startedAt.getTime() + durationSec * 1000);
    setLogs.push({
      exercise_name: GUIDED_WARMUP_EXERCISE_NAME,
      set_number: setNumber,
      reps: 1,
      weight_kg: null,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      tracking_method: "manual",
    });
    setNumber += 1;
    cursor = completedAt;
  }

  if (!setLogs.length) return null;

  return {
    session_id: session.session_id,
    plan_day_id: session.plan_day_id,
    started_at: session.active_started_at ?? session.started_at,
    ended_at: endedAt.toISOString(),
    status,
    set_logs: setLogs,
    user_weight_kg: session.weight_kg,
    ai_tracking: null,
  };
}
