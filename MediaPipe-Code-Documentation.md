# MediaPipe Functionality — Complete Code Reference

Generated: 2026-05-23

This document contains **all code related to MediaPipe** in the Calm Fitness mobile app.

## Table of Contents

1. [Overview](#overview)
2. [Dependency (package.json)](#1-dependency-packagejson)
3. [MediaPipeGuidanceView.tsx (main component)](#2-mediapipeguidanceviewtsx-main-component)
4. [MediaPipeExercisesData.json (exercise rules)](#3-mediapipeexercisesdatajson-exercise-rules)
5. [WorkoutScreen.tsx (integration)](#4-workoutscreentsx-integration)

---

## Overview

MediaPipe is used for **real-time pose detection and workout form guidance** during the workout camera tracker.

| File | Role |
|------|------|
| `mobile/package.json` | Declares `@mediapipe/tasks-vision` dependency |
| `mobile/src/components/MediaPipeGuidanceView.tsx` | Core component: PoseLandmarker, posture/rep logic, WebView (native) + DOM (web) |
| `mobile/src/constants/MediaPipeExercisesData.json` | Per-exercise joint angles, movement config, trainer notes (215 exercises) |
| `mobile/src/screens/WorkoutScreen.tsx` | Opens camera modal and renders `MediaPipeGuidanceView` |

**Platforms:**
- **Web:** Uses `@mediapipe/tasks-vision` directly in the DOM with `pose_landmarker_full` model.
- **iOS/Android:** Embeds equivalent logic in a `WebView` HTML bundle (CDN `tasks-vision@0.10.14`, `pose_landmarker_lite` model).

---

## 1. Dependency (package.json)

**File:** `mobile/package.json`

```json
  "@mediapipe/tasks-vision": "^0.10.34",
```

---

## 2. MediaPipeGuidanceView.tsx (main component)

**File:** `mobile/src/components/MediaPipeGuidanceView.tsx`

```typescript
import { memo, useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type MediaPipeGuidanceViewProps = {
  selectedExerciseName?: string;
  isActive?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
};

const HTML_SOURCE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #050b16; overflow: hidden; }
      #root { position: relative; width: 100%; height: 100%; }
      video, canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
      #status {
        position: absolute; left: 10px; right: 10px; top: 10px; z-index: 10;
        background: rgba(0,0,0,.55); color: #fff; border-radius: 10px; padding: 8px 10px;
        font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #hint {
        position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 10;
        border-radius: 10px; padding: 8px 10px;
        font: 700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center;
        color: #fff; background: rgba(0,0,0,.55);
      }
    </style>
  </head>
  <body>
    <div id="root">
      <video id="video" autoplay playsinline muted></video>
      <canvas id="overlay"></canvas>
      <div id="status">Initializing MediaPipe...</div>
      <div id="hint">Align your full body in frame</div>
    </div>
    <script type="module">
      import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

      const statusEl = document.getElementById("status");
      const hintEl = document.getElementById("hint");
      const video = document.getElementById("video");
      const canvas = document.getElementById("overlay");
      const ctx = canvas.getContext("2d");

      const post = (type, payload = {}) => {
        try {
          window.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload }));
        } catch {}
      };

      let poseLandmarker = null;
      let rafId = null;
      let stream = null;
      let lastVideoTime = -1;

      const resizeCanvas = () => {
        const w = video.videoWidth || video.clientWidth || 720;
        const h = video.videoHeight || video.clientHeight || 1280;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      };

      const drawGuidanceFrame = (isGood) => {
        const w = canvas.width;
        const h = canvas.height;
        ctx.save();
        ctx.strokeStyle = isGood ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)";
        ctx.lineWidth = 3;
        const fw = w * 0.6;
        const fh = h * 0.72;
        const fx = (w - fw) / 2;
        const fy = (h - fh) / 2;
        ctx.strokeRect(fx, fy, fw, fh);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.restore();
      };

      const drawLandmarks = (landmarks) => {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        for (const lm of landmarks) {
          const x = lm.x * canvas.width;
          const y = lm.y * canvas.height;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };

      const evaluateCentering = (landmarks) => {
        const points = landmarks.map((lm) => ({ x: lm.x * canvas.width, y: lm.y * canvas.height }));
        if (!points.length) return false;
        const minX = Math.min(...points.map((p) => p.x));
        const maxX = Math.max(...points.map((p) => p.x));
        const minY = Math.min(...points.map((p) => p.y));
        const maxY = Math.max(...points.map((p) => p.y));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const withinX = cx > canvas.width * 0.32 && cx < canvas.width * 0.68;
        const withinY = cy > canvas.height * 0.22 && cy < canvas.height * 0.78;
        return withinX && withinY;
      };

      const detectLoop = () => {
        if (!poseLandmarker) return;
        if (video.currentTime === lastVideoTime) {
          rafId = requestAnimationFrame(detectLoop);
          return;
        }
        lastVideoTime = video.currentTime;
        resizeCanvas();
        const result = poseLandmarker.detectForVideo(video, performance.now());
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const landmarks = result?.landmarks?.[0];
        if (landmarks && landmarks.length) {
          const good = evaluateCentering(landmarks);
          drawGuidanceFrame(good);
          drawLandmarks(landmarks);
          hintEl.textContent = good ? "Good alignment - keep posture steady" : "Center your body inside the frame";
          hintEl.style.background = good ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)";
        } else {
          drawGuidanceFrame(false);
          hintEl.textContent = "No full body detected - step back slightly";
          hintEl.style.background = "rgba(239,68,68,.35)";
        }
        rafId = requestAnimationFrame(detectLoop);
      };

      const start = async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });
          video.srcObject = stream;
          await video.play();
          statusEl.textContent = "Loading MediaPipe pose model...";

          const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
          );
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: false
          });
          statusEl.textContent = "MediaPipe guidance ready";
          post("ready");
          detectLoop();
        } catch (err) {
          const msg = err && err.message ? err.message : "MediaPipe failed to start";
          statusEl.textContent = msg;
          post("error", { message: msg });
        }
      };

      const stop = () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (poseLandmarker) {
          poseLandmarker.close();
          poseLandmarker = null;
        }
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }
      };

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop();
      });
      window.addEventListener("beforeunload", stop);

      start();
    </script>
  </body>
</html>`;

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
    const data = require("../constants/MediaPipeExercisesData.json") as { records?: unknown[] };
    cachedMediaPipeRecords = Array.isArray(data?.records) ? (data.records as MediaPipeExerciseRecord[]) : [];
  } catch {
    cachedMediaPipeRecords = [];
  }
  return cachedMediaPipeRecords;
};

const findExerciseRecord = (selectedExerciseName?: string): MediaPipeExerciseRecord | null => {
  const normalizedTarget = normalizeExerciseName(selectedExerciseName);
  if (!normalizedTarget) return null;
  const records = getMediaPipeRecords();
  const exact = records.find((record) => normalizeExerciseName(record.exerciseName) === normalizedTarget);
  if (exact) return exact;
  const partial = records.find((record) => {
    const candidate = normalizeExerciseName(record.exerciseName);
    return candidate && (candidate.includes(normalizedTarget) || normalizedTarget.includes(candidate));
  });
  return partial || null;
};

function toBodyPostureRequirement(selectedExerciseName?: string, record?: MediaPipeExerciseRecord | null): string {
  const postureValue = String(record?.bodyPosture || "").trim().toLowerCase();
  if (postureValue === "stand_side_facing") return "Body posture: Stand/position side-faced to camera";
  if (postureValue === "sit_front_facing") return "Body posture: Sit on a chair/bench, front-facing";
  if (postureValue === "stand_front_facing") return "Body posture: Stand still, front-facing";

  const name = normalizeExerciseName(selectedExerciseName);
  if (!name) return "Body posture: Stand still, front-facing";

  if (
    containsAny(name, [
      "seated",
      "chair",
      "seated cable row",
      "seated calf raise",
      "seated dumbbell press",
      "machine chest press",
      "machine row",
      "machine shoulder press",
      "pec deck",
      "lat pulldown",
      "leg extension",
      "leg curl",
      "leg press",
      "ab wheel",
    ])
  ) {
    return "Body posture: Sit on a chair/bench, front-facing";
  }

  if (
    containsAny(name, [
      "squat",
      "lunge",
      "deadlift",
      "romanian",
      "rack pull",
      "hip thrust",
      "glute bridge",
      "swing",
      "step up",
      "calf raise",
      "wall sit",
      "jump squat",
      "bulgarian split",
      "push up",
      "plank",
      "mountain climber",
      "burpee",
    ])
  ) {
    return "Body posture: Stand/position side-faced to camera";
  }

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
  if (
    containsAny(name, [
      "squat",
      "wall sit",
      "step up",
      "jump lunge",
      "walking lunge",
      "lunge",
      "bulgarian split",
      "pistol",
      "zercher",
      "hack squat",
      "leg press",
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
  if (containsAny(name, ["lunge", "split squat"])) {
    return {
      label: "LUNGE",
      joints: [
        { label: "L Knee", a: 23, b: 25, c: 27, min: 80, max: 100 },
        { label: "R Knee", a: 24, b: 26, c: 28, min: 80, max: 100 },
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
        { label: "L Ankle", a: 25, b: 27, c: 31, min: 75, max: 130 },
        { label: "R Ankle", a: 26, b: 28, c: 32, min: 75, max: 130 },
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

function MediaPipeGuidanceView({ selectedExerciseName, isActive = true, onReady, onError }: MediaPipeGuidanceViewProps) {
  const webHostRef = useRef<View | null>(null);

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
    video.style.transform = "scaleX(-1)";

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.objectFit = "cover";
    canvas.style.transform = "scaleX(-1)";
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onError?.("Unable to initialize drawing context.");
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
    exerciseBadge.textContent = "Exercise: Detecting...";

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
    posturePanel.textContent = "Posture: --";

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
    host.append(video, canvas, exerciseBadge, posturePanel, notesPanel, hint);

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
      [27, 31],
      [24, 26],
      [26, 28],
      [28, 32],
    ];
    const DISPLAY_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
    let prevLandmarks: NormalizedLandmark[] | null = null;
    const SMOOTH_ALPHA = 0.8;

    const drawSkeleton = (landmarks: NormalizedLandmark[], isCorrect: boolean) => {
      ctx.save();
      ctx.strokeStyle = isCorrect ? "rgba(34,197,94,0.86)" : "rgba(239,68,68,0.86)";
      ctx.lineWidth = 2;
      for (const [aIdx, bIdx] of POSE_CONNECTIONS) {
        const a = landmarks[aIdx];
        const b = landmarks[bIdx];
        if (!a || !b) continue;
        const aVisible = (a.visibility ?? 1) >= 0.4;
        const bVisible = (b.visibility ?? 1) >= 0.4;
        if (!aVisible || !bVisible) continue;
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
      ctx.save();
      ctx.fillStyle = isCorrect ? "rgba(34,197,94,0.96)" : "rgba(239,68,68,0.96)";
      ctx.strokeStyle = "rgba(15,23,42,0.9)";
      ctx.lineWidth = 1.5;
      for (const idx of DISPLAY_LANDMARKS) {
        const lm = landmarks[idx];
        if (!lm) continue;
        if ((lm.visibility ?? 1) < 0.4) continue;
        const p = toPixel(lm);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
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
        return "UNKNOWN";
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
          status: "Right posture",
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
          (exerciseRule.label === "ARNOLD PRESS" || exerciseRule.label === "SHOULDER PRESS") &&
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
        if (exerciseRule.label === "BICEP CURL" && primaryAngle !== null && rule.label.includes("Elbow")) {
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
          status: "Wrong posture",
          detail: `${exerciseRule.label} joints not visible`,
          correction: "Bring full body into frame so joints are visible",
        };
      }
      const okCount = valid.filter((r) => r.ok).length;
      let trainerChecksOk = true;
      let trainerCorrection = "";
      if (exerciseRule.label === "BICEP CURL") {
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
        if (firstWrong.angle < firstWrong.min) correction = `${firstWrong.label}: bend/move more (${Math.round(firstWrong.angle)}°)`;
        else if (firstWrong.angle > firstWrong.max) correction = `${firstWrong.label}: reduce bend / straighten (${Math.round(firstWrong.angle)}°)`;
      }
      return {
        isCorrect,
        status: isCorrect ? "Right posture" : "Wrong posture",
        detail: `${exerciseRule.label} · ${summary}`,
        correction: correction || "Adjust posture based on highlighted joints",
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
        left = landmarks[25] && landmarks[27] && landmarks[31] ? calcAngle(landmarks[25], landmarks[27], landmarks[31]) : NaN;
        right = landmarks[26] && landmarks[28] && landmarks[32] ? calcAngle(landmarks[26], landmarks[28], landmarks[32]) : NaN;
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
          ? primaryAngle <= movementConfig.downThreshold + 15
          : phase === "up"
            ? primaryAngle >= movementConfig.upThreshold - 15
            : true)
        : (phase === "down"
          ? primaryAngle >= movementConfig.downThreshold - 15
          : phase === "up"
            ? primaryAngle <= movementConfig.upThreshold + 15
            : true);
      return { phase, reps: repCount, dynamicOk };
    };

    const drawFrame = (ok: boolean) => {
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
        const centered = isCentered(landmarks);
        const primaryAngle = getPrimaryAngle(landmarks);
        const movement = updateMovement(primaryAngle);
        const posture = evaluateSelectedPosture(landmarks, primaryAngle, movement.phase);
        const lineIsGood = exerciseRule ? posture.isCorrect && movement.dynamicOk : centered;
        const exerciseName = detectExercise(landmarks);
        drawFrame(lineIsGood);
        drawSkeleton(landmarks, lineIsGood);
        drawLandmarks(landmarks, lineIsGood);
        exerciseBadge.textContent = `Exercise: ${exerciseRule?.label || exerciseName} · Reps: ${movement.reps}`;
        posturePanel.textContent = `Posture: ${posture.status} · Phase: ${movement.phase.toUpperCase()}${primaryAngle ? ` · ${Math.round(primaryAngle)}°` : ""}`;
        posturePanel.style.background = lineIsGood ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
        hint.textContent = lineIsGood ? "Right posture" : `Wrong posture: ${posture.correction || "Adjust posture"}`;
        hint.style.background = lineIsGood ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
      } else {
        drawFrame(false);
        exerciseBadge.textContent = `Exercise: ${exerciseRule?.label || "UNKNOWN"}`;
        posturePanel.textContent = `Posture: ${exerciseRule?.label || "UNKNOWN"} not detected`;
        hint.textContent = "No full body detected - step back slightly";
        hint.style.background = "rgba(239,68,68,0.35)";
      }
      rafId = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
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
        onReady?.();
        loop();
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MediaPipe failed to start.";
        onError?.(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (poseLandmarker) poseLandmarker.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [isActive, onError, onReady, selectedExerciseName]);

  if (Platform.OS === "web") {
    return <View ref={webHostRef} style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: HTML_SOURCE }}
        style={styles.webview}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(event) => {
          try {
            const parsed = JSON.parse(event.nativeEvent.data || "{}") as { type?: string; message?: string };
            if (parsed.type === "ready") onReady?.();
            if (parsed.type === "error") onError?.(parsed.message || "MediaPipe failed to start.");
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
```

---

## 3. MediaPipeExercisesData.json (exercise rules)

**File:** `mobile/src/constants/MediaPipeExercisesData.json`

```json
{
  "version": 2,
  "sourceTable": "workout_catalog_v2",
  "totalExercises": 215,
  "bodyPostureLegend": {
    "stand_front_facing": "Stand still, front-facing",
    "sit_front_facing": "Sit on chair/bench, front-facing",
    "stand_side_facing": "Stand side-faced to camera"
  },
  "records": [
    {
      "exerciseName": "Ab Wheel Rollout",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "AB WHEEL ROLLOUT",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 90,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 90,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 90,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 90,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 120,
        "upThreshold": 170,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; keep hips visible through full rollout range"
      }
    },
    {
      "exerciseName": "Ab Wheel Rollout Variations",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "AB WHEEL ROLLOUT VARIATIONS",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 90,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 90,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 90,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 90,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 120,
        "upThreshold": 170,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; keep hips visible through full rollout range"
      }
    },
    {
      "exerciseName": "Arnold Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "ARNOLD PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 70,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 70,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 70,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 70,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 90,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; watch elbow flare and full lockout overhead"
      }
    },
    {
      "exerciseName": "Assault Bike Sprint",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "ASSAULT BIKE SPRINT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated on bike; camera front-facing; full pedal stroke visible"
      }
    },
    {
      "exerciseName": "Assisted Pull-Up",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "ASSISTED PULL-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; full hang to chin-over-bar"
      }
    },
    {
      "exerciseName": "Barbell 21s",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL 21S",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; strict no-swing curl form"
      }
    },
    {
      "exerciseName": "Barbell Back Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BARBELL BACK SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; full depth squat; knees track over toes"
      }
    },
    {
      "exerciseName": "Barbell Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 50,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 50,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying on bench; camera front/overhead; full press extension"
      }
    },
    {
      "exerciseName": "Barbell Bent-Over Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BARBELL BENT-OVER ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; torso ~45° parallel; full elbow drive row"
      }
    },
    {
      "exerciseName": "Barbell Clean and Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL CLEAN AND PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 85,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; track full clean catch and overhead lockout"
      }
    },
    {
      "exerciseName": "Barbell Complex",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL COMPLEX",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Full body monitor; no single joint rep count"
      }
    },
    {
      "exerciseName": "Barbell Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; strict no-swing form"
      }
    },
    {
      "exerciseName": "Barbell Front Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BARBELL FRONT SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; upright torso front squat"
      }
    },
    {
      "exerciseName": "Barbell Hang Clean",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL HANG CLEAN",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; track hip/knee drive and elbow catch"
      }
    },
    {
      "exerciseName": "Barbell Heavy Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL HEAVY CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; knees locked; track ankle plantarflexion"
      }
    },
    {
      "exerciseName": "Barbell Hip Thrust",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BARBELL HIP THRUST",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 100
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 100
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 170
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 170
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 65,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; upper back on bench; drive hips to full extension"
      }
    },
    {
      "exerciseName": "Barbell Push Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL PUSH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 85,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; dip-drive-press; overhead lockout"
      }
    },
    {
      "exerciseName": "Barbell Romanian Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BARBELL ROMANIAN DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 140,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 140,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 45,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 45,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 80,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; soft knees; hip hinge to hamstring stretch"
      }
    },
    {
      "exerciseName": "Barbell Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BARBELL ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; torso ~45°; full row ROM"
      }
    },
    {
      "exerciseName": "Barbell Standing Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL STANDING CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; knees locked; plantarflex for peak contraction"
      }
    },
    {
      "exerciseName": "Barbell Upright Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BARBELL UPRIGHT ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 150
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 150
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 150
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 140,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; elbows lead above shoulders"
      }
    },
    {
      "exerciseName": "Barbell Walking Lunge",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BARBELL WALKING LUNGE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; front knee 90° at bottom"
      }
    },
    {
      "exerciseName": "Barbell Z-Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "BARBELL Z-PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 85,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated on floor; overhead press from seated position; strict lockout"
      }
    },
    {
      "exerciseName": "Battle Ropes",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BATTLE ROPES",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 130,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 130,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; athletic stance; arms alternate waves"
      }
    },
    {
      "exerciseName": "Battle Rope Shoulder Wave",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BATTLE ROPE SHOULDER WAVE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 130,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 130,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; lateral wave motion at shoulder height"
      }
    },
    {
      "exerciseName": "Bicycle Crunch",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BICYCLE CRUNCH",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 45,
            "max": 135
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 45,
            "max": 135
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 110,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying supine; alternate elbow-to-knee; shoulders off floor"
      }
    },
    {
      "exerciseName": "Bird Dog",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BIRD DOG",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 80,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 80,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 80,
            "max": 170
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 80,
            "max": 170
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Quadruped; side-facing; extend opposite arm and leg; neutral spine"
      }
    },
    {
      "exerciseName": "Bodyweight Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BODYWEIGHT SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; parallel or below parallel depth"
      }
    },
    {
      "exerciseName": "Box Jump",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BOX JUMP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; absorb landing; full hip/knee extension at top"
      }
    },
    {
      "exerciseName": "Bulgarian Split Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "BULGARIAN SPLIT SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; rear foot elevated; front knee 90° at bottom"
      }
    },
    {
      "exerciseName": "Burpees",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "BURPEES",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; track squat, plank, and jump phases"
      }
    },
    {
      "exerciseName": "Cable Chest Fly",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE CHEST FLY",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 100,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 100,
            "max": 155
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 50,
        "upThreshold": 145,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; slight elbow bend throughout; chest squeeze at center"
      }
    },
    {
      "exerciseName": "Cable Crossover",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE CROSSOVER",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 100,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 100,
            "max": 155
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 50,
        "upThreshold": 145,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; arms cross at bottom; full stretch at top"
      }
    },
    {
      "exerciseName": "Cable Crunch",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "CABLE CRUNCH",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 35,
            "max": 120
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 35,
            "max": 120
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 55,
        "upThreshold": 110,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Kneeling; side-facing; crunch elbows to knees"
      }
    },
    {
      "exerciseName": "Cable Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; strict curl, no body swing"
      }
    },
    {
      "exerciseName": "Cable Face Pull",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE FACE PULL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 155
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 70,
            "max": 145
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 70,
            "max": 145
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; pull to forehead level; external rotation at peak"
      }
    },
    {
      "exerciseName": "Cable Front Raise",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE FRONT RAISE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 165
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 155,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 155,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 25,
        "upThreshold": 150,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; arm straight; raise to shoulder height or above"
      }
    },
    {
      "exerciseName": "Cable Hammer Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE HAMMER CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; neutral grip; no swing"
      }
    },
    {
      "exerciseName": "Cable Lateral Raise",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE LATERAL RAISE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 150
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 145,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 20,
        "upThreshold": 130,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; raise to shoulder height; slight elbow bend"
      }
    },
    {
      "exerciseName": "Cable Overhead Tricep Extension",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE OVERHEAD TRICEP EXTENSION",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 55,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 55,
            "max": 170
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; upper arm vertical; extend to full lockout"
      }
    },
    {
      "exerciseName": "Cable Rear Delt Fly",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE REAR DELT FLY",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 100,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 100,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 150
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 45,
        "upThreshold": 140,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; bent forward slightly; arms sweep rear"
      }
    },
    {
      "exerciseName": "Cable Straight-Arm Pulldown",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE STRAIGHT-ARM PULLDOWN",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 155,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 155,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 50,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; straight arms; lat-dominant pulldown to thighs"
      }
    },
    {
      "exerciseName": "Cable Y-Raise",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CABLE Y-RAISE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 160
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 145,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 20,
        "upThreshold": 145,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; arms form Y shape; raise diagonally overhead"
      }
    },
    {
      "exerciseName": "Chest-Supported Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "CHEST-SUPPORTED ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 90
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 90
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Chest on incline bench; side-facing; full elbow drive row"
      }
    },
    {
      "exerciseName": "Chin-Up",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CHIN-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; supinated grip; chin over bar"
      }
    },
    {
      "exerciseName": "Clean",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CLEAN",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; track full lift and catch position"
      }
    },
    {
      "exerciseName": "Close Grip Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CLOSE GRIP BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front/lying; narrow grip; tricep-focused press"
      }
    },
    {
      "exerciseName": "Close-Grip Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CLOSE-GRIP BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front/lying; narrow grip; tricep-focused press"
      }
    },
    {
      "exerciseName": "Concentration Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "CONCENTRATION CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated; elbow braced on inner thigh; strict curl"
      }
    },
    {
      "exerciseName": "Cross Body Hammer Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CROSS BODY HAMMER CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; curl across body; no swing"
      }
    },
    {
      "exerciseName": "Crunch",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "CRUNCH",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 70,
            "max": 130
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 85,
        "upThreshold": 40,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying supine; camera front/top; shoulders curl off floor"
      }
    },
    {
      "exerciseName": "Dead Bug",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DEAD BUG",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 80,
            "max": 160
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 80,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 80,
            "max": 170
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 80,
            "max": 170
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Lying supine; extend opposite arm/leg; low back pressed to floor"
      }
    },
    {
      "exerciseName": "Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 100,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 100,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 70,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; bar over mid-foot; hip hinge, not a squat"
      }
    },
    {
      "exerciseName": "Decline Barbell Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DECLINE BARBELL BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Decline bench; lower chest focus; full press extension"
      }
    },
    {
      "exerciseName": "Decline Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DECLINE PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Feet elevated; side-facing; full press extension"
      }
    },
    {
      "exerciseName": "Deficit Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DEFICIT DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 90,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 90,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 60,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; standing on plates; deeper hip hinge start"
      }
    },
    {
      "exerciseName": "Depth Jump",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DEPTH JUMP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; step off box, absorb, immediately jump"
      }
    },
    {
      "exerciseName": "Diamond Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DIAMOND PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 35,
            "max": 110
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 35,
            "max": 110
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Hands form diamond; side-facing; tricep focus"
      }
    },
    {
      "exerciseName": "Dips",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DIPS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; chest dip forward lean"
      }
    },
    {
      "exerciseName": "Donkey Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DONKEY CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Hip-hinged forward; side or front view; plantarflex at top"
      }
    },
    {
      "exerciseName": "Dragon Flag",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DRAGON FLAG",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 30,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 30,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 55,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; body plank; lower and raise as one unit"
      }
    },
    {
      "exerciseName": "Dumbbell Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying; dumbbells allow greater ROM; full press extension"
      }
    },
    {
      "exerciseName": "Dumbbell Burpee",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL BURPEE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; dumbbell in hands throughout; full squat-jump"
      }
    },
    {
      "exerciseName": "Dumbbell Chest Fly",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL CHEST FLY",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 95,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 95,
            "max": 155
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 155
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 155
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying; full chest stretch at bottom; squeeze at top"
      }
    },
    {
      "exerciseName": "Dumbbell Chest Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL CHEST PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 95,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 95,
            "max": 155
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 155
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 155
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying; full chest stretch at bottom; squeeze at top"
      }
    },
    {
      "exerciseName": "Dumbbell Clean and Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL CLEAN AND PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 85,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; clean catch and overhead press"
      }
    },
    {
      "exerciseName": "Dumbbell Cuban Press",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL CUBAN PRESS",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; upright row to external rotation to press"
      }
    },
    {
      "exerciseName": "Dumbbell Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; strict curl; no swing"
      }
    },
    {
      "exerciseName": "Dumbbell Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 100,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 100,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 70,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; hip hinge; dumbbells hang by sides"
      }
    },
    {
      "exerciseName": "Dumbbell Farmer Carry",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL FARMER CARRY",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 140,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 140,
            "max": 180
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 155,
            "max": 180
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; upright posture; shoulders packed"
      }
    },
    {
      "exerciseName": "Dumbbell Lateral Raise",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL LATERAL RAISE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 150
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 145,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 20,
        "upThreshold": 130,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; slight elbow bend; raise to shoulder level"
      }
    },
    {
      "exerciseName": "Dumbbell Lunges",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL LUNGES",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; front knee 90°; torso upright"
      }
    },
    {
      "exerciseName": "Dumbbell Meadows Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL MEADOWS ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 90
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 90
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; staggered stance; elbow drive row"
      }
    },
    {
      "exerciseName": "Dumbbell Pullover",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL PULLOVER",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 50,
            "max": 170
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 50,
            "max": 170
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 130,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 130,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 60,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying across bench; side or front; pull dumbbell arc over chest"
      }
    },
    {
      "exerciseName": "Dumbbell Romanian Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL ROMANIAN DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 140,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 140,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 45,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 45,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 80,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; soft knees; hip hinge to hamstring stretch"
      }
    },
    {
      "exerciseName": "Dumbbell Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 90
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 90
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; knee on bench; full ROM row"
      }
    },
    {
      "exerciseName": "Dumbbell Shoulder Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL SHOULDER PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 65,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 90,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; press from ear height to lockout"
      }
    },
    {
      "exerciseName": "Dumbbell Single-Arm Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL SINGLE-ARM ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 90
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 90
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; brace on bench; drive elbow to ceiling"
      }
    },
    {
      "exerciseName": "Dumbbell Squat to Press",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL SQUAT TO PRESS",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; squat depth then press on way up"
      }
    },
    {
      "exerciseName": "Dumbbell Standing Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL STANDING CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; dumbbells in hands; plantarflex peak contraction"
      }
    },
    {
      "exerciseName": "Dumbbell Step-Up",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "DUMBBELL STEP-UP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; step fully onto box; full hip extension"
      }
    },
    {
      "exerciseName": "Dumbbell Thruster",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL THRUSTER",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 85,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; squat depth then drive to overhead press"
      }
    },
    {
      "exerciseName": "Dumbbell Zottman Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "DUMBBELL ZOTTMAN CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; supinate up, pronate down; no swing"
      }
    },
    {
      "exerciseName": "Explosive Calf Jump",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "EXPLOSIVE CALF JUMP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 150,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 150,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 65,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 65,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 78,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; minimal knee bend; drive through ankle only"
      }
    },
    {
      "exerciseName": "Explosive Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "EXPLOSIVE PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; explosive press off floor; clap optional"
      }
    },
    {
      "exerciseName": "Explosive Shoulder Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "EXPLOSIVE SHOULDER PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; power drive to lockout"
      }
    },
    {
      "exerciseName": "EZ Bar Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "EZ BAR CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; semi-supinated grip; strict form"
      }
    },
    {
      "exerciseName": "Face Pull",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "FACE PULL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 155
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 70,
            "max": 145
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 70,
            "max": 145
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; rope to forehead; external rotation at end"
      }
    },
    {
      "exerciseName": "Farmer’s Walk",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "FARMER’S WALK",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 140,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 140,
            "max": 180
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 155,
            "max": 180
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; upright posture; shoulders packed; tight core"
      }
    },
    {
      "exerciseName": "Floor Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "FLOOR PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying on floor; arms stop at floor level; tricep-dominant lockout"
      }
    },
    {
      "exerciseName": "Flutter Kicks",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "FLUTTER KICKS",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 145,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 120,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 120,
            "max": 160
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Lying supine; legs alternate flutter; low back to floor"
      }
    },
    {
      "exerciseName": "Front Raise",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "FRONT RAISE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 165
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 150,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 150,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 25,
        "upThreshold": 150,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; raise to shoulder height; straight arms"
      }
    },
    {
      "exerciseName": "Front Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "FRONT SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; elbows up; upright torso; full depth"
      }
    },
    {
      "exerciseName": "Glute Bridge",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "GLUTE BRIDGE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 100
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 100
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 65,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; feet flat on floor; full hip extension at top"
      }
    },
    {
      "exerciseName": "Glute Bridge Hold",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "GLUTE BRIDGE HOLD",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 100
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 100
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 65,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; hold at top; maximum glute contraction"
      }
    },
    {
      "exerciseName": "Goblet Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "GOBLET SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; dumbbell/KB at chest; elbows track knees"
      }
    },
    {
      "exerciseName": "Hack Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "HACK SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; feet forward; machine or barbell behind legs"
      }
    },
    {
      "exerciseName": "Hammer Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "HAMMER CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; neutral grip; no swing"
      }
    },
    {
      "exerciseName": "Hanging Leg Raise",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "HANGING LEG RAISE",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 150,
            "max": 175
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 150,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 155,
        "upThreshold": 65,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; hanging; raise legs to parallel or above"
      }
    },
    {
      "exerciseName": "Hanging Windshield Wiper",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "HANGING WINDSHIELD WIPER",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 150,
            "max": 175
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 150,
            "max": 175
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; hanging; rotate legs side to side"
      }
    },
    {
      "exerciseName": "Heavy Leg Press Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "HEAVY LEG PRESS CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 150,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 150,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated on leg press; legs extended; plantarflex at top"
      }
    },
    {
      "exerciseName": "Heavy Overhead Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "HEAVY OVERHEAD PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 65,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; strict press; no leg drive; full lockout"
      }
    },
    {
      "exerciseName": "Hip Thrust",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "HIP THRUST",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 100
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 100
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 65,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; upper back on bench; full glute drive"
      }
    },
    {
      "exerciseName": "Incline Barbell Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "INCLINE BARBELL BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Incline bench; upper chest focus; full press extension"
      }
    },
    {
      "exerciseName": "Incline Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "INCLINE BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Incline bench; upper chest focus; full press extension"
      }
    },
    {
      "exerciseName": "Incline Cable Fly",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "INCLINE CABLE FLY",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 95,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 95,
            "max": 155
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 35,
            "max": 160
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 35,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 45,
        "upThreshold": 145,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; incline bench; chest fly motion"
      }
    },
    {
      "exerciseName": "Incline Dumbbell Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "INCLINE DUMBBELL CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated incline; arms hang behind body; full stretch"
      }
    },
    {
      "exerciseName": "Incline Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "INCLINE PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Hands elevated; side-facing; lower chest focus"
      }
    },
    {
      "exerciseName": "Inverted Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "INVERTED ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 165
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; body straight; pull chest to bar"
      }
    },
    {
      "exerciseName": "JM Press",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "JM PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 55,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 55,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front/lying; hybrid press-extension; tricep focus"
      }
    },
    {
      "exerciseName": "Jumping Jacks",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "JUMPING JACKS",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 20,
        "upThreshold": 150,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; track arm raise and return for rep count"
      }
    },
    {
      "exerciseName": "Jump Lunge",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "JUMP LUNGE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; explosive alternating lunge; soft landing"
      }
    },
    {
      "exerciseName": "Jump Rope",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "JUMP ROPE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 145,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 120,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 120,
            "max": 165
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; minimal hop; elbows at sides; wrist rotation"
      }
    },
    {
      "exerciseName": "Jump Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "JUMP SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; full squat then explosive jump"
      }
    },
    {
      "exerciseName": "Kettlebell Swing",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "KETTLEBELL SWING",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 120,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 120,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 45,
            "max": 170
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 45,
            "max": 170
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 75,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; hip snap is the driver; arms passive"
      }
    },
    {
      "exerciseName": "Lateral Lunge",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "LATERAL LUNGE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; step wide; hinge into one leg; chest up"
      }
    },
    {
      "exerciseName": "Lateral Raise",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "LATERAL RAISE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 150
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 145,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 20,
        "upThreshold": 130,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; slight elbow bend; raise to shoulder level"
      }
    },
    {
      "exerciseName": "Lat Pulldown",
      "movementFamily": "pull",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "LAT PULLDOWN",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated; pull bar to upper chest; squeeze lats"
      }
    },
    {
      "exerciseName": "Leg Curl",
      "movementFamily": "squat_lunge",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "LEG CURL",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 40,
            "max": 165
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 40,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 150,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated/prone; leg curl machine; full ROM hamstring flex"
      }
    },
    {
      "exerciseName": "Leg Extension",
      "movementFamily": "general",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "LEG EXTENSION",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 55,
            "max": 165
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 55,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 80,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated on machine; extend to near-lockout; controlled eccentric"
      }
    },
    {
      "exerciseName": "Leg Press",
      "movementFamily": "squat_lunge",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "LEG PRESS",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 165
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 125
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 125
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated; feet on platform; do not lock out knees"
      }
    },
    {
      "exerciseName": "Leg Press Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "LEG PRESS CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 150,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 150,
            "max": 175
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Legs extended on press; plantarflex toes only; full ROM"
      }
    },
    {
      "exerciseName": "Leg Raise",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "LEG RAISE",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 170
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 170
          },
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 145,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 155,
        "upThreshold": 65,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying/hanging; raise straight legs to 90°; controlled lower"
      }
    },
    {
      "exerciseName": "Loaded Donkey Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "LOADED DONKEY CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; knees locked; plantarflex at peak"
      }
    },
    {
      "exerciseName": "Pause Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "PAUSE CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; knees locked; plantarflex at peak"
      }
    },
    {
      "exerciseName": "Plyometric Calf Jump",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "PLYOMETRIC CALF JUMP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; knees locked; plantarflex at peak"
      }
    },
    {
      "exerciseName": "Standing Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "STANDING CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; knees locked; plantarflex at peak"
      }
    },
    {
      "exerciseName": "Step Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "STEP CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; knees locked; plantarflex at peak"
      }
    },
    {
      "exerciseName": "Lunges",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "LUNGES",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; front knee 90°; torso vertical"
      }
    },
    {
      "exerciseName": "Machine Chest Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "MACHINE CHEST PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 165
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 50,
            "max": 125
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 50,
            "max": 125
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated; machine press; full extension"
      }
    },
    {
      "exerciseName": "Machine Row",
      "movementFamily": "pull",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "MACHINE ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 110
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 110
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated; chest pad; full row ROM"
      }
    },
    {
      "exerciseName": "Machine Shoulder Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "MACHINE SHOULDER PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 65,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 90,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated; machine press; overhead lockout"
      }
    },
    {
      "exerciseName": "Machine Standing Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "MACHINE STANDING CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Standing under pads; knees locked; full plantarflexion"
      }
    },
    {
      "exerciseName": "Man Maker",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "MAN MAKER",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; push-up + row + clean + press combo"
      }
    },
    {
      "exerciseName": "Medicine Ball Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "MEDICINE BALL PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; one hand on med ball; full ROM"
      }
    },
    {
      "exerciseName": "Mountain Climbers",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "MOUNTAIN CLIMBERS",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 50,
            "max": 170
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 50,
            "max": 170
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 155,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 155,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 70,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; plank position; drive knees to chest alternately"
      }
    },
    {
      "exerciseName": "Muscle-Up",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "MUSCLE-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 165
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 170
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 170
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; explosive pull to bar and press through"
      }
    },
    {
      "exerciseName": "Nordic Hamstring Curl",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "NORDIC HAMSTRING CURL",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 55,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 155,
            "max": 178
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 155,
            "max": 178
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 165,
        "upThreshold": 75,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; ankles anchored; lower and raise body via hamstrings"
      }
    },
    {
      "exerciseName": "Overhead Barbell Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "OVERHEAD BARBELL PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 65,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; bar from clavicle to overhead lockout"
      }
    },
    {
      "exerciseName": "Overhead Cable Extension",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "OVERHEAD CABLE EXTENSION",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 55,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 55,
            "max": 170
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; upper arm vertical; full extension overhead"
      }
    },
    {
      "exerciseName": "Overhead Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "OVERHEAD SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; bar locked overhead; full depth"
      }
    },
    {
      "exerciseName": "Pallof Press",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "PALLOF PRESS",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 110
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 110
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 90,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 90,
            "max": 170
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 100,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-on to cable; press out and hold; resist rotation"
      }
    },
    {
      "exerciseName": "Pec Deck Machine",
      "movementFamily": "horizontal_push",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "PEC DECK MACHINE",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 80,
            "max": 100
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 80,
            "max": 100
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 155
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 155
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 50,
        "upThreshold": 140,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated; forearms on pads; fly to center"
      }
    },
    {
      "exerciseName": "Pendlay Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "PENDLAY ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 80
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 80
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; horizontal torso; explosive pull from floor"
      }
    },
    {
      "exerciseName": "Pistol Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "PISTOL SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 50,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 50,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 80,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; single leg; other leg extended forward"
      }
    },
    {
      "exerciseName": "Plank",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "PLANK",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 160,
            "max": 180
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 160,
            "max": 180
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 70,
            "max": 110
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 70,
            "max": 110
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; body straight; no hip sag or pike"
      }
    },
    {
      "exerciseName": "Plyometric Calf Jump",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "PLYOMETRIC CALF JUMP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 150,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 150,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 65,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 65,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 78,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; ankle-only jump; minimal knee bend"
      }
    },
    {
      "exerciseName": "Plyometric Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "PLYOMETRIC PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; explosive press; hands leave floor"
      }
    },
    {
      "exerciseName": "Power Clean",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "POWER CLEAN",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; explosive triple extension; high elbow catch"
      }
    },
    {
      "exerciseName": "Preacher Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "PREACHER CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated; arms braced on pad; full ROM curl"
      }
    },
    {
      "exerciseName": "Pull-Up",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "PULL-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; dead hang to chin over bar"
      }
    },
    {
      "exerciseName": "Push Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "PUSH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 85,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; leg drive assist; overhead lockout"
      }
    },
    {
      "exerciseName": "Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; rigid plank body; full ROM"
      }
    },
    {
      "exerciseName": "Push-Up to Renegade Row",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "PUSH-UP TO RENEGADE ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; push-up then alternate row; no hip rotation"
      }
    },
    {
      "exerciseName": "Rack Pull",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "RACK PULL",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 120,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 120,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 80,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; bar starts at knee height; hip lock at top"
      }
    },
    {
      "exerciseName": "Rear Delt Fly",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "REAR DELT FLY",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 100,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 100,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 150
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 40,
        "upThreshold": 140,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Bent forward; arms sweep rear; squeeze shoulder blades"
      }
    },
    {
      "exerciseName": "Renegade Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "RENEGADE ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; plank position; row one arm up"
      }
    },
    {
      "exerciseName": "Resistance Band Chest Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "RESISTANCE BAND CHEST PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Standing; band anchored behind; press forward"
      }
    },
    {
      "exerciseName": "Resistance Band Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "RESISTANCE BAND CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; band under feet; curl with control"
      }
    },
    {
      "exerciseName": "Resistance Band Lateral Raise",
      "movementFamily": "general",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "RESISTANCE BAND LATERAL RAISE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 10,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 10,
            "max": 150
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 145,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 145,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "shoulder",
        "downThreshold": 20,
        "upThreshold": 130,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; band under feet; lateral raise to shoulder height"
      }
    },
    {
      "exerciseName": "Resistance Band Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "RESISTANCE BAND ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 110
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 110
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; band anchored forward; row to torso"
      }
    },
    {
      "exerciseName": "Resistance Band Squat Press",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "RESISTANCE BAND SQUAT PRESS",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; band overhead; squat then press"
      }
    },
    {
      "exerciseName": "Reverse Barbell Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "REVERSE BARBELL CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; overhand grip; brachialis focus"
      }
    },
    {
      "exerciseName": "Romanian Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "ROMANIAN DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 140,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 140,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 45,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 45,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 80,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; soft knees; hip hinge; bar close to legs"
      }
    },
    {
      "exerciseName": "Rope Tricep Pushdown",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "ROPE TRICEP PUSHDOWN",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 50,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 50,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; elbows at sides; extend to lockout; split at bottom"
      }
    },
    {
      "exerciseName": "Russian Twist",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "RUSSIAN TWIST",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 60,
            "max": 110
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 60,
            "max": 110
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 100
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Seated V-sit; rotate torso side to side; feet off floor optional"
      }
    },
    {
      "exerciseName": "Sandbag Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "SANDBAG SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; sandbag on shoulder or chest; full depth"
      }
    },
    {
      "exerciseName": "Seal Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "SEAL ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 90
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 90
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Prone on elevated bench; no body swing; pure row"
      }
    },
    {
      "exerciseName": "Seated Cable Row",
      "movementFamily": "pull",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "SEATED CABLE ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 110
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 110
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated; cable row to lower chest; upright torso"
      }
    },
    {
      "exerciseName": "Seated Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "SEATED CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 105
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 105
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated; pads on knees; soleus-dominant; full plantarflex"
      }
    },
    {
      "exerciseName": "Seated Dumbbell Press",
      "movementFamily": "overhead_press",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "SEATED DUMBBELL PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 65,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Seated; press from ear height to lockout; no arch"
      }
    },
    {
      "exerciseName": "Single-Leg Bodyweight Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SINGLE-LEG BODYWEIGHT CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; single leg; balance and plantarflex"
      }
    },
    {
      "exerciseName": "Single-Leg Seated Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "SINGLE-LEG SEATED CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 105
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 105
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Seated; one leg at a time; full plantarflex"
      }
    },
    {
      "exerciseName": "Single-Leg Standing Barbell Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SINGLE-LEG STANDING BARBELL CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Standing; single leg; barbell on back; full plantarflex"
      }
    },
    {
      "exerciseName": "Skull Crusher",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SKULL CRUSHER",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 50,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 50,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying; bar lowers to forehead; elbows stationary"
      }
    },
    {
      "exerciseName": "Sled Push",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "SLED PUSH",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 130,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 130,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; forward lean; drive with legs; arms push handles"
      }
    },
    {
      "exerciseName": "Smith Machine Bench Press",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SMITH MACHINE BENCH PRESS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 45,
            "max": 130
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 45,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying on bench; Smith machine guides bar; press to full extension"
      }
    },
    {
      "exerciseName": "Smith Machine Calf Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SMITH MACHINE CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 70,
            "max": 130
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 70,
            "max": 130
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 82,
        "upThreshold": 118,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Standing under Smith bar; knees locked; plantarflex"
      }
    },
    {
      "exerciseName": "Snatch",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SNATCH",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; wide grip; explosive pull to overhead in one motion"
      }
    },
    {
      "exerciseName": "Spider Curl",
      "movementFamily": "bicep_curl",
      "bodyPosture": "sit_front_facing",
      "exerciseRule": {
        "label": "SPIDER CURL",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 30,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 30,
            "max": 160
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 155,
        "upThreshold": 50,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Chest on incline bench; arms hang; full ROM curl"
      }
    },
    {
      "exerciseName": "Spiderman Push-Up",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "SPIDERMAN PUSH-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; bring knee to elbow at bottom; alternate sides"
      }
    },
    {
      "exerciseName": "Sprint Intervals",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "SPRINT INTERVALS",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 55,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 55,
            "max": 155
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 55,
            "max": 155
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; high knees; arm drive; full sprint mechanics"
      }
    },
    {
      "exerciseName": "Stair Running",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "STAIR RUNNING",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 60,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 60,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 55,
            "max": 150
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 55,
            "max": 150
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; upright torso; drive knees; arm pump"
      }
    },
    {
      "exerciseName": "Step-Up",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "STEP-UP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; step fully up; full hip extension at top"
      }
    },
    {
      "exerciseName": "Step-Up with Dumbbell",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "STEP-UP WITH DUMBBELL",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; step fully up; full hip extension at top"
      }
    },
    {
      "exerciseName": "Suitcase Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "SUITCASE DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 100,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 100,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 40,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 70,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; weight on one side; anti-lateral-flexion; hip hinge"
      }
    },
    {
      "exerciseName": "Sumo Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SUMO DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 100,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 100,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 45,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 45,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 70,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing (shows wide stance); hip hinge with vertical torso"
      }
    },
    {
      "exerciseName": "Sumo Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "SUMO SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; wide stance; toes out; knees track toes"
      }
    },
    {
      "exerciseName": "Superman Hold",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "SUPERMAN HOLD",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 160,
            "max": 180
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 160,
            "max": 180
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 155,
            "max": 175
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 155,
            "max": 175
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Prone; side-facing; lift arms, chest, and legs simultaneously"
      }
    },
    {
      "exerciseName": "T-Bar Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "T-BAR ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 20,
            "max": 90
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 20,
            "max": 90
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; straddling bar; full elbow drive row"
      }
    },
    {
      "exerciseName": "Thruster",
      "movementFamily": "overhead_press",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "THRUSTER",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 170
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 170
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 85,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Front-facing; front squat into overhead press; one fluid motion"
      }
    },
    {
      "exerciseName": "Tibialis Raise",
      "movementFamily": "calves",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "TIBIALIS RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 180
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 180
          },
          {
            "label": "L Ankle",
            "a": 25,
            "b": 27,
            "c": 31,
            "min": 65,
            "max": 100
          },
          {
            "label": "R Ankle",
            "a": 26,
            "b": 28,
            "c": 32,
            "min": 65,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "ankle",
        "downThreshold": 92,
        "upThreshold": 72,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Heels on elevated surface; dorsiflex toes up; tibialis anterior focus"
      }
    },
    {
      "exerciseName": "Toes to Bar",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "TOES TO BAR",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 30,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 30,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 150,
            "max": 175
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 150,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 155,
        "upThreshold": 45,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; hanging; bring toes to bar; minimal swing"
      }
    },
    {
      "exerciseName": "Trap Bar Deadlift",
      "movementFamily": "hip_hinge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "TRAP BAR DEADLIFT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 90,
            "max": 178
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 90,
            "max": 178
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 45,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 45,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 70,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; neutral handles; slight more quad-dominant than barbell DL"
      }
    },
    {
      "exerciseName": "Tricep Dips",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "TRICEP DIPS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; upright torso; elbows tuck; extend fully"
      }
    },
    {
      "exerciseName": "Tricep Kickback",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "TRICEP KICKBACK",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 55,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 55,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; upper arm parallel to floor; extend and squeeze"
      }
    },
    {
      "exerciseName": "Tricep Overhead Extension",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "TRICEP OVERHEAD EXTENSION",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 50,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 50,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; elbow position fixed; extend to lockout"
      }
    },
    {
      "exerciseName": "Tricep Pushdown",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "TRICEP PUSHDOWN",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 50,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 50,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 70,
        "upThreshold": 160,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; elbow position fixed; extend to lockout"
      }
    },
    {
      "exerciseName": "Tuck Jump",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "TUCK JUMP",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 40,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 40,
            "max": 175
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 35,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 35,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 90,
        "upThreshold": 40,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; explosive jump; pull knees to chest at top"
      }
    },
    {
      "exerciseName": "Upright Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "UPRIGHT ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 150
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 150
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 150
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 150
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 140,
        "upThreshold": 55,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; bar rises to chin; elbows above shoulders"
      }
    },
    {
      "exerciseName": "V-Up",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "V-UP",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 30,
            "max": 170
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 30,
            "max": 170
          },
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 150,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 150,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 155,
        "upThreshold": 45,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Lying supine; crunch torso and legs to meet at top; controlled lower"
      }
    },
    {
      "exerciseName": "Walking Lunge",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "WALKING LUNGE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; alternate legs; front knee 90° at bottom"
      }
    },
    {
      "exerciseName": "Wall Sit",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "WALL SIT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 80,
            "max": 100
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 80,
            "max": 100
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 80,
            "max": 100
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 80,
            "max": 100
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; back against wall; thighs parallel; hold position"
      }
    },
    {
      "exerciseName": "Weighted Cable Crunch",
      "movementFamily": "core",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "WEIGHTED CABLE CRUNCH",
        "joints": [
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 35,
            "max": 120
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 35,
            "max": 120
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 100
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 100
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "hip",
        "downThreshold": 55,
        "upThreshold": 110,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Kneeling; side-facing; crunch elbows toward knees"
      }
    },
    {
      "exerciseName": "Weighted Chest Dips",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "WEIGHTED CHEST DIPS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 165
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 120
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 120
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; slight forward lean; chest dip focus"
      }
    },
    {
      "exerciseName": "Weighted Chin-Up",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "WEIGHTED CHIN-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; added weight; supinated grip; chin over bar"
      }
    },
    {
      "exerciseName": "Weighted Dips",
      "movementFamily": "horizontal_push",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "WEIGHTED DIPS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 65,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 65,
            "max": 165
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 125
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 125
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 80,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; weight belt; full ROM dip"
      }
    },
    {
      "exerciseName": "Weighted Pull-Up",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "WEIGHTED PULL-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; added weight; dead hang to chin over bar"
      }
    },
    {
      "exerciseName": "Weighted Step-Up Calf Raise",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "WEIGHTED STEP-UP CALF RAISE",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; step up then plantarflex at top; controlled"
      }
    },
    {
      "exerciseName": "Weighted Tricep Dips",
      "movementFamily": "triceps_extension",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "WEIGHTED TRICEP DIPS",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 60,
            "max": 165
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 60,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 75,
        "upThreshold": 155,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; upright torso; tricep-focused dip with weight"
      }
    },
    {
      "exerciseName": "Wide Grip Pull-Up",
      "movementFamily": "pull",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "WIDE GRIP PULL-UP",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 160
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 160
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 40,
            "max": 165
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 40,
            "max": 165
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 145,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; wide pronated grip; lat-dominant pull"
      }
    },
    {
      "exerciseName": "Windmill",
      "movementFamily": "dynamic_full_body",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "WINDMILL",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 155,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 155,
            "max": 175
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 70,
            "max": 170
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 70,
            "max": 170
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; kettlebell overhead; hinge and reach opposite hand to floor"
      }
    },
    {
      "exerciseName": "Woodchop Cable",
      "movementFamily": "core",
      "bodyPosture": "stand_front_facing",
      "exerciseRule": {
        "label": "WOODCHOP CABLE",
        "joints": [
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 30,
            "max": 155
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 30,
            "max": 155
          },
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 130,
            "max": 175
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 130,
            "max": 175
          }
        ]
      },
      "movementConfig": null,
      "trainerChecks": {
        "strict": false,
        "notes": "Front-facing; rotate from high to low (or low to high); arms straight"
      }
    },
    {
      "exerciseName": "Yates Row",
      "movementFamily": "pull",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "YATES ROW",
        "joints": [
          {
            "label": "L Elbow",
            "a": 11,
            "b": 13,
            "c": 15,
            "min": 45,
            "max": 150
          },
          {
            "label": "R Elbow",
            "a": 12,
            "b": 14,
            "c": 16,
            "min": 45,
            "max": 150
          },
          {
            "label": "L Shoulder",
            "a": 13,
            "b": 11,
            "c": 23,
            "min": 25,
            "max": 90
          },
          {
            "label": "R Shoulder",
            "a": 14,
            "b": 12,
            "c": 24,
            "min": 25,
            "max": 90
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "elbow",
        "downThreshold": 140,
        "upThreshold": 60,
        "downWhenAngleIsLower": false
      },
      "trainerChecks": {
        "strict": false,
        "notes": "Side-facing; slight underhand; torso 70-80° upright row"
      }
    },
    {
      "exerciseName": "Zercher Squat",
      "movementFamily": "squat_lunge",
      "bodyPosture": "stand_side_facing",
      "exerciseRule": {
        "label": "ZERCHER SQUAT",
        "joints": [
          {
            "label": "L Knee",
            "a": 23,
            "b": 25,
            "c": 27,
            "min": 65,
            "max": 175
          },
          {
            "label": "R Knee",
            "a": 24,
            "b": 26,
            "c": 28,
            "min": 65,
            "max": 175
          },
          {
            "label": "L Hip",
            "a": 11,
            "b": 23,
            "c": 25,
            "min": 55,
            "max": 175
          },
          {
            "label": "R Hip",
            "a": 12,
            "b": 24,
            "c": 26,
            "min": 55,
            "max": 175
          }
        ]
      },
      "movementConfig": {
        "primaryJoint": "knee",
        "downThreshold": 95,
        "upThreshold": 165,
        "downWhenAngleIsLower": true
      },
      "trainerChecks": {
        "strict": true,
        "notes": "Side-facing; bar in elbow crooks; upright torso; full depth"
      }
    }
  ]
}```

---

## 4. WorkoutScreen.tsx (integration)

**File:** `mobile/src/screens/WorkoutScreen.tsx`

MediaPipe-related imports, state, handlers, and UI:

```typescript
import MediaPipeGuidanceView from "../components/MediaPipeGuidanceView";
import type { MediaPipeGuidanceViewProps } from "../components/MediaPipeGuidanceView";

  const [mediaPipeReady, setMediaPipeReady] = useState(false);

  const openCameraTracker = async () => {
    setCameraError(null);
    setMediaPipeReady(false);
    try {
      if (!cameraPermission) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          setCameraError("Camera permission denied. Please allow camera access.");
          setShowCamera(true);
          return;
        }
      } else if (!cameraPermission.granted) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          setCameraError("Camera permission denied. Please allow camera access.");
          setShowCamera(true);
          return;
        }
      }
      setShowCamera(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Camera failed to open.";
      setCameraError(message);
      setShowCamera(true);
    }
  };
  const closeCameraTracker = () => {
    // Ensure detection/camera stream shuts down with the view.
    setShowCamera(false);
    setMediaPipeReady(false);
    setCameraError(null);
  };

  const accentPlanner = ["#3b82f6", "#22d3ee", "transparent"] as const;
  const accentHistory = ["#ef4444", "#fb7185", "transparent"] as const;
  const dropdownColors = { ...colors, inputBg: colors.inputBg };
  const canOpenCamera = exerciseName !== SELECT_CHOICE;
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const todayHistory = useMemo(() => {
    if (!todayKey) return [];
    return history.filter((item) => toDateKey(item?.date) === todayKey);
  }, [history, todayKey]);
  const latestTodayWorkout = todayHistory[0];
  const latestWorkoutLabel = latestTodayWorkout ? sessionHistoryLabel(latestTodayWorkout) : "No sessions logged today";
  const todayCaloriesBurned = useMemo(
    () => todayHistory.reduce((sum, item) => sum + (Number(item?.caloriesBurned) || 0), 0),
    [todayHistory],
  );
  const todaySessionCount = todayHistory.length;
  const mediaPipeProps: MediaPipeGuidanceViewProps = {
    selectedExerciseName: canOpenCamera ? exerciseName : undefined,
    isActive: showCamera,
    onReady: () => {
      setMediaPipeReady(true);
      setCameraError(null);
    },
    onError: (message: string) => {
      setCameraError(message);
      setMediaPipeReady(false);
    },
  };

      <Modal visible={showCamera} transparent animationType="slide" onRequestClose={closeCameraTracker}>
        <View style={styles.cameraModalBackdrop}>
          <View style={[styles.cameraModalCard, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.lg }]}>
            <View style={styles.cameraHeaderRow}>
              <Text style={[styles.cameraTitle, { color: colors.text }]}>Workout camera tracker</Text>
              <Pressable
                style={[styles.cameraCloseBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                onPress={closeCameraTracker}
              >
                <Text style={[styles.cameraCloseText, { color: colors.text }]}>Close</Text>
              </Pressable>
            </View>
            {cameraPermission?.granted ? (
              <View style={[styles.cameraPreviewWrap, { borderColor: colors.border }]}>
                <MediaPipeGuidanceView
                  {...mediaPipeProps}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close camera"
                  style={[styles.cameraFloatingCloseBtn, { borderColor: colors.border, backgroundColor: "rgba(0,0,0,0.6)" }]}
                  onPress={closeCameraTracker}
                >
                  <Text style={styles.cameraFloatingCloseText}>✕</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.cameraPermissionBox, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
                <Text style={[styles.cameraPermissionText, { color: colors.text }]}>
                  {cameraError || "Camera permission is required to use workout tracking."}
                </Text>
                <Pressable
                  style={[styles.cameraAllowBtn, { borderColor: colors.primary, backgroundColor: colors.primary }]}
                  onPress={() => void openCameraTracker()}
                >
                  <Text style={[styles.cameraAllowText, { color: colors.background }]}>Allow Camera</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
```
