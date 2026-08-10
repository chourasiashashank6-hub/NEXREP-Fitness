/**
 * Shared live-session pose tracker for the web DOM MediaPipe path.
 * Mirrors the WebView session runtime (keep behaviors in sync).
 */
import type { PoseCalibration, ResolvedPoseSpec, TrainerView } from "../../data/aiTrainer/types";
import {
  classifyOrientationFrame,
  OrientationSmoother,
  orientationMatches,
} from "./orientation";
import {
  depthZoneBand,
  evaluatePoseChecks,
  extractKneeCap,
  jointAngle,
  repJointLandmarkIndex,
  romProgress01,
  type Lm,
} from "./poseCheckEval";
import {
  isBodyDetected,
  resolveCountBottom,
  resolveFormBottom,
} from "./poseRuntimeHelpers";
import {
  createPhaseMachine,
  emaAngle,
  stepPhaseMachine,
  type PhaseMachineState,
  type RepRule,
} from "./repStateMachine";

const IDLE_NOISE_DEG = 4;
const IDLE_WINDOW_MS = 1000;
const DEBUG_EVERY_MS = 500;
const RELAXED_MIN_VISIBILITY = 0.45;

export type LiveSessionFrameResult = {
  reps: number;
  formOk: boolean;
  correction: string;
  phase: string;
  bodyDetected: boolean;
  primaryAngle?: number | null;
  rom01?: number;
  inDepthZone?: boolean;
  zoneStart01?: number;
  zoneEnd01?: number;
  failingCheckIds?: string[];
  warnLandmarkIndices: number[];
  cueKey?: string | null;
  cuePriority?: "safety" | "correction" | "encouragement" | null;
  orientationOk?: boolean;
  requiredView?: string;
  detectedView?: string;
  repCompleted?: boolean;
  repVerdict?: "clean" | "flagged" | null;
  failedChecksThisRep?: string[];
  countingGated?: boolean;
  jointIndex: number | null;
};

const LM_NAME_TO_IDX: Record<string, number> = {
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
};

function asRepRule(rule: Record<string, unknown> | undefined): RepRule {
  return {
    topAngle: typeof rule?.topAngle === "number" ? rule.topAngle : 160,
    bottomAngle: typeof rule?.bottomAngle === "number" ? rule.bottomAngle : 95,
    direction: rule?.direction === "inverted" ? "inverted" : "normal",
    minRepDurationSec: typeof rule?.minRepDurationSec === "number" ? rule.minRepDurationSec : 1.2,
    type: typeof rule?.type === "string" ? rule.type : undefined,
  };
}

export class LiveSessionTracker {
  private phase: PhaseMachineState;
  private emaPrimary: number | null = null;
  private ori = new OrientationSmoother();
  private angleHistory: Array<{ t: number; a: number }> = [];
  private failedDuringRep: string[] = [];
  private countingPaused = false;
  private relaxGates = false;
  private lastDebugAt = 0;
  private debugEnabled: boolean;

  constructor(
    private poseSpec: ResolvedPoseSpec & { _depthTargetDeg?: number },
    private calibration: PoseCalibration,
    seedRepCount = 0,
    countingPaused = false,
    debugEnabled = typeof __DEV__ !== "undefined" ? __DEV__ : true,
    relaxGates = false,
  ) {
    this.phase = createPhaseMachine();
    this.phase.repCount = Math.max(0, seedRepCount);
    this.countingPaused = countingPaused;
    this.relaxGates = relaxGates;
    this.debugEnabled = debugEnabled;
  }

  setCountingPaused(paused: boolean) {
    if (paused && !this.countingPaused) {
      this.discardMidRep();
    }
    this.countingPaused = paused;
  }

  setSeedRepCount(n: number) {
    this.phase.repCount = Math.max(0, n);
  }

  private discardMidRep() {
    if (this.phase.phase !== "idle" && this.phase.phase !== "top") {
      const keep = this.phase.repCount;
      this.phase = createPhaseMachine();
      this.phase.repCount = keep;
      this.phase.phase = "idle";
      this.failedDuringRep = [];
    }
  }

