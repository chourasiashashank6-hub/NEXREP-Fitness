/**
 * Shared pose-session helpers used by LiveSessionTracker and WebView runtime (keep in sync).
 */
import type { PoseCalibration, ResolvedPoseSpec } from "../../data/aiTrainer/types";
import { MIN_LANDMARK_VISIBILITY } from "../../data/aiTrainer/types";
import type { Lm } from "./poseCheckEval";
import type { RepRule } from "./repStateMachine";

/** Phase machine and depth check share the same bottom angle ± this tolerance (deg). */
export const BOTTOM_ANGLE_TOLERANCE_DEG = 5;

const DEPTH_CALIBRATED_FAMILIES = new Set(["squat_lunge"]);

/**
 * Effective ROM bottom for rep counting and depth checks.
 * Spec `bottomAngle` is source of truth; calibration depth applies only to squat/lunge
 * (via `_depthTargetDeg` from remapSpecWithCalibration).
 */
export function resolveFormBottom(
  poseSpec: ResolvedPoseSpec & { _depthTargetDeg?: number },
  rule: RepRule,
  _calibration: PoseCalibration,
): number {
  // remapSpecWithCalibration bakes personalized squat depth into repRule.bottomAngle
  // (or _depthTargetDeg for family-default squats). Never fall back to mobility.depthTargetDeg
  // here — that leaked squat calibration into curls, bench, etc.
  if (poseSpec._depthTargetDeg != null) return poseSpec._depthTargetDeg;
  if (DEPTH_CALIBRATED_FAMILIES.has(poseSpec.family)) {
    return rule.bottomAngle ?? 95;
  }
  return rule.bottomAngle ?? 95;
}

/**
 * Bottom threshold for the rep phase machine — matches depth check definition.
 * Depth fail: kneeAngle > formBottom + BOTTOM_ANGLE_TOLERANCE_DEG at bottom phase.
 * Phase atBottom: angle <= formBottom + BOTTOM_ANGLE_TOLERANCE_DEG (normal) or >= formBottom - tol (inverted).
 */
export function resolveCountBottom(formBottom: number, _top: number, _inverted: boolean): number {
  return formBottom;
}

export function visOk(lm?: Lm | null, min = MIN_LANDMARK_VISIBILITY): boolean {
  return Boolean(lm && (lm.visibility ?? 0) >= min);
}

/** Torso + hip/knee landmarks visible — required before form scoring or rep UI. */
export function isBodyDetected(lms: Lm[], minVis = MIN_LANDMARK_VISIBILITY): boolean {
  const lS = lms[11];
  const rS = lms[12];
  const lH = lms[23];
  const rH = lms[24];
  const lK = lms[25];
  const rK = lms[26];
  const torsoOk =
    (visOk(lS, minVis) && visOk(lH, minVis)) || (visOk(rS, minVis) && visOk(rH, minVis));
  const legOk =
    (visOk(lH, minVis) && visOk(lK, minVis)) || (visOk(rH, minVis) && visOk(rK, minVis));
  return torsoOk && legOk;
}

/** Parse numeric cap from check rule strings (e.g. "torsoLean <= 20"). */
export function parseRuleNumber(rule: string, pattern: RegExp, fallback: number): number {
  const m = pattern.exec(rule);
  return m ? Number(m[1]) : fallback;
}

export function parseTorsoLeanCap(rule: string, fallback = 45): number {
  return parseRuleNumber(rule, /torsoLean\s*<=\s*(\d+(?:\.\d+)?)/i, fallback);
}

export function parseKneeCapFromRule(rule: string, fallback?: number): number | undefined {
  const m = /kneeAngle\s*>=\s*(\d+(?:\.\d+)?)/i.exec(rule);
  return m ? Number(m[1]) : fallback;
}

/** Parse elbow-flare shoulder displacement multiplier from rule (e.g. "0.07 * torsoLen"). */
export function parseTorsoLenMultiplier(rule: string, fallback: number): number {
  const m = /(\d+(?:\.\d+)?)\s*\*\s*torsoLen/i.exec(rule);
  return m ? Number(m[1]) : fallback;
}

/** Parse shrug rise cap multiplier (e.g. "0.04 * torsoLen"). */
export function parseShrugRiseCap(rule: string): number {
  return parseTorsoLenMultiplier(rule, 0.04);
}

/** Parse elbow-flare displacement multiplier; tighter when rule specifies tucked angle range. */
export function parseElbowFlareMultiplier(rule: string, fallback: number): number {
  const angleRange = /angle\s+(\d+)[\u2013-](\d+)/i.exec(rule);
  if (angleRange) {
    const max = Number(angleRange[2]);
    if (max <= 45) return 0.08;
    if (max <= 70) return 0.12;
  }
  return parseTorsoLenMultiplier(rule, fallback);
}

export function hipLockoutBand(cal: PoseCalibration): { min: number; max: number } {
  const standing = cal.standingKneeDeg ?? 168;
  return {
    min: Math.max(155, standing - 5),
    max: Math.max(190, standing + 22),
  };
}

/** Spine-neutral lean cap from T-pose baseline + margin. */
export function spineNeutralLeanCap(cal: PoseCalibration, marginDeg = 12): number {
  const baseline = cal.torsoLeanBaselineDeg ?? 8;
  return baseline + marginDeg;
}
