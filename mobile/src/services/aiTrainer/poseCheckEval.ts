/**
 * Landmark-based form checks + ROM helpers for live AI sessions.
 * Used by the web detect loop; WebView embeds an equivalent snippet.
 */
import type { PoseCheck, PoseCalibration, TrainerView } from "../../data/aiTrainer/types";
import { MIN_LANDMARK_VISIBILITY } from "../../data/aiTrainer/types";
import type { RepPhase } from "./repStateMachine";
import {
  BOTTOM_ANGLE_TOLERANCE_DEG,
  hipLockoutBand,
  parseElbowFlareMultiplier,
  parseKneeCapFromRule,
  parseShrugRiseCap,
  parseTorsoLeanCap,
  parseTorsoLenMultiplier,
  spineNeutralLeanCap,
} from "./poseRuntimeHelpers";

export type Lm = { x: number; y: number; visibility?: number };

export function angle3(a: Lm, b: Lm, c: Lm): number {
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;
  const dot = baX * bcX + baY * bcY;
  const cross = baX * bcY - baY * bcX;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

export function visOk(lm?: Lm | null, min = MIN_LANDMARK_VISIBILITY): boolean {
  return Boolean(lm && (lm.visibility ?? 0) >= min);
}

export function torsoMetrics(lms: Lm[]) {
  const lS = lms[11];
  const rS = lms[12];
  const lH = lms[23];
  const rH = lms[24];
  if (!visOk(lS) || !visOk(rS) || !visOk(lH) || !visOk(rH)) return null;
  const midS = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
  const midH = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2 };
  const torsoLen = Math.max(0.05, Math.hypot(midS.x - midH.x, midS.y - midH.y));
  const lean = Math.abs((Math.atan2(midS.x - midH.x, midH.y - midS.y) * 180) / Math.PI);
  return { midS, midH, torsoLen, lean };
}

/** Pick working knee for lunges / split squats / step-ups (more flexed knee). */
function workingKneeAngle(lms: Lm[], minVis = MIN_LANDMARK_VISIBILITY): number | null {
  const l =
    visOk(lms[23], minVis) && visOk(lms[25], minVis) && visOk(lms[27], minVis)
      ? angle3(lms[23], lms[25], lms[27])
      : null;
  const r =
    visOk(lms[24], minVis) && visOk(lms[26], minVis) && visOk(lms[28], minVis)
      ? angle3(lms[24], lms[26], lms[28])
      : null;
  if (l == null) return r;
  if (r == null) return l;
  return l <= r ? l : r;
}

function workingKneeIndex(lms: Lm[], minVis = MIN_LANDMARK_VISIBILITY): number | null {
  const lOk = visOk(lms[25], minVis);
  const rOk = visOk(lms[26], minVis);
  if (!lOk && !rOk) return null;
  if (!lOk) return 26;
  if (!rOk) return 25;
  const l =
    visOk(lms[23], minVis) && visOk(lms[27], minVis) ? angle3(lms[23], lms[25], lms[27]) : Infinity;
  const r =
    visOk(lms[24], minVis) && visOk(lms[28], minVis) ? angle3(lms[24], lms[26], lms[28]) : Infinity;
  return l <= r ? 25 : 26;
}

