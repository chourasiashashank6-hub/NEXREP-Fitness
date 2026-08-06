import {
  DEFAULT_POSE_CALIBRATION,
  type PoseCalibration,
} from "../data/aiTrainer/types";
import type { CalibrationStepId } from "../services/aiTrainer/mediaPipeCalibrationTemplate";

/** Partial calibration payload emitted by each WebView calibration step. */
export type CalibrationStepPartial = Partial<PoseCalibration> & {
  mobility?: Partial<PoseCalibration["mobility"]>;
};

/**
 * Personalized squat depth target from measured standing vs deepest squat knee angles.
 * Replaces the fixed 80–105° clamp with per-user ROM.
 */
export function computePersonalizedDepthTarget(
  squatMinKneeDeg: number,
  standingKneeDeg: number,
): number {
  if (!Number.isFinite(squatMinKneeDeg) || !Number.isFinite(standingKneeDeg)) {
    return DEFAULT_POSE_CALIBRATION.mobility.depthTargetDeg;
  }
  const rom = standingKneeDeg - squatMinKneeDeg;
  if (rom < 10) {
    return Math.max(70, squatMinKneeDeg);
  }
  const buffer = Math.min(6, rom * 0.1);
  const target = squatMinKneeDeg + buffer;
  const minDeg = Math.max(65, standingKneeDeg - 90);
  const maxDeg = standingKneeDeg - 12;
  return Math.round(Math.max(minDeg, Math.min(maxDeg, target)));
}

/** True when stored calibration looks corrupted (e.g. turn step overwrote squat depth). */
export function calibrationNeedsRecalibration(cal: PoseCalibration | null | undefined): boolean {
  if (!cal?.calibratedAt || !cal.torsoLen) return false;
  const standing = cal.standingKneeDeg ?? 168;
  const depth = cal.mobility?.depthTargetDeg ?? 95;
  const squatDepth = cal.squatDepthDeg;
  if (depth >= standing - 15) return true;
  if (depth >= 100 && (squatDepth == null || squatDepth >= standing - 15)) return true;
  if (squatDepth != null && squatDepth >= standing - 15) return true;
  return false;
}

/** Merge one calibration step into the running accumulator without cross-step contamination. */
export function mergeCalibrationStep(
  acc: CalibrationStepPartial,
  step: CalibrationStepId,
  partial: CalibrationStepPartial,
): CalibrationStepPartial {
  switch (step) {
    case "tpose":
      return {
        ...acc,
        torsoLen: partial.torsoLen ?? acc.torsoLen,
        shoulderWidth: partial.shoulderWidth ?? acc.shoulderWidth,
        hipWidth: partial.hipWidth ?? acc.hipWidth,
        limbs: { ...acc.limbs, ...partial.limbs },
        frontShoulderRatio: partial.frontShoulderRatio ?? acc.frontShoulderRatio,
        standingKneeDeg: partial.standingKneeDeg ?? acc.standingKneeDeg,
        torsoLeanBaselineDeg: partial.torsoLeanBaselineDeg ?? acc.torsoLeanBaselineDeg,
        asymmetryFlags: partial.asymmetryFlags ?? acc.asymmetryFlags,
      };
    case "squats": {
      const standing = acc.standingKneeDeg ?? partial.standingKneeDeg ?? 168;
      const squatRaw = partial.squatDepthDeg ?? partial.mobility?.depthTargetDeg ?? 95;
      const depthTarget = computePersonalizedDepthTarget(squatRaw, standing);
      return {
        ...acc,
        squatDepthDeg: squatRaw,
        mobility: {
          ...acc.mobility,
          depthTargetDeg: depthTarget,
          hingeMaxDeg:
            partial.mobility?.hingeMaxDeg ??
            acc.mobility?.hingeMaxDeg ??
            DEFAULT_POSE_CALIBRATION.mobility.hingeMaxDeg,
          dorsiflexionProxyDeg:
            partial.mobility?.dorsiflexionProxyDeg ??
            acc.mobility?.dorsiflexionProxyDeg ??
            DEFAULT_POSE_CALIBRATION.mobility.dorsiflexionProxyDeg,
        },
      };
    }
    case "turn":
      return {
        ...acc,
        confidenceByAngle: partial.confidenceByAngle ?? acc.confidenceByAngle,
      };
    default:
      return acc;
  }
}

/** Build the final persisted calibration from accumulated step partials. */
export function finalizeCalibration(acc: CalibrationStepPartial): PoseCalibration {
  const standing = acc.standingKneeDeg ?? 168;
  const squatRaw = acc.squatDepthDeg ?? acc.mobility?.depthTargetDeg;
  const depthTarget =
    squatRaw != null
      ? computePersonalizedDepthTarget(squatRaw, standing)
      : DEFAULT_POSE_CALIBRATION.mobility.depthTargetDeg;

  return {
    torsoLen: acc.torsoLen ?? DEFAULT_POSE_CALIBRATION.torsoLen,
    shoulderWidth: acc.shoulderWidth ?? DEFAULT_POSE_CALIBRATION.shoulderWidth,
    hipWidth: acc.hipWidth ?? DEFAULT_POSE_CALIBRATION.hipWidth,
    limbs: {
      ...DEFAULT_POSE_CALIBRATION.limbs,
      ...acc.limbs,
    },
    asymmetryFlags: acc.asymmetryFlags ?? [],
    frontShoulderRatio: acc.frontShoulderRatio,
    standingKneeDeg: acc.standingKneeDeg,
    torsoLeanBaselineDeg: acc.torsoLeanBaselineDeg,
    squatDepthDeg: acc.squatDepthDeg,
    mobility: {
      depthTargetDeg: depthTarget,
      hingeMaxDeg: acc.mobility?.hingeMaxDeg ?? DEFAULT_POSE_CALIBRATION.mobility.hingeMaxDeg,
      dorsiflexionProxyDeg:
        acc.mobility?.dorsiflexionProxyDeg ?? DEFAULT_POSE_CALIBRATION.mobility.dorsiflexionProxyDeg,
    },
    confidenceByAngle: {
      ...DEFAULT_POSE_CALIBRATION.confidenceByAngle,
      ...acc.confidenceByAngle,
    },
    calibratedAt: new Date().toISOString(),
    version: 2,
  };
}

/** Sanitize calibration loaded from profile/storage — flags stale data. */
export function sanitizeLoadedCalibration(
  raw: PoseCalibration | null | undefined,
): { calibration: PoseCalibration | null; needsRecalibration: boolean } {
  if (!raw || typeof raw.torsoLen !== "number") {
    return { calibration: null, needsRecalibration: false };
  }
  const needsRecalibration = calibrationNeedsRecalibration(raw);
  if (!needsRecalibration) {
    return { calibration: raw, needsRecalibration: false };
  }
  const standing = raw.standingKneeDeg ?? 168;
  const repaired: PoseCalibration = {
    ...raw,
    mobility: {
      ...raw.mobility,
      depthTargetDeg:
        raw.squatDepthDeg != null
          ? computePersonalizedDepthTarget(raw.squatDepthDeg, standing)
          : DEFAULT_POSE_CALIBRATION.mobility.depthTargetDeg,
    },
    version: 2,
  };
  if (calibrationNeedsRecalibration(repaired)) {
    return { calibration: raw, needsRecalibration: true };
  }
  return { calibration: repaired, needsRecalibration: true };
}
