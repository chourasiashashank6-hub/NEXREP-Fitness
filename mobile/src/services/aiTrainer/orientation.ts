import type { PoseCalibration, TrainerView } from "../../data/aiTrainer/types";
import { DEFAULT_POSE_CALIBRATION, ORIENTATION_SMOOTH_FRAMES } from "../../data/aiTrainer/types";

type Landmark = { x: number; y: number; visibility?: number };

export type OrientationSample = {
  orientation: TrainerView;
  apparentShoulderWidth: number;
  confidence: number;
};

/**
 * Classify camera-relative body orientation from Pose landmarks.
 * front: shoulder-width / torsoLen ≈ calibrated front ratio
 * side: apparent shoulder width < 45% of calibrated front width
 * front_45: between
 */
export function classifyOrientationFrame(
  landmarks: Landmark[],
  calibration?: PoseCalibration | null,
): OrientationSample {
  const cal = calibration?.torsoLen ? calibration : DEFAULT_POSE_CALIBRATION;
  const lS = landmarks[11];
  const rS = landmarks[12];
  const lH = landmarks[23];
  const rH = landmarks[24];
  if (!lS || !rS || !lH || !rH) {
    return { orientation: "unknown", apparentShoulderWidth: 0, confidence: 0 };
  }
  const lVis = lS.visibility ?? 0;
  const rVis = rS.visibility ?? 0;
  if (lVis < 0.35 && rVis < 0.35) {
    return { orientation: "unknown", apparentShoulderWidth: 0, confidence: 0 };
  }

  const apparent = Math.abs(lS.x - rS.x);
  const midShoulder = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
  const midHip = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2 };
  const torsoLen = Math.max(
    0.05,
    Math.hypot(midShoulder.x - midHip.x, midShoulder.y - midHip.y),
  );
  const ratio = apparent / torsoLen;
  const calRatio = cal.shoulderWidth / Math.max(0.05, cal.torsoLen);
  const relative = ratio / Math.max(0.01, calRatio);

  let orientation: TrainerView = "unknown";
  if (lVis >= 0.6 && rVis >= 0.6 && relative >= 0.8) {
    orientation = "front";
  } else if (apparent < cal.shoulderWidth * 0.45 || relative < 0.45) {
    orientation = "side";
  } else if (relative >= 0.45 && relative < 0.8) {
    orientation = "front_45";
  } else if (lVis >= 0.6 || rVis >= 0.6) {
    orientation = relative >= 0.65 ? "front" : "front_45";
  }

  return {
    orientation,
    apparentShoulderWidth: apparent,
    confidence: Math.min(lVis, rVis),
  };
}

export class OrientationSmoother {
  private buf: TrainerView[] = [];
  private readonly size: number;

  constructor(size = ORIENTATION_SMOOTH_FRAMES) {
    this.size = size;
  }

  push(sample: OrientationSample): TrainerView {
    this.buf.push(sample.orientation);
    if (this.buf.length > this.size) this.buf.shift();
    const counts: Record<string, number> = {};
    for (const o of this.buf) counts[o] = (counts[o] || 0) + 1;
    let best: TrainerView = "unknown";
    let n = 0;
    for (const [k, v] of Object.entries(counts)) {
      if (v > n) {
        n = v;
        best = k as TrainerView;
      }
    }
    return best;
  }

  reset() {
    this.buf = [];
  }
}

/** True when detected orientation is compatible with required view. */
export function orientationMatches(required: TrainerView | string, detected: TrainerView): boolean {
  if (detected === "unknown") return false;
  if (required === detected) return true;
  // front_45 accepts front or front_45
  if (required === "front_45" && (detected === "front" || detected === "front_45")) return true;
  if (required === "front" && detected === "front_45") return true;
  return false;
}