  private hasRecentMotion(nowMs: number): boolean {
    this.angleHistory = this.angleHistory.filter((s) => nowMs - s.t <= IDLE_WINDOW_MS);
    if (this.angleHistory.length < 3) return false;
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.angleHistory) {
      min = Math.min(min, s.a);
      max = Math.max(max, s.a);
    }
    return max - min >= IDLE_NOISE_DEG;
  }

  process(landmarks: Lm[], nowMs = performance.now()): LiveSessionFrameResult {
    const repJoint = this.poseSpec.repJoint || "knee";
    const rule = asRepRule(this.poseSpec.repRule);
    const top = rule.topAngle ?? 160;
    const formBottom = resolveFormBottom(this.poseSpec, rule, this.calibration);
    const inverted = rule.direction === "inverted";
    const countBottom = resolveCountBottom(formBottom, top, inverted);
    const kneeCap = extractKneeCap(this.poseSpec.checks || []);

    const minVis = this.relaxGates ? RELAXED_MIN_VISIBILITY : undefined;
    const rawAng = jointAngle(landmarks, repJoint, minVis);
    const jointVisible = rawAng != null;
    this.emaPrimary = jointVisible ? emaAngle(this.emaPrimary, rawAng!) : this.emaPrimary;
    const primaryAngle = jointVisible ? this.emaPrimary : null;

    if (primaryAngle != null) {
      this.angleHistory.push({ t: nowMs, a: primaryAngle });
    }
    const recentMotion = this.hasRecentMotion(nowMs);

    const oriSample = classifyOrientationFrame(landmarks, this.calibration);
    const detectedView = this.ori.push(oriSample);
    const requiredView = (this.poseSpec.view || "side") as TrainerView;
    const orientationOk = this.relaxGates
      ? true
      : orientationMatches(requiredView, detectedView);

    const bodyDetected = isBodyDetected(landmarks, minVis);
    const gated = this.countingPaused || !orientationOk || !jointVisible || !bodyDetected;
    const atRestPhase = this.phase.phase === "idle" || this.phase.phase === "top";
    // Idle gate: no new descent without recent joint motion (kills lying-still phantom reps)
    const idleBlocked = this.relaxGates ? false : atRestPhase && !recentMotion;

    const occluded = new Set<number>();
    for (const name of this.poseSpec.machineProfile?.occludedLandmarks || []) {
      const idx = LM_NAME_TO_IDX[name];
      if (idx != null) occluded.add(idx);
    }

    let repCompleted = false;
    let repVerdict: "clean" | "flagged" | null = null;
    let failedChecksThisRep: string[] = [];

    if (!gated && !idleBlocked && primaryAngle != null) {
      const stepped = stepPhaseMachine(
        this.phase,
        primaryAngle,
        { ...rule, bottomAngle: countBottom, formBottomAngle: formBottom },
        nowMs,
      );
      this.phase = stepped.state;
      repCompleted = stepped.repCompleted;
    }

    const evald = evaluatePoseChecks(
      landmarks,
      this.phase.phase,
      this.poseSpec.checks || [],
      this.calibration,
      {
        depthTargetDeg: formBottom,
        kneeCap,
        detectedView,
        occluded,
      },
    );

    if (
      !gated &&
      (this.phase.phase === "descending" ||
        this.phase.phase === "bottom" ||
        this.phase.phase === "ascending")
    ) {
      for (const id of evald.failingIds) {
        if (!this.failedDuringRep.includes(id)) this.failedDuringRep.push(id);
      }
    }

    if (repCompleted) {
      const crit = (this.poseSpec.checks || []).some(
        (c) => c.severity === "critical" && this.failedDuringRep.includes(c.id),
      );
      repVerdict = crit ? "flagged" : "clean";
      failedChecksThisRep = this.failedDuringRep.slice();
      this.failedDuringRep = [];
    }

    const progress = romProgress01(primaryAngle, top, formBottom, inverted);
    const band = depthZoneBand(top, formBottom, formBottom);
    const inZone = progress >= band.start01 && progress <= band.end01;
    const formOk = !evald.criticalFailed && orientationOk && jointVisible && bodyDetected;
    const cueKey = !bodyDetected
      ? "step_into_frame"
      : !orientationOk
        ? requiredView === "side"
          ? "cue_turn_side"
          : "cue_turn_front"
        : evald.cueKey;
    const cuePriority = !orientationOk ? "safety" : evald.cuePriority;

    if (this.debugEnabled && nowMs - this.lastDebugAt >= DEBUG_EVERY_MS) {
      this.lastDebugAt = nowMs;
      const visCount = landmarks.filter((l) => (l.visibility ?? 0) >= 0.6).length;
      // Dev-only diagnostics when tracking appears stuck.
      console.log("[LiveSessionTracker]", {
        visCount,
        primaryAngle: primaryAngle != null ? Math.round(primaryAngle) : null,
        phase: this.phase.phase,
        reps: this.phase.repCount,
        recentMotion,
        orientationOk,
        detectedView,
        gated,
        rom01: Number(progress.toFixed(2)),
      });
    }

    return {
      reps: this.phase.repCount,
      formOk,
      correction: cueKey || "",
      phase: this.phase.phase,
      bodyDetected,
      primaryAngle,
      rom01: progress,
      inDepthZone: inZone,
      zoneStart01: band.start01,
      zoneEnd01: band.end01,
      failingCheckIds: evald.failingIds,
      warnLandmarkIndices: evald.warnLandmarkIndices,
      cueKey,
      cuePriority,
      orientationOk,
      requiredView,
      detectedView,
      repCompleted,
      repVerdict,
      failedChecksThisRep,
      countingGated: gated || idleBlocked,
      jointIndex: repJointLandmarkIndex(landmarks, repJoint, minVis),
    };
  }

  noBodyUpdate(): LiveSessionFrameResult {
    return {
      reps: this.phase.repCount,
      formOk: false,
      correction: "",
      phase: this.phase.phase,
      bodyDetected: false,
      orientationOk: false,
      countingGated: true,
      warnLandmarkIndices: [],
      jointIndex: null,
    };
  }
}
