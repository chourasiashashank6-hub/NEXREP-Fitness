export const MIN_LANDMARK_VISIBILITY = 0.6;
export const EMA_ALPHA = 0.35;
export const PHASE_HYSTERESIS_FRAMES = 4;
export const ORIENTATION_SMOOTH_FRAMES = 12;

export type TrainerView = "front" | "side" | "front_45" | "unknown";
export type CheckSeverity = "critical" | "minor";
export type RepVerdict = "clean" | "flagged";

export type PoseCheck = {
  id: string;
  severity: CheckSeverity;
  rule: string;
  cue: string;
  view?: TrainerView;
  safety?: boolean;
  calibrated?: boolean;
};

export type FamilyTemplate = {
  view: TrainerView;
  repJoint: string | null;
  repRule: Record<string, unknown>;
  checks: PoseCheck[];
};

export type ExerciseSpecEntry = {
  id: string;
  family: string;
  machineProfile?: string;
  overrides?: Record<string, unknown>;
  aliases?: string[];
};

export type MachineProfile = {
  displayName: string;
  torsoBaselineDeg: number;
  torsoBaselineTolerance: number;
  cameraPlacement: {
    position: TrainerView | string;
    distanceM: number;
    heightHint: string;
    instructionKey: string;
  };
  reliableLandmarks: string[];
  occludedLandmarks: string[];
  disabledCheckIds: string[];
  notes?: string;
};

export type ResolvedPoseSpec = {
  id: string;
  family: string;
  view: TrainerView;
  repJoint: string | null;
  repRule: Record<string, unknown>;
  checks: PoseCheck[];
  machineProfileId: string | null;
  machineProfile: MachineProfile | null;
  note?: string;
};

export type PoseCalibration = {
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
  asymmetryFlags: string[];
  mobility: {
    depthTargetDeg: number;
    hingeMaxDeg: number;
    dorsiflexionProxyDeg: number;
  };
  confidenceByAngle: Record<string, number>;
  calibratedAt: string;
  version: number;
};

/** Population defaults when user skips calibration. */
export const DEFAULT_POSE_CALIBRATION: PoseCalibration = {
  torsoLen: 0.31,
  shoulderWidth: 0.19,
  hipWidth: 0.14,
  limbs: {
    upperArmL: 0.13,
    upperArmR: 0.13,
    thighL: 0.2,
    thighR: 0.2,
    shankL: 0.19,
    shankR: 0.19,
  },
  asymmetryFlags: [],
  mobility: {
    depthTargetDeg: 95,
    hingeMaxDeg: 95,
    dorsiflexionProxyDeg: 28,
  },
  confidenceByAngle: { "0": 0.9, "45": 0.85, "90": 0.8, "135": 0.85, "180": 0.9 },
  calibratedAt: "",
  version: 1,
};

export type AiRepEvent = {
  repIndex: number;
  verdict: RepVerdict;
  failedChecks: string[];
  tempo: { eccentricSec: number; concentricSec: number };
  peakAngles: Record<string, number>;
};

export type AiSetTracking = {
  exercise_name: string;
  set_number: number;
  reps_total: number;
  reps_clean: number;
  reps_flagged: number;
  form_score: number;
  issues: Record<string, number>;
  reps: AiRepEvent[];
};

export type AiTrackingPayload = {
  calibrated: boolean;
  used_population_defaults: boolean;
  sets: AiSetTracking[];
  issues_histogram: Record<string, number>;
  form_score_avg: number | null;
};