/** Return best-visibility side angle for hip–knee–ankle / etc. */
export function jointAngle(lms: Lm[], joint: string | null, minVis = MIN_LANDMARK_VISIBILITY): number | null {
  const pick = (la: number, lb: number, lc: number, ra: number, rb: number, rc: number) => {
    const L = visOk(lms[la], minVis) && visOk(lms[lb], minVis) && visOk(lms[lc], minVis) ? angle3(lms[la], lms[lb], lms[lc]) : null;
    const R = visOk(lms[ra], minVis) && visOk(lms[rb], minVis) && visOk(lms[rc], minVis) ? angle3(lms[ra], lms[rb], lms[rc]) : null;
    if (L == null) return R;
    if (R == null) return L;
    const lVis = Math.min(lms[la].visibility ?? 0, lms[lb].visibility ?? 0, lms[lc].visibility ?? 0);
    const rVis = Math.min(lms[ra].visibility ?? 0, lms[rb].visibility ?? 0, lms[rc].visibility ?? 0);
    return lVis >= rVis ? L : R;
  };
  switch (joint) {
    case "front_knee":
    case "lead_knee":
      return workingKneeAngle(lms, minVis);
    case "knee":
      return pick(23, 25, 27, 24, 26, 28);
    case "hip":
      return pick(11, 23, 25, 12, 24, 26);
    case "elbow":
      return pick(11, 13, 15, 12, 14, 16);
    case "shoulder":
    case "shoulder_abduction": {
      const L = visOk(lms[13], minVis) && visOk(lms[11], minVis) && visOk(lms[23], minVis) ? angle3(lms[13], lms[11], lms[23]) : null;
      const R = visOk(lms[14], minVis) && visOk(lms[12], minVis) && visOk(lms[24], minVis) ? angle3(lms[14], lms[12], lms[24]) : null;
      if (L == null) return R;
      if (R == null) return L;
      return ((L ?? 0) + (R ?? 0)) / 2;
    }
    default:
      return pick(23, 25, 27, 24, 26, 28);
  }
}

export function repJointLandmarkIndex(lms: Lm[], joint: string | null, minVis = MIN_LANDMARK_VISIBILITY): number | null {
  const better = (l: number, r: number) => {
    const lv = lms[l]?.visibility ?? 0;
    const rv = lms[r]?.visibility ?? 0;
    if (lv < minVis && rv < minVis) return null;
    return lv >= rv ? l : r;
  };
  switch (joint) {
    case "front_knee":
    case "lead_knee":
      return workingKneeIndex(lms, minVis);
    case "knee":
      return better(25, 26);
    case "hip":
      return better(23, 24);
    case "elbow":
      return better(13, 14);
    case "shoulder":
    case "shoulder_abduction":
      return better(11, 12);
    default:
      return better(25, 26);
  }
}

export function romProgress01(
  angle: number | null,
  topAngle: number,
  bottomAngle: number,
  inverted: boolean,
): number {
  if (angle == null || !Number.isFinite(angle)) return 0;
  if (inverted) {
    const span = Math.max(1, bottomAngle - topAngle);
    return Math.max(0, Math.min(1, (angle - topAngle) / span));
  }
  const span = Math.max(1, topAngle - bottomAngle);
  return Math.max(0, Math.min(1, (topAngle - angle) / span));
}

const WARN_BY_CHECK: Record<string, number[]> = {
  depth: [23, 24, 25, 26],
  torso_lean: [11, 12, 23, 24],
  knee_forward_drift: [25, 26, 31, 32],
  heel_lift: [27, 28, 29, 30],
  knee_valgus: [23, 24, 25, 26],
  tempo: [25, 26],
  spine_neutral: [11, 12, 23, 24],
  knee_bend_cap: [23, 24, 25, 26],
  lockout: [23, 24],
  bar_drift: [15, 16, 27, 28],
  rom_bottom: [13, 14],
  elbow_flare: [11, 12, 13, 14],
  asymmetry: [13, 14],
  lockout_overhead: [13, 14, 15, 16],
  lumbar_arch: [11, 12, 23, 24],
  torso_fixed: [11, 12, 23, 24],
  pull_depth: [13, 14],
  full_stretch: [13, 14],
  shrug: [11, 12],
  full_hang: [13, 14],
  pull_height: [0, 15, 16],
  kipping: [23, 24],
  elbow_pin: [13, 14],
  torso_swing: [11, 12, 23, 24],
  full_extension: [13, 14],
  upper_arm_fixed: [11, 12, 13, 14],
  raise_height: [11, 12, 15, 16],
  swing: [11, 12, 23, 24],
  elbow_bend: [13, 14],
};

export function extractKneeCap(checks: PoseCheck[]): number | undefined {
  for (const c of checks) {
    if (c.id !== "knee_bend_cap") continue;
    const parsed = parseKneeCapFromRule(c.rule);
    if (parsed != null) return parsed;
  }
  return undefined;
}

export type CheckEvalResult = {
  failingIds: string[];
  criticalFailed: boolean;
  cueKey: string | null;
  cuePriority: "safety" | "correction" | null;
  warnLandmarkIndices: number[];
};

