/**
 * Pure calibration aggregation + turn-bucketing logic.
 * Keep mediaPipeCalibrationTemplate.ts in sync when changing algorithms.
 */
import {
  createPhaseMachine,
  emaAngle,
  stepPhaseMachine,
  type PhaseMachineState,
  type RepRule,
} from "../services/aiTrainer/repStateMachine";

export const CAL_CAPTURE_VIS_MIN = 0.6;
export const TURN_ANGLE_KEYS = ["0", "45", "90", "135", "180", "225", "270", "315"] as const;
export type TurnAngleKey = (typeof TURN_ANGLE_KEYS)[number];

export type CalibrationCaptureSample = {
  torsoLen: number;
  shoulderWidth: number;
  hipWidth: number;
  upperArmL: number;
  upperArmR: number;
  thighL: number;
  thighR: number;
  shankL: number;
  shankR: number;
  knee: number | null;
  hip: number | null;
  ankleFlex: number | null;
  ratio: number;
  torsoLean: number;
  lVis: number;
  noseX?: number;
  shoulderMidX?: number;
};

export function median(values: number[]): number {
  const vals = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
}

export function trimmedMean(values: number[], trimFraction = 0.15): number {
  const vals = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const trim = Math.floor(vals.length * trimFraction);
  const slice = vals.slice(trim, vals.length - trim || undefined);
  const use = slice.length ? slice : vals;
  return use.reduce((a, b) => a + b, 0) / use.length;
}

export function filterVisibleSamples(
  samples: CalibrationCaptureSample[],
  minVis = CAL_CAPTURE_VIS_MIN,
): CalibrationCaptureSample[] {
  return samples.filter((s) => (s.lVis ?? 0) >= minVis);
}

/** Map live pose to one of 8 yaw buckets using shoulder ratio + nose offset. */
export function estimateTurnAngleBucket(
  sample: Pick<CalibrationCaptureSample, "ratio" | "lVis" | "noseX" | "shoulderMidX" | "shoulderWidth">,
  frontShoulderRatio: number,
): TurnAngleKey | null {
  if ((sample.lVis ?? 0) < CAL_CAPTURE_VIS_MIN) return null;
  const calRatio = Math.max(0.01, frontShoulderRatio);
  const relative = sample.ratio / calRatio;
  if (!Number.isFinite(relative)) return null;

  const spread = Math.max(0.05, sample.shoulderWidth || 0.1);
  const noseOffset =
    sample.noseX != null && sample.shoulderMidX != null
      ? (sample.noseX - sample.shoulderMidX) / spread
      : 0;

  const sideFactor = 1 - Math.min(1, Math.max(0, (relative - 0.42) / 0.48));
  const angleRad = Math.atan2(noseOffset * (0.35 + sideFactor * 0.65), relative);
  let deg = ((angleRad * 180) / Math.PI + 360) % 360;
  const idx = Math.round(deg / 45) % 8;
  return TURN_ANGLE_KEYS[idx];
}

export type TurnProgress = {
  bucketsSeen: Set<TurnAngleKey>;
  progress01: number;
  hasFront: boolean;
  hasSide: boolean;
  complete: boolean;
};

export function computeTurnProgress(
  samples: CalibrationCaptureSample[],
  frontShoulderRatio: number,
): TurnProgress {
  const bucketsSeen = new Set<TurnAngleKey>();
  for (const s of filterVisibleSamples(samples)) {
    const b = estimateTurnAngleBucket(
      {
        ratio: s.ratio,
        lVis: s.lVis,
        noseX: s.noseX,
        shoulderMidX: s.shoulderMidX,
        shoulderWidth: s.shoulderWidth,
      },
      frontShoulderRatio,
    );
    if (b) bucketsSeen.add(b);
  }

  const frontBuckets: TurnAngleKey[] = ["0", "180", "315", "45"];
  const sideBuckets: TurnAngleKey[] = ["90", "270"];
  const hasFront = frontBuckets.some((b) => bucketsSeen.has(b));
  const hasSide = sideBuckets.some((b) => bucketsSeen.has(b));
  const progress01 = Math.min(1, bucketsSeen.size / TURN_ANGLE_KEYS.length);
  const complete =
    bucketsSeen.size >= 5 && hasFront && hasSide && filterVisibleSamples(samples).length >= 40;

  return { bucketsSeen, progress01, hasFront, hasSide, complete };
}

export function aggregateTurnConfidence(
  samples: CalibrationCaptureSample[],
  frontShoulderRatio: number,
): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const k of TURN_ANGLE_KEYS) {
    sums[k] = 0;
    counts[k] = 0;
  }
  for (const s of filterVisibleSamples(samples)) {
    const b = estimateTurnAngleBucket(
      {
        ratio: s.ratio,
        lVis: s.lVis,
        noseX: s.noseX,
        shoulderMidX: s.shoulderMidX,
        shoulderWidth: s.shoulderWidth,
      },
      frontShoulderRatio,
    );
    if (!b) continue;
    const conf = Math.min(1, Math.max(0, s.lVis ?? 0));
    sums[b] += conf;
    counts[b] += 1;
  }
  const confidenceByAngle: Record<string, number> = {};
  for (const k of TURN_ANGLE_KEYS) {
    confidenceByAngle[k] =
      counts[k] > 0 ? Math.round((sums[k] / counts[k]) * 100) / 100 : 0;
  }
  return confidenceByAngle;
}

