/**
 * Angle-driven rep phase machine (Part 5).
 * idle → descending → bottom → ascending → top (rep counted)
 * Respects inverted direction (curls) and minRepDurationSec.
 */

export type RepPhase = "idle" | "descending" | "bottom" | "ascending" | "top";

export type RepRule = {
  topAngle?: number;
  bottomAngle?: number;
  /** Calibrated depth for ROM-fraction check (may differ from looser count bottom). */
  formBottomAngle?: number;
  direction?: "normal" | "inverted";
  minRepDurationSec?: number;
  type?: string;
};

export type PhaseMachineState = {
  phase: RepPhase;
  pendingPhase: RepPhase | null;
  holdFrames: number;
  repCount: number;
  repStartedAt: number | null;
  lastVerdictAngles: { min: number; max: number };
};

const HYSTERESIS = 4;

export function createPhaseMachine(): PhaseMachineState {
  return {
    phase: "idle",
    pendingPhase: null,
    holdFrames: 0,
    repCount: 0,
    repStartedAt: null,
    lastVerdictAngles: { min: Infinity, max: -Infinity },
  };
}

function desiredPhase(phase: RepPhase, angle: number, rule: RepRule): RepPhase {
  const inverted = rule.direction === "inverted";
  const top = rule.topAngle ?? 160;
  const bottom = rule.bottomAngle ?? 90;

  const atBottom = inverted ? angle >= bottom - 5 : angle <= bottom + 5;
  const atTop = inverted ? angle <= top + 5 : angle >= top - 5;
  const goingDown = inverted ? angle > top + 10 : angle < top - 10;
  const goingUp = inverted ? angle < bottom - 10 : angle > bottom + 10;

  switch (phase) {
    case "idle":
    case "top":
      return goingDown && !atTop ? "descending" : phase;
    case "descending":
      return atBottom ? "bottom" : "descending";
    case "bottom":
      return goingUp ? "ascending" : "bottom";
    case "ascending":
      return atTop ? "top" : "ascending";
    default:
      return phase;
  }
}

export function stepPhaseMachine(
  state: PhaseMachineState,
  angle: number | null,
  rule: RepRule,
  nowMs = Date.now(),
): { state: PhaseMachineState; repCompleted: boolean } {
  if (rule.type === "timed_hold" || angle == null || !Number.isFinite(angle)) {
    return { state, repCompleted: false };
  }

  const next: PhaseMachineState = {
    ...state,
    lastVerdictAngles: {
      min: Math.min(state.lastVerdictAngles.min, angle),
      max: Math.max(state.lastVerdictAngles.max, angle),
    },
  };

  const desired = desiredPhase(next.phase, angle, rule);
  if (desired === next.phase) {
    next.pendingPhase = null;
    next.holdFrames = 0;
    return { state: next, repCompleted: false };
  }

  if (next.pendingPhase !== desired) {
    next.pendingPhase = desired;
    next.holdFrames = 1;
    return { state: next, repCompleted: false };
  }

  next.holdFrames += 1;
  if (next.holdFrames < HYSTERESIS) {
    return { state: next, repCompleted: false };
  }

  let repCompleted = false;
  if (desired === "descending" && (next.phase === "idle" || next.phase === "top")) {
    next.repStartedAt = nowMs;
    next.lastVerdictAngles = { min: angle, max: angle };
  }
  if (desired === "top" && next.phase === "ascending") {
    const minDur = (rule.minRepDurationSec ?? 0.8) * 1000;
    const dur = next.repStartedAt != null ? nowMs - next.repStartedAt : minDur;
    const top = rule.topAngle ?? 160;
    const formBottom = rule.formBottomAngle ?? rule.bottomAngle ?? 90;
    const excursion = next.lastVerdictAngles.max - next.lastVerdictAngles.min;
    const expected = Math.max(1, Math.abs(top - formBottom));
    // Reject jitter cycles that never traveled ~70% of expected ROM
    if (dur >= minDur && excursion >= 0.7 * expected) {
      next.repCount += 1;
      repCompleted = true;
    }
    next.repStartedAt = null;
  }

  next.phase = desired;
  next.pendingPhase = null;
  next.holdFrames = 0;
  return { state: next, repCompleted };
}

/** EMA smooth angle. */
export function emaAngle(prev: number | null, next: number, alpha = 0.35): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  return alpha * next + (1 - alpha) * prev;
}