function needs(lms: Lm[], idxs: number[]): boolean {
  return idxs.every((i) => visOk(lms[i]));
}

export function evaluatePoseChecks(
  lms: Lm[],
  phase: RepPhase | string,
  checks: PoseCheck[],
  cal: PoseCalibration,
  opts: {
    depthTargetDeg: number;
    kneeCap?: number;
    detectedView: TrainerView;
    occluded: Set<number>;
  },
): CheckEvalResult {
  const failing: string[] = [];
  const warn = new Set<number>();
  type CuePick = { key: string; priority: "safety" | "correction"; sev: number };
  const cueState: { best: CuePick | null } = { best: null };

  const tm = torsoMetrics(lms);
  const consider = (check: PoseCheck, fail: boolean, landmarks: number[]) => {
    if (!fail) return;
    for (const i of landmarks) {
      if (opts.occluded.has(i)) return; // skip silently
      if (!visOk(lms[i])) return;
    }
    failing.push(check.id);
    for (const i of WARN_BY_CHECK[check.id] || landmarks) warn.add(i);
    const sev = check.severity === "critical" ? 2 : 1;
    const priority: "safety" | "correction" = check.safety ? "safety" : "correction";
    const cur = cueState.best;
    if (!cur || sev > cur.sev || (sev === cur.sev && priority === "safety")) {
      cueState.best = { key: check.cue, priority, sev };
    }
  };

  for (const check of checks) {
    if (check.view && check.view !== "unknown") {
      // view-specific checks only when orientation roughly matches
      if (opts.detectedView === "unknown") continue;
      if (check.view === "side" && opts.detectedView !== "side") continue;
      if (check.view === "front" && opts.detectedView === "side") continue;
    }

    const kneeAngle = jointAngle(lms, "knee");
    const hipAngle = jointAngle(lms, "hip");
    const elbowAngle = jointAngle(lms, "elbow");
    const inBottom = phase === "bottom" || phase === "ascending";
    const depthTol = BOTTOM_ANGLE_TOLERANCE_DEG;

    switch (check.id) {
      case "depth": {
        if (!inBottom || kneeAngle == null) break;
        if (!needs(lms, [23, 25, 27]) && !needs(lms, [24, 26, 28])) break;
        consider(check, kneeAngle > opts.depthTargetDeg + depthTol, [25, 26, 23, 24]);
        break;
      }
      case "torso_lean":
      case "torso_swing":
      case "swing":
      case "lumbar_arch": {
        if (!tm) break;
        const defaultCap =
          check.id === "lumbar_arch" ? 15 : check.id.includes("swing") ? 10 : 45;
        const cap = parseTorsoLeanCap(check.rule, defaultCap);
        consider(check, tm.lean > cap, [11, 12, 23, 24]);
        break;
      }
      case "knee_forward_drift": {
        if (!tm || !inBottom) break;
        const side = visOk(lms[25]) && visOk(lms[31]) ? 0 : visOk(lms[26]) && visOk(lms[32]) ? 1 : -1;
        if (side < 0) break;
        const knee = side === 0 ? lms[25] : lms[26];
        const toe = side === 0 ? lms[31] : lms[32];
        const drift = knee.x - toe.x;
        consider(check, Math.abs(drift) > 0.12 * tm.torsoLen, [25, 26]);
        break;
      }
      case "heel_lift": {
        if (!tm) break;
        const a = visOk(lms[27]) ? lms[27] : visOk(lms[28]) ? lms[28] : null;
        const h = visOk(lms[29]) ? lms[29] : visOk(lms[30]) ? lms[30] : null;
        if (!a || !h) break;
        const cap = parseTorsoLenMultiplier(check.rule, 0.04);
        consider(check, Math.abs(a.y - h.y) > cap * tm.torsoLen, [27, 28, 29, 30]);
        break;
      }
      case "knee_valgus": {
        if (opts.detectedView === "side" || !tm) break;
        if (!needs(lms, [23, 25, 27]) && !needs(lms, [24, 26, 28])) break;
        const checkSide = (hip: Lm, knee: Lm, ankle: Lm) => {
          const mid = (hip.x + ankle.x) / 2;
          return Math.abs(knee.x - mid) > 0.06 * tm.torsoLen;
        };
        const badL = needs(lms, [23, 25, 27]) && checkSide(lms[23], lms[25], lms[27]);
        const badR = needs(lms, [24, 26, 28]) && checkSide(lms[24], lms[26], lms[28]);
        consider(check, badL || badR, [25, 26]);
        break;
      }
      case "spine_neutral": {
        if (!tm || hipAngle == null) break;
        if (phase === "idle" || phase === "top") break;
        consider(check, tm.lean > spineNeutralLeanCap(cal), [11, 12, 23, 24]);
        break;
      }
      case "knee_bend_cap": {
        if (kneeAngle == null) break;
        const cap = opts.kneeCap ?? parseKneeCapFromRule(check.rule, 150) ?? 150;
        consider(check, kneeAngle < cap, [25, 26]);
        break;
      }
      case "lockout": {
        if (phase !== "top" && phase !== "idle") break;
        if (hipAngle != null) {
          const band = hipLockoutBand(cal);
          consider(check, hipAngle < band.min || hipAngle > band.max, [23, 24]);
        } else if (elbowAngle != null) consider(check, elbowAngle < 160, [13, 14]);
        break;
      }
      case "rom_bottom":
      case "full_extension":
      case "full_stretch":
      case "full_hang": {
        if (elbowAngle == null) break;
        if (check.id === "rom_bottom") {
          if (!inBottom) break;
          consider(check, elbowAngle > 90, [13, 14]);
        } else {
          // static-pending-measurement: widen extension threshold until we capture per-user lockout
          if (phase !== "top" && phase !== "idle" && phase !== "bottom") break;
          consider(check, elbowAngle < 145, [13, 14]);
        }
        break;
      }
      case "elbow_flare":
      case "elbow_pin": {
        if (!tm || !visOk(lms[13]) || !visOk(lms[14]) || !visOk(lms[11]) || !visOk(lms[12])) break;
        const pinMul = parseTorsoLenMultiplier(check.rule, 0.07);
        const flareMul = parseElbowFlareMultiplier(check.rule, 0.12);
        const flare =
          Math.abs(lms[13].x - lms[11].x) > flareMul * tm.torsoLen ||
          Math.abs(lms[14].x - lms[12].x) > flareMul * tm.torsoLen;
        const pin =
          Math.abs(lms[13].x - lms[11].x) > pinMul * tm.torsoLen ||
          Math.abs(lms[14].x - lms[12].x) > pinMul * tm.torsoLen;
        consider(check, check.id === "elbow_pin" ? pin : flare, [13, 14]);
        break;
      }
      case "shrug": {
        if (!tm || !visOk(lms[11]) || !visOk(lms[12])) break;
        const ear = lms[7] || lms[8] || lms[0];
        if (!visOk(ear)) break;
        const rise = Math.min(lms[11].y, lms[12].y) - ear.y;
        const cap = parseShrugRiseCap(check.rule);
        consider(check, rise > -cap * tm.torsoLen, [11, 12]);
        break;
      }
      case "asymmetry": {
        if (!needs(lms, [13, 14, 15, 16, 11, 12])) break;
        const l = angle3(lms[11], lms[13], lms[15]);
        const r = angle3(lms[12], lms[14], lms[16]);
        consider(check, Math.abs(l - r) > 15, [13, 14]);
        break;
      }
      default:
        break;
    }
  }

  const criticalFailed = checks.some(
    (c) => c.severity === "critical" && failing.includes(c.id),
  );
  return {
    failingIds: failing,
    criticalFailed,
    cueKey: cueState.best?.key ?? null,
    cuePriority: cueState.best?.priority ?? null,
    warnLandmarkIndices: [...warn],
  };
}

export function depthZoneBand(
  topAngle: number,
  bottomAngle: number,
  depthTargetDeg: number,
): { start01: number; end01: number } {
  const span = Math.max(1, topAngle - bottomAngle);
  // Band around calibrated depth toward full ROM
  const target01 = Math.max(0, Math.min(1, (topAngle - depthTargetDeg) / span));
  return {
    start01: Math.max(0, target01 - 0.08),
    end01: Math.min(1, target01 + 0.14),
  };
}
