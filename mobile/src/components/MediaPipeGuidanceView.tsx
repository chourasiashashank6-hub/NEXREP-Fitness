import { memo, useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import i18n from "../i18n";
import { LiveSessionTracker } from "../services/aiTrainer/liveSessionTracker";
import { WEBVIEW_SESSION_RUNTIME } from "../services/aiTrainer/webviewSessionRuntime";
import {
  DEFAULT_POSE_CALIBRATION,
  MIN_LANDMARK_VISIBILITY,
  type PoseCalibration,
  type ResolvedPoseSpec,
} from "../data/aiTrainer/types";

/** Keep in sync with `@mediapipe/tasks-vision` in package.json (verified on jsDelivr). */
const MEDIAPIPE_VERSION = "0.10.34";

export type MediaPipeTrackingUpdate = {
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
  warnLandmarkIndices?: number[];
  cueKey?: string | null;
  cuePriority?: "safety" | "correction" | "encouragement" | null;
  orientationOk?: boolean;
  requiredView?: string;
  detectedView?: string;
  repCompleted?: boolean;
  repVerdict?: "clean" | "flagged" | null;
  failedChecksThisRep?: string[];
  countingGated?: boolean;
};

export type MediaPipeGuidanceViewProps = {
  selectedExerciseName?: string;
  isActive?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
  /** Optional live rep / posture bridge for AI camera sessions. */
  onTrackingUpdate?: (update: MediaPipeTrackingUpdate) => void;
  /** Hide MediaPipe text chrome — parent renders its own HUD. */
  sessionMode?: boolean;
  /** Camera facing — presentation only; does not alter tracking math. */
  facingMode?: "user" | "environment";
  /** Resolved+calibrated poseSpec JSON for sessionMode engine. */
  poseSpec?: unknown;
  /** Effective pose calibration (or population defaults). */
  calibration?: unknown;
  /** Preserve counted reps across remount (pause/flip). */
  seedRepCount?: number;
  /** Briefly freeze counting (flip stabilize / orientation wait). */
  countingPaused?: boolean;
};

const MP_TEXT = {
  exerciseDetecting: i18n.t("mediaPipe.exerciseDetecting"),
  postureBlank: i18n.t("mediaPipe.postureBlank"),
  alignBody: i18n.t("mediaPipe.alignBody"),
  cardioBanner: i18n.t("mediaPipe.cardioBanner"),
  postureAwareness: i18n.t("mediaPipe.postureAwareness"),
  posture: i18n.t("mediaPipe.posture"),
  centred: i18n.t("mediaPipe.centred"),
  adjustPosition: i18n.t("mediaPipe.adjustPosition"),
  exercise: i18n.t("mediaPipe.exercise"),
  reps: i18n.t("mediaPipe.reps"),
  phase: i18n.t("mediaPipe.phase"),
  unknown: i18n.t("mediaPipe.unknown"),
  rightPosture: i18n.t("mediaPipe.rightPosture"),
  wrongPosture: i18n.t("mediaPipe.wrongPosture"),
};

type JointRule = {
  label: string;
  a: number;
  b: number;
  c: number;
  min: number;
  max: number;
};

type ExerciseRule = {
  label: string;
  joints: JointRule[];
};

type MovementConfig = {
  primaryJoint: "elbow" | "knee" | "hip" | "shoulder" | "ankle";
  downThreshold: number;
  upThreshold: number;
  downWhenAngleIsLower: boolean;
};

type MediaPipeExerciseRecord = {
  movementFamily?: string;
  exerciseName?: string;
  bodyPosture?: string;
  exerciseRule?: ExerciseRule | null;
  movementConfig?: {
    primaryJoint?: string | null;
    downThreshold?: number | null;
    upThreshold?: number | null;
    downWhenAngleIsLower?: boolean | null;
  } | null;
  trainerChecks?: {
    strict?: boolean;
    notes?: string;
  };
};

const normalizeExerciseName = (value?: string) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsAny = (name: string, terms: string[]) => terms.some((term) => name.includes(term));

let cachedMediaPipeRecords: MediaPipeExerciseRecord[] | null = null;

const getMediaPipeRecords = (): MediaPipeExerciseRecord[] => {
  if (cachedMediaPipeRecords) return cachedMediaPipeRecords;
  try {
    // Prefer records.length over the static totalExercises header so the count cannot drift.
    const data = require("../constants/MediaPipeExercisesData.json") as {
      records?: unknown[];
      totalExercises?: number; // TODO: derive from records.length (kept for documentation only)
    };
    cachedMediaPipeRecords = Array.isArray(data?.records) ? (data.records as MediaPipeExerciseRecord[]) : [];
  } catch {
    cachedMediaPipeRecords = [];
  }
  return cachedMediaPipeRecords;
};

const stripTrailingPlural = (normalized: string): string => {
  if (normalized.endsWith("s") && !normalized.endsWith("ss") && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
};

const findExerciseRecord = (selectedExerciseName?: string): MediaPipeExerciseRecord | null => {
  const normalizedTarget = normalizeExerciseName(selectedExerciseName);
  if (!normalizedTarget) return null;
  const records = getMediaPipeRecords();

  const exact = records.find((record) => normalizeExerciseName(record.exerciseName) === normalizedTarget);
  if (exact) return exact;

  // Plural / punctuation-ish exact retry (e.g. "Push Ups" → "Push-Up")
  const depluralized = stripTrailingPlural(normalizedTarget);
  if (depluralized !== normalizedTarget) {
    const pluralExact = records.find(
      (record) => normalizeExerciseName(record.exerciseName) === depluralized,
    );
    if (pluralExact) return pluralExact;
  }
  // Also try adding trailing "s" when the catalog uses plural form
  const pluralized = `${normalizedTarget}s`;
  const withS = records.find((record) => normalizeExerciseName(record.exerciseName) === pluralized);
  if (withS) return withS;

  const partials = records.filter((record) => {
    const candidate = normalizeExerciseName(record.exerciseName);
    return (
      Boolean(candidate) &&
      (candidate.includes(normalizedTarget) ||
        normalizedTarget.includes(candidate) ||
        candidate.includes(depluralized) ||
        depluralized.includes(candidate))
    );
  });
  const partial = partials.length
    ? partials.reduce((best, r) =>
        Math.abs(normalizeExerciseName(r.exerciseName).length - normalizedTarget.length) <
        Math.abs(normalizeExerciseName(best.exerciseName).length - normalizedTarget.length)
          ? r
          : best,
      )
    : null;

  if (partial && typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(
      `[MediaPipe] No exact match for "${selectedExerciseName}" — falling back to closest partial match "${partial.exerciseName}"`,
    );
  }
  return partial || null;
};

function toBodyPostureRequirement(selectedExerciseName?: string, record?: MediaPipeExerciseRecord | null): string {
  const postureValue = String(record?.bodyPosture || "").trim().toLowerCase();
  if (postureValue === "stand_side_facing")
    return "Body posture: Stand/position side-faced to camera";
  if (postureValue === "sit_front_facing")
    return "Body posture: Sit on a chair/bench, front-facing";
  if (postureValue === "stand_front_facing")
    return "Body posture: Stand still, front-facing";

  const name = normalizeExerciseName(selectedExerciseName);
  if (!name) return "Body posture: Stand still, front-facing";

  if (containsAny(name, [
    "seated cable row", "seated calf raise", "seated dumbbell press",
    "machine chest press", "machine row", "machine shoulder press",
    "machine standing", "pec deck", "lat pulldown", "leg extension",
    "leg curl", "leg press", "concentration curl", "preacher curl",
    "spider curl", "incline dumbbell curl", "assault bike",
    "barbell z-press", "z press",
  ])) return "Body posture: Sit on a chair/bench, front-facing";

  if (containsAny(name, [
    "squat", "lunge", "deadlift", "romanian", "rack pull",
    "hip thrust", "glute bridge", "kettlebell swing", "swing",
    "step up", "wall sit", "jump squat", "jump lunge",
    "bulgarian split", "push up", "push-up", "plank",
    "mountain climber", "burpee", "ab wheel", "bird dog",
    "sled push", "box jump", "depth jump", "pistol squat",
    "nordic", "dips", "inverted row", "renegade row",
  ])) return "Body posture: Stand/position side-faced to camera";

  return "Body posture: Stand still, front-facing";
}

function toExerciseRule(selectedExerciseName?: string, record?: MediaPipeExerciseRecord | null): ExerciseRule | null {
  if (record?.exerciseRule?.label && Array.isArray(record.exerciseRule.joints) && record.exerciseRule.joints.length > 0) {
    return record.exerciseRule;
  }
  const name = normalizeExerciseName(selectedExerciseName);
  if (!name) return null;

  if (containsAny(name, ["curl", "hammer", "preacher", "zottman", "spider", "reverse barbell curl", "barbell 21s"])) {
    return {
      label: "BICEP CURL",
      joints: [
        { label: "L Elbow", a: 11, b: 13, c: 15, min: 30, max: 160 },
        { label: "R Elbow", a: 12, b: 14, c: 16, min: 30, max: 160 },
      ],
    };
  }
  // ── Lunge (must come before squat) ──────────────────────────────────────
  if (
    containsAny(name, [
      "lunge", "split squat", "walking lunge", "jump lunge",
      "lateral lunge", "reverse lunge", "curtsy lunge",
    ])
  ) {
    return {
      label: "LUNGE",
      joints: [
        { label: "L Knee", a: 23, b: 25, c: 27, min: 80, max: 100 },
        { label: "R Knee", a: 24, b: 26, c: 28, min: 80, max: 100 },
        { label: "L Hip", a: 11, b: 23, c: 25, min: 55, max: 175 },
        { label: "R Hip", a: 12, b: 24, c: 26, min: 55, max: 175 },
      ],
    };
  }

  // ── Squat ────────────────────────────────────────────────────────────────
  if (
    containsAny(name, [
      "squat", "wall sit", "step up", "jump squat", "pistol",
      "zercher", "hack squat", "leg press", "goblet",
      "overhead squat", "sumo squat",
    ])
  ) {
    return {
      label: "SQUAT",
      joints: [
        { label: "L Knee", a: 23, b: 25, c: 27, min: 70, max: 110 },
        { label: "R Knee", a: 24, b: 26, c: 28, min: 70, max: 110 },
        { label: "L Hip", a: 11, b: 23, c: 25, min: 60, max: 120 },
        { label: "R Hip", a: 12, b: 24, c: 26, min: 60, max: 120 },
      ],
    };
  }
  if (
    containsAny(name, [
      "push up",
      "bench press",
      "chest press",
      "chest fly",
      "crossover",
      "pec deck",
      "dip",
      "floor press",
      "jm press",
      "close grip bench",
      "decline bench",
      "incline bench",
      "cable chest fly",
    ])
  ) {
    return {
      label: "PUSH-UP",
      joints: [
        { label: "L Elbow", a: 11, b: 13, c: 15, min: 75, max: 125 },
        { label: "R Elbow", a: 12, b: 14, c: 16, min: 75, max: 125 },
        { label: "L Shoulder", a: 13, b: 11, c: 23, min: 55, max: 120 },
        { label: "R Shoulder", a: 14, b: 12, c: 24, min: 55, max: 120 },
      ],
    };
  }
  if (
    containsAny(name, [
      "deadlift",
      "romanian deadlift",
      "rack pull",
      "hip thrust",
      "glute bridge",
      "swing",
      "good morning",
      "suitcase deadlift",
    ])
  ) {
    return {
      label: "HIP HINGE",
      joints: [
        { label: "L Knee", a: 23, b: 25, c: 27, min: 140, max: 178 },
        { label: "R Knee", a: 24, b: 26, c: 28, min: 140, max: 178 },
        { label: "L Hip", a: 11, b: 23, c: 25, min: 35, max: 110 },
        { label: "R Hip", a: 12, b: 24, c: 26, min: 35, max: 110 },
      ],
    };
  }
  if (
    containsAny(name, [
      "shoulder press",
      "arnold press",
      "overhead press",
      "push press",
      "thruster",
      "z press",
      "clean and press",
      "seated dumbbell press",
      "heavy overhead press",
      "explosive shoulder press",
    ])
  ) {
    return {
      label: name.includes("arnold") ? "ARNOLD PRESS" : "SHOULDER PRESS",
      joints: [
        { label: "L Elbow", a: 11, b: 13, c: 15, min: 80, max: 100 },
        { label: "R Elbow", a: 12, b: 14, c: 16, min: 80, max: 100 },
        { label: "L Shoulder", a: 13, b: 11, c: 23, min: 80, max: 120 },
        { label: "R Shoulder", a: 14, b: 12, c: 24, min: 80, max: 120 },
      ],
    };
  }
  if (
    containsAny(name, [
      "row",
      "pulldown",
      "pull up",
      "chin up",
      "muscle up",
      "lat ",
      "face pull",
      "rear delt",
      "upright row",
      "pendlay",
      "seal row",
      "meadows row",
      "t bar row",
      "yates row",
      "inverted row",
      "straight arm pulldown",
    ])
  ) {
    return {
      label: "PULL",
      joints: [
        { label: "L Elbow", a: 11, b: 13, c: 15, min: 45, max: 150 },
        { label: "R Elbow", a: 12, b: 14, c: 16, min: 45, max: 150 },
        { label: "L Shoulder", a: 13, b: 11, c: 23, min: 40, max: 120 },
        { label: "R Shoulder", a: 14, b: 12, c: 24, min: 40, max: 120 },
      ],
    };
  }
  if (
    containsAny(name, [
      "tricep",
      "triceps",
      "skull crusher",
      "rope pushdown",
      "overhead cable extension",
      "kickback",
      "weighted tricep dips",
      "close grip bench",
      "jm press",
    ])
  ) {
    return {
      label: "TRICEPS",
      joints: [
        { label: "L Elbow", a: 11, b: 13, c: 15, min: 55, max: 165 },
        { label: "R Elbow", a: 12, b: 14, c: 16, min: 55, max: 165 },
      ],
    };
  }
  if (containsAny(name, ["calf raise", "tibialis raise", "calf jump"])) {
    return {
      label: "CALVES",
      joints: [
        { label: "L Knee", a: 23, b: 25, c: 27, min: 150, max: 180 },
        { label: "R Knee", a: 24, b: 26, c: 28, min: 150, max: 180 },
        { label: "L Ankle", a: 25, b: 27, c: 29, min: 75, max: 130 },
        { label: "R Ankle", a: 26, b: 28, c: 30, min: 75, max: 130 },
      ],
    };
  }
  if (
    containsAny(name, [
      "plank",
      "dead bug",
      "bird dog",
      "hollow",
      "ab wheel",
      "crunch",
      "v up",
      "leg raise",
      "toes to bar",
      "russian twist",
      "windshield wiper",
      "dragon flag",
      "superman hold",
      "pallof press",
      "woodchop",
      "flutter kicks",
      "bicycle crunch",
    ])
  ) {
    return {
      label: "CORE",
      joints: [
        { label: "L Hip", a: 11, b: 23, c: 25, min: 45, max: 160 },
        { label: "R Hip", a: 12, b: 24, c: 26, min: 45, max: 160 },
        { label: "L Shoulder", a: 13, b: 11, c: 23, min: 40, max: 150 },
        { label: "R Shoulder", a: 14, b: 12, c: 24, min: 40, max: 150 },
      ],
    };
  }
  if (
    containsAny(name, [
      "burpee",
      "jumping jack",
      "mountain climber",
      "sprint",
      "stair running",
      "jump rope",
      "assault bike",
      "battle rope",
      "sled push",
      "man maker",
      "box jump",
      "depth jump",
      "tuck jump",
      "jump squat",
      "power clean",
      "clean",
      "snatch",
      "farmer",
      "carry",
      "windmill",
    ])
  ) {
    return {
      label: "DYNAMIC FULL BODY",
      joints: [
        { label: "L Knee", a: 23, b: 25, c: 27, min: 70, max: 175 },
        { label: "R Knee", a: 24, b: 26, c: 28, min: 70, max: 175 },
        { label: "L Elbow", a: 11, b: 13, c: 15, min: 35, max: 175 },
        { label: "R Elbow", a: 12, b: 14, c: 16, min: 35, max: 175 },
      ],
    };
  }
  return {
    label: selectedExerciseName?.toUpperCase() || "WORKOUT",
    joints: [
      { label: "L Knee", a: 23, b: 25, c: 27, min: 70, max: 175 },
      { label: "R Knee", a: 24, b: 26, c: 28, min: 70, max: 175 },
      { label: "L Elbow", a: 11, b: 13, c: 15, min: 35, max: 175 },
      { label: "R Elbow", a: 12, b: 14, c: 16, min: 35, max: 175 },
    ],
  };
}

function toMovementConfig(selectedExerciseName?: string, record?: MediaPipeExerciseRecord | null): MovementConfig | null {
  const rawPrimary = String(record?.movementConfig?.primaryJoint || "").trim().toLowerCase();
  const allowedPrimary = rawPrimary === "elbow" || rawPrimary === "knee" || rawPrimary === "hip" || rawPrimary === "shoulder" || rawPrimary === "ankle";
  if (
    allowedPrimary &&
    typeof record?.movementConfig?.downThreshold === "number" &&
    typeof record?.movementConfig?.upThreshold === "number" &&
    typeof record?.movementConfig?.downWhenAngleIsLower === "boolean"
  ) {
    return {
      primaryJoint: rawPrimary as MovementConfig["primaryJoint"],
      downThreshold: record.movementConfig.downThreshold,
      upThreshold: record.movementConfig.upThreshold,
      downWhenAngleIsLower: record.movementConfig.downWhenAngleIsLower,
    };
  }
  const name = normalizeExerciseName(selectedExerciseName);
  if (!name) return null;
  // Curl-like reps: down position = arm extended (higher elbow angle).
  if (containsAny(name, ["curl", "hammer", "preacher", "zottman", "spider", "barbell 21s"])) {
    return { primaryJoint: "elbow", downThreshold: 155, upThreshold: 70, downWhenAngleIsLower: false };
  }
  // Triceps-like reps: down position = elbow flexed.
  if (containsAny(name, ["tricep", "triceps", "pushdown", "kickback", "skull crusher"])) {
    return { primaryJoint: "elbow", downThreshold: 75, upThreshold: 150, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["squat", "lunge", "step up", "wall sit", "jump squat", "pistol", "leg press"])) {
    return { primaryJoint: "knee", downThreshold: 105, upThreshold: 155, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["deadlift", "romanian", "rack pull", "hip thrust", "glute bridge", "swing"])) {
    return { primaryJoint: "knee", downThreshold: 110, upThreshold: 165, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["push up", "bench press", "chest press", "dip", "chest fly", "pec deck"])) {
    return { primaryJoint: "elbow", downThreshold: 95, upThreshold: 155, downWhenAngleIsLower: true };
  }
  if (
    containsAny(name, [
      "shoulder press",
      "arnold press",
      "overhead press",
      "push press",
      "thruster",
      "z press",
      "clean and press",
    ])
  ) {
    return { primaryJoint: "elbow", downThreshold: 95, upThreshold: 150, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["row", "pulldown", "pull up", "chin up", "muscle up", "face pull", "rear delt fly"])) {
    return { primaryJoint: "elbow", downThreshold: 70, upThreshold: 150, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["calf raise", "tibialis raise", "calf jump"])) {
    return { primaryJoint: "knee", downThreshold: 150, upThreshold: 175, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["burpee", "mountain climber", "jumping jack", "tuck jump", "box jump", "depth jump"])) {
    return { primaryJoint: "knee", downThreshold: 95, upThreshold: 165, downWhenAngleIsLower: true };
  }
  return null;
}

function isCardioOrMobilityExercise(
  record: MediaPipeExerciseRecord | null,
  name?: string,
): boolean {
  if (record?.movementFamily === "cardio_or_mobility") return true;
  const n = (name || "").trim().toLowerCase();
  return [
    "treadmill", "cycling", "elliptical", "rowing machine",
    "stationary", "brisk walking", "outdoor cycling",
    "stair climbing", "skipping", "shadow boxing",
    "agility ladder", "lateral shuffle", "carioca",
    "hurdle drill", "sprint drill", "reactive cone",
    "resisted sprint", "wall drill", "cat-cow", "inchworm",
    "hip 90", "hip circle", "ankle rotation", "arm circle",
    "neck roll", "shoulder roll", "leg swing", "thoracic",
    "torso twist", "plank to downward", "band resisted hip",
    "banded pull-apart",
  ].some(kw => n.includes(kw));
}

function buildHtmlSource(
  exerciseRule: ExerciseRule | null,
  movementConfig: MovementConfig | null,
  trainerNote: string,
  isCardioOrMobility: boolean,
  sessionMode = false,
  movementFamily: string | null = null,
  facingMode: "user" | "environment" = "user",
  poseSpec: unknown = null,
  calibration: unknown = null,
  seedRepCount = 0,
  countingPaused = false,
): string {
  const ruleJson   = JSON.stringify(exerciseRule);
  const configJson = JSON.stringify(movementConfig);
  const noteJson   = JSON.stringify(trainerNote);
  const familyJson = JSON.stringify(movementFamily || "");
  const facingJson = JSON.stringify(facingMode);
  const poseSpecJson = JSON.stringify(poseSpec);
  const calJson = JSON.stringify(calibration);
  const mirrorCss = facingMode === "user" ? "transform:scaleX(-1)" : "transform:none";
  const chromeDisplay = sessionMode ? "none" : "block";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
    <style>
      html,body{margin:0;padding:0;width:100%;height:100%;background:#050b16;overflow:hidden}
      #root{position:relative;width:100%;height:100%}
      video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;${mirrorCss}}
      #badge{position:absolute;left:10px;top:10px;z-index:12;background:rgba(0,0,0,.65);
        color:#fff;border-radius:10px;padding:6px 10px;
        font:800 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:${chromeDisplay}}
      #posture{position:absolute;left:10px;top:40px;z-index:12;background:rgba(0,0,0,.65);
        color:#fff;border-radius:10px;padding:7px 10px;
        font:700 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:${chromeDisplay}}
      #notes{position:absolute;left:10px;top:70px;z-index:12;background:rgba(15,23,42,.78);
        color:#fff;border-radius:10px;padding:6px 10px;max-width:92%;
        font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:${chromeDisplay}}
      #hint{position:absolute;left:12px;right:12px;bottom:12px;z-index:10;
        border-radius:10px;padding:8px 10px;text-align:center;color:#fff;
        background:rgba(0,0,0,.55);
        font:700 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:${chromeDisplay}}
      #cardio-banner{position:absolute;left:0;right:0;bottom:0;z-index:20;
        background:rgba(15,23,42,.85);color:#fff;padding:14px 16px;text-align:center;
        font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        display:${isCardioOrMobility && !sessionMode ? "block" : "none"}}
    </style>
  </head>
  <body>
    <div id="root">
      <video id="video" autoplay playsinline muted></video>
      <canvas id="overlay"></canvas>
      ${
        sessionMode
          ? ""
          : `<div id="badge">${MP_TEXT.exerciseDetecting}</div>
      <div id="posture">${MP_TEXT.postureBlank}</div>
      <div id="notes"></div>
      <div id="hint">${MP_TEXT.alignBody}</div>
      <div id="cardio-banner">${MP_TEXT.cardioBanner}</div>`
      }
    </div>
    <script type="module">
      import{FilesetResolver,PoseLandmarker}from"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}";

      const EXERCISE_RULE=${ruleJson};
      const MOVEMENT_CONFIG=${configJson};
      const TRAINER_NOTE=${noteJson};
      const MOVEMENT_FAMILY=${familyJson};
      const IS_CARDIO=${isCardioOrMobility};
      const SESSION_MODE=${sessionMode ? "true" : "false"};
      const POSE_SPEC=${poseSpecJson};
      const CAL=${calJson};
      const SEED_REPS=${JSON.stringify(seedRepCount)};
      let COUNTING_PAUSED=${countingPaused ? "true" : "false"};
      ${WEBVIEW_SESSION_RUNTIME}

      const badgeEl=document.getElementById("badge");
      const postureEl=document.getElementById("posture");
      const notesEl=document.getElementById("notes");
      const hintEl=document.getElementById("hint");
      const video=document.getElementById("video");
      const canvas=document.getElementById("overlay");
      const ctx=canvas.getContext("2d");

      if(notesEl)notesEl.textContent=TRAINER_NOTE?"Notes: "+TRAINER_NOTE:"Notes: Maintain controlled movement";

      const setText=(el,text)=>{if(el)el.textContent=text};
      const setBg=(el,bg)=>{if(el)el.style.background=bg};

      const post=(type,payload={})=>{
        try{window.ReactNativeWebView?.postMessage(JSON.stringify({type,...payload}))}catch{}
      };

      let poseLandmarker=null,rafId=null,stream=null,lastVideoTime=-1;
      let repCount=0,phase="idle",reachedDown=false,prevLandmarks=null;
      let lastPostedReps=-1,lastPostedForm=null,lastPostedBody=null,lastTrackPostAt=0;
      const SMOOTH_ALPHA=SESSION_MODE?EMA_A:0.55;
      let sessionPhase=createPhase();
      sessionPhase.repCount=Math.max(0,Number(SEED_REPS)||0);
      let emaPrimary=null;
      let oriBuf=[];
      let lastWarnIdx=[];
      let failedDuringRep=[];
      let angleHist=[];
      const depthTarget=(POSE_SPEC&&POSE_SPEC._depthTargetDeg)||((CAL&&CAL.mobility&&CAL.mobility.depthTargetDeg)||95);
      const hasMotion=(now)=>{
        angleHist=angleHist.filter(s=>now-s.t<=1000);
        if(angleHist.length<3)return false;
        var mn=Infinity,mx=-Infinity; for(const s of angleHist){mn=Math.min(mn,s.a);mx=Math.max(mx,s.a)}
        return mx-mn>=4;
      };
      const emitTracking=(a,b,c,d,e)=>{
        // backward-compat + session object form
        const payload=typeof a==="object"&&a?a:{reps:a,formOk:b,correction:c||"",phase:d||"idle",bodyDetected:!!e};
        const now=Date.now();
        const changed=payload.reps!==lastPostedReps||payload.formOk!==lastPostedForm||payload.bodyDetected!==lastPostedBody||payload.repCompleted||payload.cueKey;
        if(!changed&&now-lastTrackPostAt<(SESSION_MODE?50:250))return;
        lastPostedReps=payload.reps;lastPostedForm=payload.formOk;lastPostedBody=payload.bodyDetected;lastTrackPostAt=now;
        post("tracking",payload);
      };

      const POSE_CONNECTIONS=[[11,12],[11,13],[13,15],[12,14],[14,16],
        [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[24,26],[26,28],[28,30]];
      const DISPLAY_LANDMARKS=[11,12,13,14,15,16,23,24,25,26,27,28,29,30];

      const resizeCanvas=()=>{
        const w=video.videoWidth||video.clientWidth||720;
        const h=video.videoHeight||video.clientHeight||1280;
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
      };

      const getVideoRect=()=>{
        const cw=canvas.width||720,ch=canvas.height||1280;
        const vw=video.videoWidth||720,vh=video.videoHeight||1280;
        const ca=cw/ch,va=vw/vh;
        if(va>ca){const h=ch,w=h*va;return{x:(cw-w)/2,y:0,width:w,height:h}}
        const w=cw,h=w/va;return{x:0,y:(ch-h)/2,width:w,height:h};
      };

      const toPixel=lm=>{const r=getVideoRect();return{x:r.x+lm.x*r.width,y:r.y+lm.y*r.height}};

      const smoothLandmarks=landmarks=>{
        if(!prevLandmarks||prevLandmarks.length!==landmarks.length){
          prevLandmarks=landmarks.map(l=>({...l}));return landmarks;
        }
        const s=landmarks.map((l,i)=>{const p=prevLandmarks[i];return{
          ...l,x:SMOOTH_ALPHA*l.x+(1-SMOOTH_ALPHA)*p.x,
          y:SMOOTH_ALPHA*l.y+(1-SMOOTH_ALPHA)*p.y,
          z:SMOOTH_ALPHA*l.z+(1-SMOOTH_ALPHA)*p.z,visibility:l.visibility
        }});prevLandmarks=s;return s;
      };

      const calcAngle=(a,b,c)=>{
        const bax=a.x-b.x,bay=a.y-b.y,bcx=c.x-b.x,bcy=c.y-b.y;
        return(Math.atan2(Math.abs(bax*bcy-bay*bcx),bax*bcx+bay*bcy)*180)/Math.PI;
      };

      const isCentered=lms=>{
        const xs=lms.map(l=>l.x),ys=lms.map(l=>l.y);
        const cx=(Math.min(...xs)+Math.max(...xs))/2;
        const cy=(Math.min(...ys)+Math.max(...ys))/2;
        return cx>0.32&&cx<0.68&&cy>0.22&&cy<0.78;
      };

      const getPrimaryAngle=landmarks=>{
        if(!MOVEMENT_CONFIG)return null;
        let l=NaN,r=NaN;const j=MOVEMENT_CONFIG.primaryJoint;
        if(j==="elbow"){
          l=landmarks[11]&&landmarks[13]&&landmarks[15]?calcAngle(landmarks[11],landmarks[13],landmarks[15]):NaN;
          r=landmarks[12]&&landmarks[14]&&landmarks[16]?calcAngle(landmarks[12],landmarks[14],landmarks[16]):NaN;
        }else if(j==="knee"){
          l=landmarks[23]&&landmarks[25]&&landmarks[27]?calcAngle(landmarks[23],landmarks[25],landmarks[27]):NaN;
          r=landmarks[24]&&landmarks[26]&&landmarks[28]?calcAngle(landmarks[24],landmarks[26],landmarks[28]):NaN;
        }else if(j==="hip"){
          l=landmarks[11]&&landmarks[23]&&landmarks[25]?calcAngle(landmarks[11],landmarks[23],landmarks[25]):NaN;
          r=landmarks[12]&&landmarks[24]&&landmarks[26]?calcAngle(landmarks[12],landmarks[24],landmarks[26]):NaN;
        }else if(j==="shoulder"){
          l=landmarks[13]&&landmarks[11]&&landmarks[23]?calcAngle(landmarks[13],landmarks[11],landmarks[23]):NaN;
          r=landmarks[14]&&landmarks[12]&&landmarks[24]?calcAngle(landmarks[14],landmarks[12],landmarks[24]):NaN;
        }else if(j==="ankle"){
          l=landmarks[25]&&landmarks[27]&&landmarks[29]?calcAngle(landmarks[25],landmarks[27],landmarks[29]):NaN;
          r=landmarks[26]&&landmarks[28]&&landmarks[30]?calcAngle(landmarks[26],landmarks[28],landmarks[30]):NaN;
        }
        const vals=[l,r].filter(v=>Number.isFinite(v));
        return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
      };

      const updateMovement=primaryAngle=>{
        if(!MOVEMENT_CONFIG||primaryAngle===null)return{phase,reps:repCount,dynamicOk:true};
        if(MOVEMENT_CONFIG.downWhenAngleIsLower){
          if(primaryAngle<=MOVEMENT_CONFIG.downThreshold){phase="down";reachedDown=true}
          else if(primaryAngle>=MOVEMENT_CONFIG.upThreshold){
            phase="up";if(reachedDown){repCount++;reachedDown=false}
          }
        }else{
          if(primaryAngle>=MOVEMENT_CONFIG.downThreshold){phase="down";reachedDown=true}
          else if(primaryAngle<=MOVEMENT_CONFIG.upThreshold){
            phase="up";if(reachedDown){repCount++;reachedDown=false}
          }
        }
        const dynamicOk=MOVEMENT_CONFIG.downWhenAngleIsLower
          ?(phase==="down"?primaryAngle<=MOVEMENT_CONFIG.downThreshold+20
            :phase==="up"?primaryAngle>=MOVEMENT_CONFIG.upThreshold-20:true)
          :(phase==="down"?primaryAngle>=MOVEMENT_CONFIG.downThreshold-20
            :phase==="up"?primaryAngle<=MOVEMENT_CONFIG.upThreshold+20:true);
        return{phase,reps:repCount,dynamicOk};
      };

      const evaluatePosture=(landmarks,primaryAngle,movementPhase)=>{
        if(!EXERCISE_RULE||!EXERCISE_RULE.joints.length)
          return{isCorrect:false,status:"Detecting...",correction:"Select exercise for form feedback"};
        const tol=12;
        const results=EXERCISE_RULE.joints.map(rule=>{
          const a=landmarks[rule.a],b=landmarks[rule.b],c=landmarks[rule.c];
          if(!a||!b||!c)return{label:rule.label,angle:NaN,ok:false};
          const angle=calcAngle(a,b,c);
          let{min,max}=rule;
          if(MOVEMENT_FAMILY==="overhead_press"&&
            primaryAngle!==null&&(rule.label.includes("Elbow")||rule.label.includes("Shoulder"))){
            if(MOVEMENT_CONFIG&&primaryAngle>=MOVEMENT_CONFIG.upThreshold-10){min=145;max=180}
            else if(MOVEMENT_CONFIG&&primaryAngle<=MOVEMENT_CONFIG.downThreshold+10){min=75;max=120}
            else{min=70;max=180}
          }
          if(MOVEMENT_FAMILY==="bicep_curl"&&primaryAngle!==null&&rule.label.includes("Elbow")){
            if(movementPhase==="down"){min=145;max=180}
            else if(movementPhase==="up"){min=15;max=85}
            else{min=15;max=180}
          }
          if(MOVEMENT_FAMILY==="squat_lunge"&&
            primaryAngle!==null&&rule.label.includes("Hip")){
            if(MOVEMENT_CONFIG&&primaryAngle<=MOVEMENT_CONFIG.downThreshold+15){min=55;max=130}
            else if(MOVEMENT_CONFIG&&primaryAngle>=MOVEMENT_CONFIG.upThreshold-15){min=145;max=180}
            else{min=55;max=180}
          }
          if(MOVEMENT_FAMILY==="hip_hinge"&&primaryAngle!==null&&rule.label.includes("Hip")){
            if(MOVEMENT_CONFIG&&primaryAngle<=MOVEMENT_CONFIG.downThreshold+15){min=35;max=90}
            else if(MOVEMENT_CONFIG&&primaryAngle>=MOVEMENT_CONFIG.upThreshold-15){min=155;max=180}
            else{min=35;max=180}
          }
          return{label:rule.label,angle,min,max,ok:angle>=min-tol&&angle<=max+tol};
        });
        const valid=results.filter(r=>Number.isFinite(r.angle));
        if(!valid.length)return{isCorrect:false,status:"Joints not visible",correction:"Step back so full body is visible"};
        let trainerChecksOk=true;
        let trainerCorrection="";
        if(MOVEMENT_FAMILY==="bicep_curl"){
          const lShoulder=landmarks[11],rShoulder=landmarks[12];
          const lElbow=landmarks[13],rElbow=landmarks[14];
          const lHip=landmarks[23],rHip=landmarks[24];
          const lKnee=landmarks[25],rKnee=landmarks[26];
          const lWrist=landmarks[15],rWrist=landmarks[16];
          const baseVisible=Boolean(lShoulder&&rShoulder&&lElbow&&rElbow&&lHip&&rHip&&lWrist&&rWrist)&&
            (lShoulder?.visibility??0)>0.45&&(rShoulder?.visibility??0)>0.45&&
            (lElbow?.visibility??0)>0.45&&(rElbow?.visibility??0)>0.45&&
            (lHip?.visibility??0)>0.45&&(rHip?.visibility??0)>0.45;
          if(!baseVisible){
            trainerChecksOk=false;
            trainerCorrection="Keep full upper body visible (shoulders, elbows, hips)";
          }
          if(trainerChecksOk&&(!lKnee||!rKnee||(lKnee.visibility??0)<0.35||(rKnee.visibility??0)<0.35)){
            trainerChecksOk=false;
            trainerCorrection="Stand farther back so knees are visible (no seated curls)";
          }
          if(trainerChecksOk&&lShoulder&&rShoulder&&lHip&&rHip&&lElbow&&rElbow){
            const shoulderWidth=Math.max(0.06,Math.abs(lShoulder.x-rShoulder.x));
            const torsoMidX=(lHip.x+rHip.x)/2;
            const shoulderMidX=(lShoulder.x+rShoulder.x)/2;
            const torsoLean=Math.abs(shoulderMidX-torsoMidX);
            const lElbowToHipX=Math.abs(lElbow.x-lHip.x);
            const rElbowToHipX=Math.abs(rElbow.x-rHip.x);
            const lUpperArmTravel=Math.abs(lShoulder.x-lElbow.x);
            const rUpperArmTravel=Math.abs(rShoulder.x-rElbow.x);
            if(torsoLean>shoulderWidth*0.22){
              trainerChecksOk=false;
              trainerCorrection="Keep torso upright - avoid swinging/leaning";
            }else if(lElbowToHipX>shoulderWidth*0.9||rElbowToHipX>shoulderWidth*0.9){
              trainerChecksOk=false;
              trainerCorrection="Keep elbows pinned close to your sides";
            }else if(lUpperArmTravel>shoulderWidth*0.75||rUpperArmTravel>shoulderWidth*0.75){
              trainerChecksOk=false;
              trainerCorrection="Do not flare elbows forward/outward";
            }else if((lElbow.y<lShoulder.y-0.02)||(rElbow.y<rShoulder.y-0.02)){
              trainerChecksOk=false;
              trainerCorrection="Keep shoulders down; do not shrug while curling";
            }
          }
        }
        const isCorrect=valid.every(r=>r.ok)&&trainerChecksOk;
        const firstWrong=valid.find(r=>!r.ok);
        let correction="Maintain current form";
        if(!trainerChecksOk&&trainerCorrection){
          correction=trainerCorrection;
        }else if(firstWrong){
          correction=firstWrong.angle<firstWrong.min
            ?firstWrong.label+": bend more ("+Math.round(firstWrong.angle)+"°)"
            :firstWrong.label+": straighten ("+Math.round(firstWrong.angle)+"°)";
        }
        const summary=valid.slice(0,2).map(r=>r.label+" "+Math.round(r.angle)+"° "+(r.ok?"✓":"✗")).join(" | ");
        return{isCorrect,status:isCorrect?${JSON.stringify(MP_TEXT.rightPosture)}:${JSON.stringify(MP_TEXT.wrongPosture)},
          detail:EXERCISE_RULE.label+" · "+summary,correction};
      };

      const MINT="#2DD4A7",WARN_ORANGE="#FF7A45",JOINT_STROKE="#052018";

      const drawFrame=ok=>{
        if(SESSION_MODE)return; // no debug crosshair in AI session chrome
        const rect=getVideoRect();
        ctx.save();
        ctx.strokeStyle=ok?"rgba(34,197,94,.95)":"rgba(239,68,68,.95)";ctx.lineWidth=3;
        const fw=rect.width*.62,fh=rect.height*.72;
        ctx.strokeRect(rect.x+(rect.width-fw)/2,rect.y+(rect.height-fh)/2,fw,fh);
        ctx.strokeStyle="rgba(255,255,255,.45)";ctx.lineWidth=1;ctx.beginPath();
        ctx.moveTo(rect.x+rect.width/2,rect.y);ctx.lineTo(rect.x+rect.width/2,rect.y+rect.height);
        ctx.moveTo(rect.x,rect.y+rect.height/2);ctx.lineTo(rect.x+rect.width,rect.y+rect.height/2);
        ctx.stroke();ctx.restore();
      };

      const visMin=SESSION_MODE?MIN_VIS:0.4;
      const warnSet=()=>{const s={}; for(const i of lastWarnIdx)s[i]=1; return s};

      const drawSkeleton=(landmarks,ok)=>{
        const ws=SESSION_MODE?warnSet():null;
        ctx.save();ctx.lineWidth=SESSION_MODE?4:2;ctx.lineCap="round";ctx.globalAlpha=0.95;
        for(const[ai,bi]of POSE_CONNECTIONS){
          const a=landmarks[ai],b=landmarks[bi];
          if(!a||!b||(a.visibility??1)<visMin||(b.visibility??1)<visMin)continue;
          const boneWarn=SESSION_MODE?!!(ws[ai]||ws[bi]):!ok;
          const col=SESSION_MODE?(boneWarn?WARN_ORANGE:MINT):(ok?"rgba(34,197,94,0.86)":"rgba(239,68,68,0.86)");
          const pa=toPixel(a),pb=toPixel(b);
          ctx.strokeStyle=col;ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();
        }
        ctx.restore();
      };

      const drawLandmarks=(landmarks,ok)=>{
        const ws=SESSION_MODE?warnSet():null;
        const stroke=SESSION_MODE?JOINT_STROKE:"rgba(15,23,42,0.9)";
        const pingT=(performance.now()%1000)/1000;
        ctx.save();
        if(SESSION_MODE){
          const nose=landmarks[0];
          if(nose&&(nose.visibility??1)>=visMin){
            const hp=toPixel(nose);
            ctx.beginPath();ctx.arc(hp.x,hp.y,15,0,Math.PI*2);
            ctx.strokeStyle=MINT;ctx.lineWidth=4;ctx.stroke();
          }
        }
        for(const idx of DISPLAY_LANDMARKS){
          const lm=landmarks[idx];
          if(!lm||(lm.visibility??1)<visMin)continue;
          const p=toPixel(lm);
          const jointWarn=SESSION_MODE?!!ws[idx]:!ok;
          const fill=SESSION_MODE?(jointWarn?WARN_ORANGE:MINT):(ok?"rgba(34,197,94,0.96)":"rgba(239,68,68,0.96)");
          if(jointWarn&&SESSION_MODE){
            const pingR=6+pingT*10;
            ctx.beginPath();ctx.arc(p.x,p.y,pingR,0,Math.PI*2);
            ctx.strokeStyle="rgba(255,122,69,"+(1-pingT).toFixed(3)+")";ctx.lineWidth=2;ctx.stroke();
          }
          const r=SESSION_MODE?(idx===25||idx===26||idx===23||idx===24?7:6):4.5;
          ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
          ctx.fillStyle=fill;ctx.fill();
          ctx.strokeStyle=stroke;ctx.lineWidth=SESSION_MODE?2:1.5;ctx.stroke();
        }
        ctx.restore();
      };

      const drawAngleTag=(landmarks,primaryAngle,ok,jointIndex)=>{
        if(!SESSION_MODE||primaryAngle==null)return;
        const mid=jointIndex!=null?jointIndex:(EXERCISE_RULE?.joints?.[0]?.b);
        if(mid==null)return;
        const lm=landmarks[mid];
        if(!lm||(lm.visibility??1)<visMin)return;
        const p=toPixel(lm);
        const warn=!ok||(lastWarnIdx.indexOf(mid)>=0);
        const label=Math.round(primaryAngle)+"°";
        const x=p.x+12,y=p.y-12,w=52,h=22;
        ctx.save();
        ctx.fillStyle="rgba(5,32,24,0.85)";
        ctx.strokeStyle=warn?WARN_ORANGE:"rgba(45,212,167,0.5)";
        ctx.lineWidth=1.5;
        if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x,y,w,h,7);ctx.fill();ctx.stroke();}
        else{ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}
        ctx.fillStyle=warn?WARN_ORANGE:MINT;
        ctx.font="700 12px -apple-system,BlinkMacSystemFont,sans-serif";
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(label,x+w/2,y+h/2+1);
        ctx.restore();
      };

      const smoothOri=(sample)=>{
        oriBuf.push(sample.orientation);
        if(oriBuf.length>12)oriBuf.shift();
        const counts={}; for(const o of oriBuf) counts[o]=(counts[o]||0)+1;
        let best="unknown",n=0; for(const k in counts){if(counts[k]>n){n=counts[k];best=k}}
        return best;
      };

      const runSessionFrame=(landmarks)=>{
        if(COUNTING_PAUSED){
          if(sessionPhase.phase!=="idle"&&sessionPhase.phase!=="top"){
            var keep=sessionPhase.repCount;
            sessionPhase=createPhase();
            sessionPhase.repCount=keep;
            sessionPhase.phase="idle";
            failedDuringRep=[];
          }
        }
        const repJoint=(POSE_SPEC&&POSE_SPEC.repJoint)||"knee";
        const rule=(POSE_SPEC&&POSE_SPEC.repRule)||{topAngle:160,bottomAngle:95,minRepDurationSec:1.2};
        const top=rule.topAngle!=null?rule.topAngle:160;
        const formBottom=depthTarget||(rule.bottomAngle!=null?rule.bottomAngle:95);
        const inverted=rule.direction==="inverted";
        // Looser bottom so shallow reps still complete a phase cycle; form checks use formBottom.
        const countBottom=inverted?formBottom:Math.max(formBottom, top-45);
        const rawAng=jointAngle(landmarks,repJoint);
        const jointVisible=rawAng!=null&&isFinite(rawAng);
        emaPrimary=jointVisible?ema(emaPrimary,rawAng):emaPrimary;
        const primaryAngle=jointVisible?emaPrimary:null;
        if(primaryAngle!=null)angleHist.push({t:performance.now(),a:primaryAngle});
        const recentMotion=hasMotion(performance.now());
        const sample=classifyOri(landmarks,CAL||{});
        const detectedView=smoothOri(sample);
        const requiredView=(POSE_SPEC&&POSE_SPEC.view)||"side";
        const orientationOk=oriMatch(requiredView,detectedView);
        const gated=COUNTING_PAUSED||!orientationOk||!jointVisible;
        const atRest=sessionPhase.phase==="idle"||sessionPhase.phase==="top";
        const idleBlocked=atRest&&!recentMotion;
        const occluded={};
        if(POSE_SPEC&&POSE_SPEC.machineProfile&&POSE_SPEC.machineProfile.occludedLandmarks){
          const nameIdx={nose:0,left_eye:2,right_eye:5,left_ear:7,right_ear:8,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,left_wrist:15,right_wrist:16,left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28,left_heel:29,right_heel:30,left_foot_index:31,right_foot_index:32};
          const names=POSE_SPEC.machineProfile.occludedLandmarks;
          for(var oi=0;oi<names.length;oi++){var idx=nameIdx[names[oi]]; if(idx!=null)occluded[idx]=1}
        }
        let repCompleted=false;
        let repVerdict=null;
        let failedChecksThisRep=[];
        if(!gated&&!idleBlocked&&primaryAngle!=null){
          const stepped=stepPhase(sessionPhase,primaryAngle,{...rule,bottomAngle:countBottom,formBottomAngle:formBottom},performance.now());
          sessionPhase=stepped.state;
          repCompleted=stepped.repCompleted;
          phase=sessionPhase.phase;
          repCount=sessionPhase.repCount;
        } else {
          phase=sessionPhase.phase;
          repCount=sessionPhase.repCount;
        }
        const checks=(POSE_SPEC&&POSE_SPEC.checks)||[];
        const evald=evaluateChecks(landmarks,phase,checks,formBottom,detectedView,occluded);
        lastWarnIdx=evald.warnLandmarkIndices||[];
        if(!gated && (phase==="descending"||phase==="bottom"||phase==="ascending")){
          for(const id of evald.failingIds){
            if(failedDuringRep.indexOf(id)<0) failedDuringRep.push(id);
          }
          sessionPhase.failedDuringRep=failedDuringRep;
        }
        if(repCompleted){
          const crit=checks.some(c=>c.severity==="critical"&&failedDuringRep.indexOf(c.id)>=0);
          repVerdict=crit?"flagged":"clean";
          failedChecksThisRep=failedDuringRep.slice();
          failedDuringRep=[];
          sessionPhase.failedDuringRep=[];
        }
        const progress=rom01(primaryAngle,top,formBottom,inverted);
        const span=Math.max(1,top-formBottom);
        const target01=Math.max(0,Math.min(1,(top-formBottom)/span));
        const zoneStart=Math.max(0,target01-0.08), zoneEnd=Math.min(1,target01+0.14);
        const inZone=progress>=zoneStart&&progress<=zoneEnd;
        const formOk=!evald.criticalFailed&&orientationOk;
        const cueKey=!orientationOk?(requiredView==="side"?"cue_turn_side":"cue_turn_front"):evald.cueKey;
        const cuePriority=!orientationOk?"safety":evald.cuePriority;
        const jIdx=jointIdx(landmarks,repJoint);
        drawSkeleton(landmarks,formOk);
        drawLandmarks(landmarks,formOk);
        drawAngleTag(landmarks,primaryAngle,formOk,jIdx);
        emitTracking({
          reps:repCount,formOk,correction:cueKey||"",phase,bodyDetected:true,
          primaryAngle, rom01:progress, inDepthZone:inZone, zoneStart01:zoneStart, zoneEnd01:zoneEnd,
          failingCheckIds:evald.failingIds, warnLandmarkIndices:lastWarnIdx,
          cueKey, cuePriority, orientationOk, requiredView, detectedView,
          repCompleted, repVerdict, failedChecksThisRep, countingGated:gated||idleBlocked
        });
      };

      const detectLoop=()=>{
        if(!poseLandmarker)return;
        if(video.currentTime===lastVideoTime){rafId=requestAnimationFrame(detectLoop);return}
        lastVideoTime=video.currentTime;
        resizeCanvas();
        const result=poseLandmarker.detectForVideo(video,performance.now());
        ctx.clearRect(0,0,canvas.width,canvas.height);
        const rawLm=result?.landmarks?.[0];
        const landmarks=rawLm?.length?smoothLandmarks(rawLm):null;

        if(landmarks?.length){
          if(SESSION_MODE&&POSE_SPEC){runSessionFrame(landmarks);rafId=requestAnimationFrame(detectLoop);return}
          const centered=isCentered(landmarks);
          if(IS_CARDIO){
            drawFrame(centered);
            drawSkeleton(landmarks,centered);
            drawLandmarks(landmarks,centered);
            setText(badgeEl,${JSON.stringify(MP_TEXT.postureAwareness)});
            setText(postureEl,${JSON.stringify(MP_TEXT.posture)}+": "+(centered?${JSON.stringify(MP_TEXT.centred)}:${JSON.stringify(MP_TEXT.adjustPosition)}));
            setBg(postureEl,centered?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            setText(hintEl,centered?${JSON.stringify(i18n.t("mediaPipe.keepBodyFrame"))}:${JSON.stringify(i18n.t("mediaPipe.centreBody"))});
            setBg(hintEl,centered?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            emitTracking(0,centered,"", "idle", true);
          }else{
            const primaryAngle=getPrimaryAngle(landmarks);
            const movement=updateMovement(primaryAngle);
            const posture=evaluatePosture(landmarks,primaryAngle,movement.phase);
            const lineIsGood=EXERCISE_RULE?posture.isCorrect&&movement.dynamicOk:centered;
            const label=EXERCISE_RULE?EXERCISE_RULE.label:${JSON.stringify(MP_TEXT.unknown)};
            drawFrame(lineIsGood);drawSkeleton(landmarks,lineIsGood);drawLandmarks(landmarks,lineIsGood);
            drawAngleTag(landmarks,primaryAngle,lineIsGood);
            setText(badgeEl,${JSON.stringify(MP_TEXT.exercise)}+": "+label+" · "+${JSON.stringify(MP_TEXT.reps)}+": "+movement.reps);
            setText(postureEl,${JSON.stringify(MP_TEXT.posture)}+": "+posture.status+" · "+${JSON.stringify(MP_TEXT.phase)}+": "+movement.phase.toUpperCase()+
              (primaryAngle?" · "+Math.round(primaryAngle)+"°":""));
            setBg(postureEl,lineIsGood?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            setText(hintEl,lineIsGood?${JSON.stringify(i18n.t("mediaPipe.rightPosture"))}:${JSON.stringify(i18n.t("mediaPipe.wrongPosture"))}+": "+(posture.correction||${JSON.stringify(i18n.t("mediaPipe.adjustPosture"))}));
            setBg(hintEl,lineIsGood?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            emitTracking(movement.reps,lineIsGood,posture.correction||"",movement.phase,true);
          }
        }else{
          drawFrame(false);
          setText(badgeEl,${JSON.stringify(MP_TEXT.exercise)}+": "+(EXERCISE_RULE?EXERCISE_RULE.label:${JSON.stringify(MP_TEXT.unknown)}));
          setText(postureEl,${JSON.stringify(i18n.t("mediaPipe.noBodyDetected"))});
          setText(hintEl,${JSON.stringify(i18n.t("mediaPipe.noFullBody"))});
          setBg(hintEl,"rgba(239,68,68,0.35)");
          if(SESSION_MODE){
            lastWarnIdx=[];
            emitTracking({reps:sessionPhase.repCount,formOk:false,correction:"",phase:sessionPhase.phase,bodyDetected:false,orientationOk:false,countingGated:true});
          }else emitTracking(repCount,false,"No body detected",phase,false);
        }
        rafId=requestAnimationFrame(detectLoop);
      };

      const stop=()=>{
        if(rafId)cancelAnimationFrame(rafId);rafId=null;
        if(poseLandmarker){poseLandmarker.close();poseLandmarker=null}
        if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
      };

      document.addEventListener("visibilitychange",()=>{if(document.hidden)stop()});
      window.addEventListener("beforeunload",stop);

      (async()=>{
        try{
          stream=await navigator.mediaDevices.getUserMedia({
            video:{facingMode:${facingJson},width:{ideal:1280},height:{ideal:720}},audio:false
          });
          video.srcObject=stream;await video.play();
          const vision=await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm");
          poseLandmarker=await PoseLandmarker.createFromOptions(vision,{
            baseOptions:{
              modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate:"GPU"
            },
            runningMode:"VIDEO",numPoses:1,
            minPoseDetectionConfidence:0.35,
            minPosePresenceConfidence:0.35,
            minTrackingConfidence:0.35,
            outputSegmentationMasks:false
          });
          post("ready");detectLoop();
        }catch(err){
          const msg=err?.message??"MediaPipe failed to start";
          post("error",{message:msg});
        }
      })();
    <\/script>
  </body>
</html>`;
}


function parseTrackingPayload(parsed: Record<string, unknown>): MediaPipeTrackingUpdate {
  return {
    reps: Number(parsed.reps) || 0,
    formOk: Boolean(parsed.formOk),
    correction: String(parsed.correction || ""),
    phase: String(parsed.phase || "idle"),
    bodyDetected: parsed.bodyDetected === true,
    primaryAngle: parsed.primaryAngle == null ? null : Number(parsed.primaryAngle),
    rom01: parsed.rom01 == null ? undefined : Number(parsed.rom01),
    inDepthZone: parsed.inDepthZone === true,
    zoneStart01: parsed.zoneStart01 == null ? undefined : Number(parsed.zoneStart01),
    zoneEnd01: parsed.zoneEnd01 == null ? undefined : Number(parsed.zoneEnd01),
    failingCheckIds: Array.isArray(parsed.failingCheckIds)
      ? parsed.failingCheckIds.map(String)
      : undefined,
    warnLandmarkIndices: Array.isArray(parsed.warnLandmarkIndices)
      ? parsed.warnLandmarkIndices.map(Number)
      : undefined,
    cueKey: parsed.cueKey == null ? null : String(parsed.cueKey),
    cuePriority:
      parsed.cuePriority === "safety" ||
      parsed.cuePriority === "correction" ||
      parsed.cuePriority === "encouragement"
        ? parsed.cuePriority
        : null,
    orientationOk: parsed.orientationOk === true,
    requiredView: parsed.requiredView == null ? undefined : String(parsed.requiredView),
    detectedView: parsed.detectedView == null ? undefined : String(parsed.detectedView),
    repCompleted: parsed.repCompleted === true,
    repVerdict: parsed.repVerdict === "clean" || parsed.repVerdict === "flagged" ? parsed.repVerdict : null,
    failedChecksThisRep: Array.isArray(parsed.failedChecksThisRep)
      ? parsed.failedChecksThisRep.map(String)
      : undefined,
    countingGated: parsed.countingGated === true,
  };
}

function MediaPipeGuidanceView({
  selectedExerciseName,
  isActive = true,
  onReady,
  onError,
  onTrackingUpdate,
  sessionMode = false,
  facingMode = "user",
  poseSpec = null,
  calibration = null,
  seedRepCount = 0,
  countingPaused = false,
}: MediaPipeGuidanceViewProps) {
  const webHostRef = useRef<View | null>(null);
  const webViewRef = useRef<WebView>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onTrackingUpdateRef = useRef(onTrackingUpdate);
  const countingPausedRef = useRef(countingPaused);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  onTrackingUpdateRef.current = onTrackingUpdate;
  countingPausedRef.current = countingPaused;

  useEffect(() => {
    if (Platform.OS === "web") return;
    webViewRef.current?.injectJavaScript(
      `COUNTING_PAUSED=${countingPaused ? "true" : "false"};true;`,
    );
  }, [countingPaused]);

  useEffect(() => {
    if (!isActive) return;
    if (Platform.OS !== "web") return;
    const host = webHostRef.current as unknown as HTMLDivElement | null;
    if (!host) return;

    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let lastVideoTime = -1;
    let poseLandmarker: PoseLandmarker | null = null;
    let cancelled = false;
    const matchedRecord = findExerciseRecord(selectedExerciseName);
    const trainerNote = String(matchedRecord?.trainerChecks?.notes || "").trim();
    const isCardio = isCardioOrMobilityExercise(matchedRecord, selectedExerciseName);
    const cal = (calibration as PoseCalibration) || DEFAULT_POSE_CALIBRATION;
    const sessionTracker =
      sessionMode && poseSpec
        ? new LiveSessionTracker(
            poseSpec as ResolvedPoseSpec & { _depthTargetDeg?: number },
            cal,
            seedRepCount,
            countingPaused,
            true,
          )
        : null;
    let lastWarnIdx: number[] = [];

    const mirrorCss = facingMode === "user" ? "scaleX(-1)" : "none";
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.position = "absolute";
    video.style.inset = "0";
    video.style.width = "100%";
    video.style.height = "100%";
    // Use fill so normalized landmark coordinates map 1:1 to overlay pixels.
    video.style.objectFit = "cover";
    video.style.transform = mirrorCss;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.objectFit = "cover";
    canvas.style.transform = mirrorCss;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onErrorRef.current?.("Unable to initialize drawing context.");
      return;
    }

    const hint = document.createElement("div");
    hint.style.position = "absolute";
    hint.style.left = "10px";
    hint.style.right = "10px";
    hint.style.bottom = "10px";
    hint.style.padding = "8px 10px";
    hint.style.borderRadius = "10px";
    hint.style.font = "700 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    hint.style.color = "#fff";
    hint.style.textAlign = "center";
    hint.style.background = "rgba(0,0,0,0.58)";
    hint.textContent = "Starting MediaPipe guidance...";

    const exerciseBadge = document.createElement("div");
    exerciseBadge.style.position = "absolute";
    exerciseBadge.style.top = "10px";
    exerciseBadge.style.left = "10px";
    exerciseBadge.style.maxWidth = "88%";
    exerciseBadge.style.width = "fit-content";
    exerciseBadge.style.padding = "6px 10px";
    exerciseBadge.style.borderRadius = "10px";
    exerciseBadge.style.font = "800 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    exerciseBadge.style.color = "#fff";
    exerciseBadge.style.textAlign = "left";
    exerciseBadge.style.background = "rgba(0,0,0,0.65)";
    exerciseBadge.style.zIndex = "12";
    exerciseBadge.textContent = MP_TEXT.exerciseDetecting;

    const posturePanel = document.createElement("div");
    posturePanel.style.position = "absolute";
    posturePanel.style.top = "40px";
    posturePanel.style.left = "10px";
    posturePanel.style.maxWidth = "88%";
    posturePanel.style.width = "fit-content";
    posturePanel.style.padding = "7px 10px";
    posturePanel.style.borderRadius = "10px";
    posturePanel.style.font = "700 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    posturePanel.style.color = "#fff";
    posturePanel.style.textAlign = "left";
    posturePanel.style.background = "rgba(0,0,0,0.65)";
    posturePanel.style.zIndex = "12";
    posturePanel.textContent = MP_TEXT.postureBlank;

    const notesPanel = document.createElement("div");
    notesPanel.style.position = "absolute";
    notesPanel.style.top = "70px";
    notesPanel.style.left = "10px";
    notesPanel.style.maxWidth = "92%";
    notesPanel.style.width = "fit-content";
    notesPanel.style.padding = "6px 10px";
    notesPanel.style.borderRadius = "10px";
    notesPanel.style.font = "600 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    notesPanel.style.color = "#fff";
    notesPanel.style.textAlign = "left";
    notesPanel.style.background = "rgba(15,23,42,0.78)";
    notesPanel.style.whiteSpace = "normal";
    notesPanel.style.zIndex = "12";
    notesPanel.textContent = trainerNote ? `Notes: ${trainerNote}` : "Notes: Maintain controlled movement";

    host.innerHTML = "";
    host.style.position = "relative";
    host.style.overflow = "hidden";
    if (sessionMode) {
      host.append(video, canvas);
    } else {
      host.append(video, canvas, exerciseBadge, posturePanel, notesPanel, hint);
    }

    const getVideoRect = () => {
      const cw = canvas.width || host.clientWidth || 720;
      const ch = canvas.height || host.clientHeight || 1280;
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const canvasAspect = cw / ch;
      const videoAspect = vw / vh;
      // cover-fit rect (can overflow/crop on one axis)
      if (videoAspect > canvasAspect) {
        const height = ch;
        const width = height * videoAspect;
        return { x: (cw - width) / 2, y: 0, width, height };
      }
      const width = cw;
      const height = width / videoAspect;
      return { x: 0, y: (ch - height) / 2, width, height };
    };

    const toPixel = (lm: NormalizedLandmark) => {
      const rect = getVideoRect();
      return {
        x: rect.x + lm.x * rect.width,
        y: rect.y + lm.y * rect.height,
      };
    };

    const resizeCanvas = () => {
      const w = video.videoWidth || host.clientWidth || 720;
      const h = video.videoHeight || host.clientHeight || 1280;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const POSE_CONNECTIONS: Array<[number, number]> = [
      [11, 12],
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
      [11, 23],
      [12, 24],
      [23, 24],
      [23, 25],
      [25, 27],
      [27, 29],
      [24, 26],
      [26, 28],
      [28, 30],
    ];
    const DISPLAY_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30];
    let prevLandmarks: NormalizedLandmark[] | null = null;
    const SMOOTH_ALPHA = sessionMode ? 0.35 : 0.55;
    const visMin = sessionMode ? MIN_LANDMARK_VISIBILITY : 0.4;

    const MINT = "#2DD4A7";
    const WARN_ORANGE = "#FF7A45";
    const JOINT_STROKE = "#052018";

    const drawSkeleton = (landmarks: NormalizedLandmark[], isCorrect: boolean) => {
      const warnSet = new Set(lastWarnIdx);
      ctx.save();
      ctx.lineWidth = sessionMode ? 4 : 2;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.95;
      for (const [aIdx, bIdx] of POSE_CONNECTIONS) {
        const a = landmarks[aIdx];
        const b = landmarks[bIdx];
        if (!a || !b) continue;
        if ((a.visibility ?? 1) < visMin || (b.visibility ?? 1) < visMin) continue;
        const boneWarn = sessionMode ? warnSet.has(aIdx) || warnSet.has(bIdx) : !isCorrect;
        ctx.strokeStyle = sessionMode
          ? boneWarn
            ? WARN_ORANGE
            : MINT
          : isCorrect
            ? "rgba(34,197,94,0.86)"
            : "rgba(239,68,68,0.86)";
        const pa = toPixel(a);
        const pb = toPixel(b);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.restore();
    };

    const smoothLandmarks = (landmarks: NormalizedLandmark[]) => {
      if (!prevLandmarks || prevLandmarks.length !== landmarks.length) {
        prevLandmarks = landmarks.map((l) => ({ ...l }));
        return landmarks;
      }
      const smoothed = landmarks.map((l, i) => {
        const p = prevLandmarks![i];
        return {
          ...l,
          x: SMOOTH_ALPHA * l.x + (1 - SMOOTH_ALPHA) * p.x,
          y: SMOOTH_ALPHA * l.y + (1 - SMOOTH_ALPHA) * p.y,
          z: SMOOTH_ALPHA * l.z + (1 - SMOOTH_ALPHA) * p.z,
          visibility: l.visibility,
        };
      });
      prevLandmarks = smoothed;
      return smoothed;
    };

    const drawLandmarks = (landmarks: NormalizedLandmark[], isCorrect: boolean) => {
      const warnSet = new Set(lastWarnIdx);
      const stroke = sessionMode ? JOINT_STROKE : "rgba(15,23,42,0.9)";
      const pingT = (performance.now() % 1000) / 1000;
      ctx.save();
      if (sessionMode) {
        const nose = landmarks[0];
        if (nose && (nose.visibility ?? 1) >= visMin) {
          const hp = toPixel(nose);
          ctx.beginPath();
          ctx.arc(hp.x, hp.y, 15, 0, Math.PI * 2);
          ctx.strokeStyle = MINT;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      }
      for (const idx of DISPLAY_LANDMARKS) {
        const lm = landmarks[idx];
        if (!lm) continue;
        if ((lm.visibility ?? 1) < visMin) continue;
        const p = toPixel(lm);
        const jointWarn = sessionMode ? warnSet.has(idx) : !isCorrect;
        const fill = sessionMode
          ? jointWarn
            ? WARN_ORANGE
            : MINT
          : isCorrect
            ? "rgba(34,197,94,0.96)"
            : "rgba(239,68,68,0.96)";
        if (jointWarn && sessionMode) {
          const pingR = 6 + pingT * 10;
          ctx.beginPath();
          ctx.arc(p.x, p.y, pingR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,122,69,${(1 - pingT).toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        const r = sessionMode
          ? idx === 25 || idx === 26 || idx === 23 || idx === 24
            ? 7
            : 6
          : 4.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = sessionMode ? 2 : 1.5;
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawAngleTag = (
      landmarks: NormalizedLandmark[],
      primaryAngle: number | null,
      ok: boolean,
      jointIndex?: number | null,
    ) => {
      if (!sessionMode || primaryAngle == null) return;
      const mid = jointIndex != null ? jointIndex : exerciseRule?.joints?.[0]?.b;
      if (mid == null) return;
      const lm = landmarks[mid];
      if (!lm || (lm.visibility ?? 1) < visMin) return;
      const p = toPixel(lm);
      const warn = !ok;
      const label = `${Math.round(primaryAngle)}°`;
      const x = p.x + 12;
      const y = p.y - 12;
      const w = 52;
      const h = 22;
      ctx.save();
      ctx.fillStyle = "rgba(5,32,24,0.85)";
      ctx.strokeStyle = warn ? WARN_ORANGE : "rgba(45,212,167,0.5)";
      ctx.lineWidth = 1.5;
      if (typeof (ctx as any).roundRect === "function") {
        ctx.beginPath();
        (ctx as any).roundRect(x, y, w, h, 7);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      ctx.fillStyle = warn ? WARN_ORANGE : MINT;
      ctx.font = "700 12px -apple-system,BlinkMacSystemFont,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + w / 2, y + h / 2 + 1);
      ctx.restore();
    };

    const isCentered = (landmarks: NormalizedLandmark[]) => {
      const xs = landmarks.map((l) => l.x);
      const ys = landmarks.map((l) => l.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return cx > 0.32 && cx < 0.68 && cy > 0.22 && cy < 0.78;
    };

    const calcAngle = (a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) => {
      const baX = a.x - b.x;
      const baY = a.y - b.y;
      const bcX = c.x - b.x;
      const bcY = c.y - b.y;
      const cross = Math.abs(baX * bcY - baY * bcX);
      const dot = baX * bcX + baY * bcY;
      const radians = Math.atan2(cross, dot);
      return (radians * 180) / Math.PI;
    };

    const detectExercise = (landmarks: NormalizedLandmark[]) => {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftElbow = landmarks[13];
      const rightElbow = landmarks[14];
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];
      const leftKnee = landmarks[25];
      const rightKnee = landmarks[26];
      const leftAnkle = landmarks[27];
      const rightAnkle = landmarks[28];
      if (
        !leftShoulder || !rightShoulder || !leftElbow || !rightElbow || !leftWrist || !rightWrist ||
        !leftHip || !rightHip || !leftKnee || !rightKnee || !leftAnkle || !rightAnkle
      ) {
        return MP_TEXT.unknown;
      }

      const leftKneeAngle = calcAngle(leftHip, leftKnee, leftAnkle);
      const rightKneeAngle = calcAngle(rightHip, rightKnee, rightAnkle);
      const leftElbowAngle = calcAngle(leftShoulder, leftElbow, leftWrist);
      const rightElbowAngle = calcAngle(rightShoulder, rightElbow, rightWrist);
      const kneeAvg = (leftKneeAngle + rightKneeAngle) / 2;
      const elbowAvg = (leftElbowAngle + rightElbowAngle) / 2;
      const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
      const ankleWidth = Math.abs(leftAnkle.x - rightAnkle.x);
      const oneKneeBent = (leftKneeAngle < 115 && rightKneeAngle > 145) || (rightKneeAngle < 115 && leftKneeAngle > 145);
      const wristsAboveShoulders = leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
      const bodyHorizontal = Math.abs(((leftShoulder.y + rightShoulder.y) / 2) - ((leftHip.y + rightHip.y) / 2)) < 0.12;

      if (kneeAvg < 120) return "SQUAT";
      if (oneKneeBent) return "LUNGE";
      if (wristsAboveShoulders && ankleWidth > shoulderWidth * 1.7) return "JUMPING JACK";
      if (bodyHorizontal && elbowAvg < 120) return "PUSH-UP";
      if (elbowAvg < 75) return "BICEP CURL";
      if (kneeAvg > 155 && elbowAvg > 145) return "STANDING";
      return "WORKOUT";
    };

    const exerciseRule = toExerciseRule(selectedExerciseName, matchedRecord);
    const movementConfig = toMovementConfig(selectedExerciseName, matchedRecord);
    let repCount = 0;
    let phase: "up" | "down" | "idle" = "idle";
    let reachedDown = false;

    const evaluateSelectedPosture = (
      landmarks: NormalizedLandmark[],
      primaryAngle: number | null,
      movementPhase: "up" | "down" | "idle",
    ) => {
      if (!exerciseRule) {
        return {
          isCorrect: false,
          status: "Select exercise",
          detail: "Select an exercise first",
        };
      }
      if (!exerciseRule.joints.length) {
        return {
          isCorrect: true,
          status: i18n.t("mediaPipe.rightPosture"),
          detail: `Tracking ${exerciseRule.label}`,
          correction: `No strict posture rule configured for ${exerciseRule.label}`,
        };
      }
      const results = exerciseRule.joints.map((rule) => {
        const a = landmarks[rule.a];
        const b = landmarks[rule.b];
        const c = landmarks[rule.c];
        if (!a || !b || !c) return { label: rule.label, angle: NaN, ok: false };
        const angle = calcAngle(a, b, c);
        const tolerance = matchedRecord?.trainerChecks?.strict ? 6 : 12;
        let min = rule.min;
        let max = rule.max;
        // Press exercises need phase-aware posture ranges:
        // elbows/shoulders are bent at the bottom and extended overhead at the top.
        if (
          matchedRecord?.movementFamily === "overhead_press" &&
          primaryAngle !== null &&
          (rule.label.includes("Elbow") || rule.label.includes("Shoulder"))
        ) {
          if (movementConfig && primaryAngle >= movementConfig.upThreshold - 10) {
            min = 145;
            max = 180;
          } else if (movementConfig && primaryAngle <= movementConfig.downThreshold + 10) {
            min = 75;
            max = 120;
          } else {
            min = 70;
            max = 180;
          }
        }
        // Curl exercises also need phase-aware ranges:
        // DOWN = mostly extended elbows, UP = flexed elbows.
        if (
          matchedRecord?.movementFamily === "bicep_curl" &&
          primaryAngle !== null &&
          rule.label.includes("Elbow")
        ) {
          if (movementPhase === "down") {
            min = 145;
            max = 180;
          } else if (movementPhase === "up") {
            min = 15;
            max = 85;
          } else {
            min = 15;
            max = 180;
          }
        }
        // Squat / lunge phase-aware hip range
        if (
          matchedRecord?.movementFamily === "squat_lunge" &&
          primaryAngle !== null &&
          rule.label.includes("Hip")
        ) {
          if (movementConfig && primaryAngle <= movementConfig.downThreshold + 15)
            { min = 55; max = 130; }
          else if (movementConfig && primaryAngle >= movementConfig.upThreshold - 15)
            { min = 145; max = 180; }
          else { min = 55; max = 180; }
        }

        // Hip hinge phase-aware hip range
        if (
          matchedRecord?.movementFamily === "hip_hinge" &&
          primaryAngle !== null &&
          rule.label.includes("Hip")
        ) {
          if (movementConfig && primaryAngle <= movementConfig.downThreshold + 15)
            { min = 35; max = 90; }
          else if (movementConfig && primaryAngle >= movementConfig.upThreshold - 15)
            { min = 155; max = 180; }
          else { min = 35; max = 180; }
        }
        return {
          label: rule.label,
          angle,
          min,
          max,
          ok: angle >= min - tolerance && angle <= max + tolerance,
        };
      });
      const valid = results.filter((r) => Number.isFinite(r.angle));
      if (!valid.length) {
        return {
          isCorrect: false,
          status: i18n.t("mediaPipe.wrongPosture"),
          detail: `${exerciseRule.label} joints not visible`,
          correction: "Bring full body into frame so joints are visible",
        };
      }
      const okCount = valid.filter((r) => r.ok).length;
      let trainerChecksOk = true;
      let trainerCorrection = "";
      if (matchedRecord?.movementFamily === "bicep_curl") {
        const lShoulder = landmarks[11];
        const rShoulder = landmarks[12];
        const lElbow = landmarks[13];
        const rElbow = landmarks[14];
        const lHip = landmarks[23];
        const rHip = landmarks[24];
        const lKnee = landmarks[25];
        const rKnee = landmarks[26];
        const lWrist = landmarks[15];
        const rWrist = landmarks[16];

        const baseVisible =
          Boolean(lShoulder && rShoulder && lElbow && rElbow && lHip && rHip && lWrist && rWrist) &&
          (lShoulder?.visibility ?? 0) > 0.45 &&
          (rShoulder?.visibility ?? 0) > 0.45 &&
          (lElbow?.visibility ?? 0) > 0.45 &&
          (rElbow?.visibility ?? 0) > 0.45 &&
          (lHip?.visibility ?? 0) > 0.45 &&
          (rHip?.visibility ?? 0) > 0.45;
        if (!baseVisible) {
          trainerChecksOk = false;
          trainerCorrection = "Keep full upper body visible (shoulders, elbows, hips)";
        }

        if (trainerChecksOk && (!lKnee || !rKnee || (lKnee.visibility ?? 0) < 0.35 || (rKnee.visibility ?? 0) < 0.35)) {
          trainerChecksOk = false;
          trainerCorrection = "Stand farther back so knees are visible (no seated curls)";
        }

        if (trainerChecksOk && lShoulder && rShoulder && lHip && rHip && lElbow && rElbow) {
          const shoulderWidth = Math.max(0.06, Math.abs(lShoulder.x - rShoulder.x));
          const torsoMidX = (lHip.x + rHip.x) / 2;
          const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
          const torsoLean = Math.abs(shoulderMidX - torsoMidX);
          const lElbowToHipX = Math.abs(lElbow.x - lHip.x);
          const rElbowToHipX = Math.abs(rElbow.x - rHip.x);
          const lUpperArmTravel = Math.abs(lShoulder.x - lElbow.x);
          const rUpperArmTravel = Math.abs(rShoulder.x - rElbow.x);

          if (torsoLean > shoulderWidth * 0.22) {
            trainerChecksOk = false;
            trainerCorrection = "Keep torso upright - avoid swinging/leaning";
          } else if (lElbowToHipX > shoulderWidth * 0.9 || rElbowToHipX > shoulderWidth * 0.9) {
            trainerChecksOk = false;
            trainerCorrection = "Keep elbows pinned close to your sides";
          } else if (lUpperArmTravel > shoulderWidth * 0.75 || rUpperArmTravel > shoulderWidth * 0.75) {
            trainerChecksOk = false;
            trainerCorrection = "Do not flare elbows forward/outward";
          } else if ((lElbow.y < lShoulder.y - 0.02) || (rElbow.y < rShoulder.y - 0.02)) {
            trainerChecksOk = false;
            trainerCorrection = "Keep shoulders down; do not shrug while curling";
          }
        }
      }
      const summary = valid
        .slice(0, 2)
        .map((r) => `${r.label} ${Math.round(r.angle)}° ${r.ok ? "✓" : "✗"}`)
        .join(" | ");
      const isCorrect = okCount === valid.length && trainerChecksOk;
      const firstWrong = valid.find((r) => !r.ok);
      let correction = "Maintain current form";
      if (!trainerChecksOk && trainerCorrection) {
        correction = trainerCorrection;
      } else if (firstWrong) {
        const wMin = firstWrong.min ?? 0;
        const wMax = firstWrong.max ?? 180;
        if (firstWrong.angle < wMin) correction = `${firstWrong.label}: bend/move more (${Math.round(firstWrong.angle)}°)`;
        else if (firstWrong.angle > wMax) correction = `${firstWrong.label}: reduce bend / straighten (${Math.round(firstWrong.angle)}°)`;
      }
      return {
        isCorrect,
        status: isCorrect ? i18n.t("mediaPipe.rightPosture") : i18n.t("mediaPipe.wrongPosture"),
        detail: `${exerciseRule.label} · ${summary}`,
        correction: correction || i18n.t("mediaPipe.adjustPostureJoints"),
      };
    };

    const getPrimaryAngle = (landmarks: NormalizedLandmark[]) => {
      if (!movementConfig) return null;
      if (movementConfig.primaryJoint === "elbow") {
        const l = landmarks[11] && landmarks[13] && landmarks[15] ? calcAngle(landmarks[11], landmarks[13], landmarks[15]) : NaN;
        const r = landmarks[12] && landmarks[14] && landmarks[16] ? calcAngle(landmarks[12], landmarks[14], landmarks[16]) : NaN;
        const vals = [l, r].filter((v) => Number.isFinite(v));
        if (!vals.length) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      let left = NaN;
      let right = NaN;
      if (movementConfig.primaryJoint === "knee") {
        left = landmarks[23] && landmarks[25] && landmarks[27] ? calcAngle(landmarks[23], landmarks[25], landmarks[27]) : NaN;
        right = landmarks[24] && landmarks[26] && landmarks[28] ? calcAngle(landmarks[24], landmarks[26], landmarks[28]) : NaN;
      } else if (movementConfig.primaryJoint === "hip") {
        left = landmarks[11] && landmarks[23] && landmarks[25] ? calcAngle(landmarks[11], landmarks[23], landmarks[25]) : NaN;
        right = landmarks[12] && landmarks[24] && landmarks[26] ? calcAngle(landmarks[12], landmarks[24], landmarks[26]) : NaN;
      } else if (movementConfig.primaryJoint === "shoulder") {
        left = landmarks[13] && landmarks[11] && landmarks[23] ? calcAngle(landmarks[13], landmarks[11], landmarks[23]) : NaN;
        right = landmarks[14] && landmarks[12] && landmarks[24] ? calcAngle(landmarks[14], landmarks[12], landmarks[24]) : NaN;
      } else if (movementConfig.primaryJoint === "ankle") {
        left = landmarks[25] && landmarks[27] && landmarks[29]
          ? calcAngle(landmarks[25], landmarks[27], landmarks[29]) : NaN;
        right = landmarks[26] && landmarks[28] && landmarks[30]
          ? calcAngle(landmarks[26], landmarks[28], landmarks[30]) : NaN;
      }
      const vals = [left, right].filter((v) => Number.isFinite(v));
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const updateMovement = (primaryAngle: number | null) => {
      if (!movementConfig || primaryAngle === null) return { phase, reps: repCount, dynamicOk: true };
      if (movementConfig.downWhenAngleIsLower) {
        if (primaryAngle <= movementConfig.downThreshold) {
          phase = "down";
          reachedDown = true;
        } else if (primaryAngle >= movementConfig.upThreshold) {
          phase = "up";
          if (reachedDown) {
            repCount += 1;
            reachedDown = false;
          }
        }
      } else {
        if (primaryAngle >= movementConfig.downThreshold) {
          phase = "down";
          reachedDown = true;
        } else if (primaryAngle <= movementConfig.upThreshold) {
          phase = "up";
          if (reachedDown) {
            repCount += 1;
            reachedDown = false;
          }
        }
      }
      const dynamicOk = movementConfig.downWhenAngleIsLower
        ? (phase === "down"
            ? primaryAngle <= movementConfig.downThreshold + 20
            : phase === "up"
              ? primaryAngle >= movementConfig.upThreshold - 20
              : true)
        : (phase === "down"
            ? primaryAngle >= movementConfig.downThreshold - 20
            : phase === "up"
              ? primaryAngle <= movementConfig.upThreshold + 20
              : true);
      return { phase, reps: repCount, dynamicOk };
    };

    const drawFrame = (ok: boolean) => {
      if (sessionMode) return; // no debug crosshair in AI session chrome
      const rect = getVideoRect();
      ctx.save();
      ctx.strokeStyle = ok ? "rgba(34,197,94,.95)" : "rgba(239,68,68,.95)";
      ctx.lineWidth = 3;
      const fw = rect.width * 0.62;
      const fh = rect.height * 0.72;
      const fx = rect.x + (rect.width - fw) / 2;
      const fy = rect.y + (rect.height - fh) / 2;
      ctx.strokeRect(fx, fy, fw, fh);

      ctx.strokeStyle = "rgba(255,255,255,.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rect.x + rect.width / 2, rect.y);
      ctx.lineTo(rect.x + rect.width / 2, rect.y + rect.height);
      ctx.moveTo(rect.x, rect.y + rect.height / 2);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height / 2);
      ctx.stroke();
      ctx.restore();
    };

    const loop = () => {
      if (!poseLandmarker || cancelled) return;
      if (video.currentTime === lastVideoTime) {
        rafId = requestAnimationFrame(loop);
        return;
      }
      lastVideoTime = video.currentTime;
      resizeCanvas();
      const result = poseLandmarker.detectForVideo(video, performance.now());
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const rawLandmarks = result.landmarks?.[0];
      const landmarks = rawLandmarks?.length ? smoothLandmarks(rawLandmarks) : null;
      if (landmarks?.length) {
        if (sessionMode) {
          if (!sessionTracker) {
            // Never fall back to legacy threshold counters in AI live sessions.
            drawSkeleton(landmarks, false);
            drawLandmarks(landmarks, false);
            onTrackingUpdateRef.current?.({
              reps: seedRepCount,
              formOk: false,
              correction: "cue_move_back",
              phase: "idle",
              bodyDetected: true,
              countingGated: true,
              rom01: 0,
            });
          } else {
            sessionTracker.setCountingPaused(countingPausedRef.current);
            const tracked = sessionTracker.process(landmarks, performance.now());
            lastWarnIdx = tracked.warnLandmarkIndices || [];
            drawSkeleton(landmarks, tracked.formOk);
            drawLandmarks(landmarks, tracked.formOk);
            drawAngleTag(
              landmarks,
              tracked.primaryAngle ?? null,
              tracked.formOk,
              tracked.jointIndex,
            );
            onTrackingUpdateRef.current?.(tracked);
          }
        } else {
          const centered = isCentered(landmarks);
          if (isCardio) {
            drawFrame(centered);
            drawSkeleton(landmarks, centered);
            drawLandmarks(landmarks, centered);
            exerciseBadge.textContent = MP_TEXT.postureAwareness;
            posturePanel.textContent = `${MP_TEXT.posture}: ${centered ? MP_TEXT.centred : MP_TEXT.adjustPosition}`;
            posturePanel.style.background = centered
              ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
            hint.textContent = centered
              ? i18n.t("mediaPipe.keepBodyFrame") : i18n.t("mediaPipe.centreBody");
            hint.style.background = centered
              ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
            if (!host.querySelector("#cardio-banner")) {
              const banner = document.createElement("div");
              banner.id = "cardio-banner";
              Object.assign(banner.style, {
                position: "absolute", left: "0", right: "0", bottom: "0", zIndex: "20",
                background: "rgba(15,23,42,0.85)", color: "#fff", padding: "14px 16px",
                textAlign: "center", fontSize: "13px", fontWeight: "600",
              });
              banner.textContent = MP_TEXT.cardioBanner;
              host.appendChild(banner);
            }
          } else {
            // Legacy on-demand form check path only — never used for AI live sessions.
            const primaryAngle = getPrimaryAngle(landmarks);
            const movement = updateMovement(primaryAngle);
            const posture = evaluateSelectedPosture(landmarks, primaryAngle, movement.phase);
            const lineIsGood = exerciseRule
              ? posture.isCorrect && movement.dynamicOk
              : centered;
            const exerciseName = exerciseRule
              ? exerciseRule.label
              : detectExercise(landmarks);
            drawFrame(lineIsGood);
            drawSkeleton(landmarks, lineIsGood);
            drawLandmarks(landmarks, lineIsGood);
            drawAngleTag(landmarks, primaryAngle, lineIsGood);
            exerciseBadge.textContent = `${MP_TEXT.exercise}: ${exerciseRule?.label || exerciseName} · ${MP_TEXT.reps}: ${movement.reps}`;
            posturePanel.textContent = `${MP_TEXT.posture}: ${posture.status} · ${MP_TEXT.phase}: ${movement.phase.toUpperCase()}${primaryAngle ? ` · ${Math.round(primaryAngle)}°` : ""}`;
            posturePanel.style.background = lineIsGood ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
            hint.textContent = lineIsGood ? i18n.t("mediaPipe.rightPosture") : `${i18n.t("mediaPipe.wrongPosture")}: ${posture.correction || i18n.t("mediaPipe.adjustPosture")}`;
            hint.style.background = lineIsGood ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
            onTrackingUpdateRef.current?.({
              reps: movement.reps,
              formOk: lineIsGood,
              correction: posture.correction || "",
              phase: movement.phase,
              bodyDetected: true,
            });
          }
        }
      } else {
        lastWarnIdx = [];
        if (sessionMode) {
          onTrackingUpdateRef.current?.(
            sessionTracker?.noBodyUpdate() || {
              reps: seedRepCount,
              formOk: false,
              correction: "",
              phase: "idle",
              bodyDetected: false,
              countingGated: true,
              rom01: 0,
            },
          );
        } else {
          drawFrame(false);
          exerciseBadge.textContent = `${MP_TEXT.exercise}: ${exerciseRule?.label || MP_TEXT.unknown}`;
          posturePanel.textContent = `${MP_TEXT.posture}: ${i18n.t("mediaPipe.notDetected", { label: exerciseRule?.label || MP_TEXT.unknown })}`;
          hint.textContent = i18n.t("mediaPipe.noFullBody");
          hint.style.background = "rgba(239,68,68,0.35)";
          onTrackingUpdateRef.current?.({
            reps: repCount,
            formOk: false,
            correction: "No body detected",
            phase,
            bodyDetected: false,
          });
        }
      }
      rafId = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        console.log("[MediaPipe web] requesting camera…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
        console.log("[MediaPipe web] camera frames flowing, loading WASM…");
        const vision = await FilesetResolver.forVisionTasks(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
        );
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.35,
          minPosePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
          outputSegmentationMasks: false,
        });
        if (cancelled) return;
        console.log("[MediaPipe web] PoseLandmarker ready", {
          sessionMode,
          hasPoseSpec: Boolean(poseSpec),
          tracker: Boolean(sessionTracker),
        });
        onReadyRef.current?.();
        loop();
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MediaPipe failed to start.";
        console.error("[MediaPipe web] init failed — no fallback tracking", msg);
        onErrorRef.current?.(
          msg.includes("Permission") || msg.includes("NotAllowed")
            ? "Camera permission denied — enable the webcam and try again."
            : "Camera tracking unavailable — try again.",
        );
      }
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (poseLandmarker) poseLandmarker.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [
    isActive,
    selectedExerciseName,
    sessionMode,
    facingMode,
    poseSpec,
    calibration,
    seedRepCount,
  ]);

  const matchedRecordForWebView = findExerciseRecord(selectedExerciseName);
  const exerciseRuleForWebView = toExerciseRule(selectedExerciseName, matchedRecordForWebView);
  const movementConfigForWebView = toMovementConfig(selectedExerciseName, matchedRecordForWebView);
  const trainerNoteForWebView = String(matchedRecordForWebView?.trainerChecks?.notes || "").trim();
  const isCardioForWebView = isCardioOrMobilityExercise(matchedRecordForWebView, selectedExerciseName);

  if (Platform.OS === "web") {
    return <View ref={webHostRef} style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: buildHtmlSource(
          exerciseRuleForWebView,
          movementConfigForWebView,
          trainerNoteForWebView,
          isCardioForWebView,
          sessionMode,
          matchedRecordForWebView?.movementFamily || null,
          facingMode,
          poseSpec,
          calibration,
          seedRepCount,
          countingPaused,
        ) }}
        key={`mp-${facingMode}-${selectedExerciseName || "x"}-${sessionMode ? "s" : "g"}`}
        style={styles.webview}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(event) => {
          try {
            const parsed = JSON.parse(event.nativeEvent.data || "{}") as Record<string, unknown>;
            if (parsed.type === "ready") onReady?.();
            if (parsed.type === "error") onError?.(String(parsed.message || "MediaPipe failed to start."));
            if (parsed.type === "tracking") {
              onTrackingUpdate?.(parseTrackingPayload(parsed));
            }
          } catch {
            // ignore malformed bridge messages
          }
        }}
        onError={() => onError?.("MediaPipe WebView failed to load.")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: "#050b16" },
});

const MemoizedMediaPipeGuidanceView = memo(MediaPipeGuidanceView) as typeof MediaPipeGuidanceView;

export default MemoizedMediaPipeGuidanceView;