export type TposeAggregate = {
  torsoLen: number;
  shoulderWidth: number;
  hipWidth: number;
  limbs: {
    upperArmL: number;
    upperArmR: number;
    thighL: number;
    thighR: number;
    shankL: number;
    shankR: number;
  };
  frontShoulderRatio: number;
  standingKneeDeg: number;
  torsoLeanBaselineDeg: number;
  asymmetryFlags: string[];
};

export function aggregateTpose(samples: CalibrationCaptureSample[]): TposeAggregate {
  const vis = filterVisibleSamples(samples);
  const torsoLen = median(vis.map((s) => s.torsoLen)) || 0.31;
  const shoulderWidth = median(vis.map((s) => s.shoulderWidth)) || 0.19;
  const knees = vis.map((s) => s.knee).filter((v): v is number => Number.isFinite(v!));
  const standingKnee = knees.length ? median(knees) : 168;
  const ratios = vis.map((s) => s.ratio).filter((v) => Number.isFinite(v) && v > 0);
  const frontRatio = ratios.length ? median(ratios) : shoulderWidth / Math.max(0.05, torsoLen);
  const leanVals = vis.map((s) => s.torsoLean).filter((v) => Number.isFinite(v));
  const torsoLeanBaseline = leanVals.length ? median(leanVals) : 8;
  const limbs = {
    upperArmL: median(vis.map((s) => s.upperArmL).filter((v) => v > 0)) || 0.13,
    upperArmR: median(vis.map((s) => s.upperArmR).filter((v) => v > 0)) || 0.13,
    thighL: median(vis.map((s) => s.thighL).filter((v) => v > 0)) || 0.2,
    thighR: median(vis.map((s) => s.thighR).filter((v) => v > 0)) || 0.2,
    shankL: median(vis.map((s) => s.shankL).filter((v) => v > 0)) || 0.19,
    shankR: median(vis.map((s) => s.shankR).filter((v) => v > 0)) || 0.19,
  };
  const dArm =
    Math.abs(limbs.upperArmL - limbs.upperArmR) / Math.max(limbs.upperArmL, 0.01);
  return {
    torsoLen,
    shoulderWidth,
    hipWidth: median(vis.map((s) => s.hipWidth)) || 0.14,
    limbs,
    frontShoulderRatio: frontRatio,
    standingKneeDeg: standingKnee,
    torsoLeanBaselineDeg: torsoLeanBaseline,
    asymmetryFlags: dArm > 0.05 ? ["upper_arm"] : [],
  };
}

/** squat_lunge family defaults — shared with workout repStateMachine. */
export const CALIBRATION_SQUAT_REP_RULE: RepRule = {
  topAngle: 160,
  bottomAngle: 95,
  minRepDurationSec: 1.2,
  direction: "normal",
};

export const SQUAT_MIN_REPS = 2;

export type SquatRepState = PhaseMachineState;

export function createSquatRepState(): SquatRepState {
  return createPhaseMachine();
}

export function stepSquatRep(
  state: SquatRepState,
  knee: number | null,
  nowMs = Date.now(),
): SquatRepState {
  if (knee == null || !Number.isFinite(knee)) return state;
  return stepPhaseMachine(state, knee, CALIBRATION_SQUAT_REP_RULE, nowMs).state;
}

export function stepCalibrationSquat(
  state: SquatRepState,
  knee: number | null,
  nowMs = Date.now(),
): { state: SquatRepState; repCompleted: boolean } {
  if (knee == null || !Number.isFinite(knee)) {
    return { state, repCompleted: false };
  }
  return stepPhaseMachine(state, knee, CALIBRATION_SQUAT_REP_RULE, nowMs);
}

export function shouldCaptureSquatDepthSample(
  state: SquatRepState,
  knee: number | null,
): boolean {
  if (knee == null || !Number.isFinite(knee)) return false;
  const inBottom = state.phase === "bottom" || state.phase === "ascending";
  return inBottom && knee < 150;
}

export { emaAngle };

export type SquatAggregate = {
  squatDepthDeg: number;
  mobility: {
    depthTargetDeg: number;
    hingeMaxDeg: number;
    dorsiflexionProxyDeg: number;
  };
};

export function aggregateSquats(samples: CalibrationCaptureSample[]): SquatAggregate {
  const vis = filterVisibleSamples(samples);
  const knees = vis.map((s) => s.knee).filter((v): v is number => Number.isFinite(v));
  const depthRaw = knees.length ? median(knees) : 95;
  const hips = vis.map((s) => s.hip).filter((v): v is number => Number.isFinite(v));
  const hingeRaw = hips.length ? trimmedMean(hips) : 95;
  const dorsi = vis.map((s) => s.ankleFlex).filter((v): v is number => Number.isFinite(v));
  const dorsiflex = dorsi.length ? trimmedMean(dorsi) : 28;
  const squatDepthDeg = Number.isFinite(depthRaw) ? depthRaw : 95;
  return {
    squatDepthDeg,
    mobility: {
      depthTargetDeg: squatDepthDeg,
      hingeMaxDeg: Math.max(70, Math.min(120, hingeRaw + 5)),
      dorsiflexionProxyDeg: Math.max(15, Math.min(45, dorsiflex)),
    },
  };
}
