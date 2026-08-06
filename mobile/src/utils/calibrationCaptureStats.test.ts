/**
 * Run: npx --yes tsx src/utils/calibrationCaptureStats.test.ts
 * (from mobile/)
 */
import assert from "node:assert/strict";
import {
  aggregateSquats,
  aggregateTpose,
  aggregateTurnConfidence,
  type CalibrationCaptureSample,
  computeTurnProgress,
  createSquatRepState,
  estimateTurnAngleBucket,
  stepSquatRep,
  shouldCaptureSquatDepthSample,
} from "./calibrationCaptureStats";

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthTpose(rand: () => number): CalibrationCaptureSample[] {
  return Array.from({ length: 95 }, () => ({
    torsoLen: 0.31 + (rand() - 0.5) * 0.008,
    shoulderWidth: 0.19 + (rand() - 0.5) * 0.006,
    hipWidth: 0.14 + (rand() - 0.5) * 0.004,
    upperArmL: 0.13 + (rand() - 0.5) * 0.004,
    upperArmR: 0.132 + (rand() - 0.5) * 0.004,
    thighL: 0.2 + (rand() - 0.5) * 0.005,
    thighR: 0.201 + (rand() - 0.5) * 0.005,
    shankL: 0.19 + (rand() - 0.5) * 0.004,
    shankR: 0.191 + (rand() - 0.5) * 0.004,
    knee: 167 + (rand() - 0.5) * 3,
    hip: 175 + (rand() - 0.5) * 2,
    ankleFlex: 30 + (rand() - 0.5) * 2,
    ratio: 0.62 + (rand() - 0.5) * 0.02,
    torsoLean: 8 + (rand() - 0.5) * 1,
    lVis: 0.65 + rand() * 0.3,
    noseX: 0.5,
    shoulderMidX: 0.5,
  }));
}

function synthSquats(noiseSeed: number): CalibrationCaptureSample[] {
  const rand = mulberry32(noiseSeed);
  const samples: CalibrationCaptureSample[] = [];
  let state = createSquatRepState();
  const knees: number[] = [];
  const pattern = [168, 160, 145, 138, 135];
  for (const k of pattern) knees.push(k);
  for (let i = 0; i < 10; i += 1) knees.push(128);
  knees.push(135, 145, 160, 168, 168, 160, 142, 130);
  for (let i = 0; i < 10; i += 1) knees.push(127);
  knees.push(135, 145, 160, 168);
  for (const baseKnee of knees) {
    const knee = baseKnee;
    state = stepSquatRep(state, knee);
    if (shouldCaptureSquatDepthSample(state, knee)) {
      samples.push({
        torsoLen: 0.31,
        shoulderWidth: 0.19,
        hipWidth: 0.14,
        upperArmL: 0.13,
        upperArmR: 0.13,
        thighL: 0.2,
        thighR: 0.2,
        shankL: 0.19,
        shankR: 0.19,
        knee: knee + (rand() - 0.5) * 1.5,
        hip: 95 + (rand() - 0.5) * 1.5,
        ankleFlex: 28 + (rand() - 0.5) * 1,
        ratio: 0.35,
        torsoLean: 12,
        lVis: 0.72 + rand() * 0.2,
      });
    }
  }
  return samples;
}

function synthTurn(rand: () => number): CalibrationCaptureSample[] {
  const samples: CalibrationCaptureSample[] = [];
  const poses: Array<{ ratio: number; noseOffset: number }> = [
    { ratio: 0.62, noseOffset: 0 },
    { ratio: 0.48, noseOffset: 0.35 },
    { ratio: 0.2, noseOffset: 0.8 },
    { ratio: 0.18, noseOffset: 0.75 },
    { ratio: 0.18, noseOffset: -0.75 },
    { ratio: 0.2, noseOffset: -0.8 },
    { ratio: 0.6, noseOffset: -0.05 },
    { ratio: 0.62, noseOffset: 0.02 },
  ];
  for (const p of poses) {
    for (let i = 0; i < 8; i += 1) {
      const shoulderWidth = 0.19;
      const torsoLen = 0.31;
      const ratio = p.ratio + (rand() - 0.5) * 0.015;
      const shoulderMidX = 0.5;
      samples.push({
        torsoLen,
        shoulderWidth,
        hipWidth: 0.14,
        upperArmL: 0.13,
        upperArmR: 0.13,
        thighL: 0.2,
        thighR: 0.2,
        shankL: 0.19,
        shankR: 0.19,
        knee: 168,
        hip: 175,
        ankleFlex: 30,
        ratio,
        torsoLean: 8,
        lVis: 0.68 + rand() * 0.25,
        noseX: shoulderMidX + p.noseOffset * shoulderWidth + (rand() - 0.5) * 0.01,
        shoulderMidX,
      });
    }
  }
  return samples;
}

// --- T-pose repeatability (two back-to-back runs, seeds 42 & 43) ---
{
  const r1 = aggregateTpose(synthTpose(mulberry32(42)));
  const r2 = aggregateTpose(synthTpose(mulberry32(43)));
  const ratioDelta = Math.abs(r1.frontShoulderRatio - r2.frontShoulderRatio);
  const armDeltaPct = Math.abs(r1.limbs.upperArmL - r2.limbs.upperArmL) / r1.limbs.upperArmL;
  const thighDeltaPct = Math.abs(r1.limbs.thighL - r2.limbs.thighL) / r1.limbs.thighL;
  console.log("[repeatability] T-pose run1 frontShoulderRatio=", r1.frontShoulderRatio.toFixed(4));
  console.log("[repeatability] T-pose run2 frontShoulderRatio=", r2.frontShoulderRatio.toFixed(4));
  console.log("[repeatability] T-pose |Δratio|=", ratioDelta.toFixed(4), "armΔ%=", (armDeltaPct * 100).toFixed(2));
  assert(ratioDelta <= 0.03, `frontShoulderRatio delta ${ratioDelta}`);
  assert(armDeltaPct <= 0.05, `upperArmL delta ${armDeltaPct}`);
  assert(thighDeltaPct <= 0.05, `thighL delta ${thighDeltaPct}`);
}

// --- Squats repeatability ---
{
  const r1 = aggregateSquats(synthSquats(101));
  const r2 = aggregateSquats(synthSquats(102));
  const depthDelta = Math.abs(r1.squatDepthDeg - r2.squatDepthDeg);
  console.log("[repeatability] Squats run1 depthDeg=", r1.squatDepthDeg.toFixed(2));
  console.log("[repeatability] Squats run2 depthDeg=", r2.squatDepthDeg.toFixed(2));
  console.log("[repeatability] Squats |Δdepth|=", depthDelta.toFixed(2), "°");
  assert(depthDelta <= 3, `squat depth delta ${depthDelta}°`);
}

// --- Turn bucketing ---
{
  const samples = synthTurn(mulberry32(7));
  const progress = computeTurnProgress(samples, 0.62);
  assert(progress.hasFront, "turn should see front bucket");
  assert(progress.hasSide, "turn should see side bucket");
  assert(progress.complete, "turn should complete with synthetic sweep");
  const conf = aggregateTurnConfidence(samples, 0.62);
  assert(conf["90"] > 0, "side bucket confidence");
  assert(conf["0"] > 0, "front bucket confidence");
  const bucket = estimateTurnAngleBucket(samples[0], 0.62);
  assert(bucket && ["0", "315", "45"].includes(bucket), `front bucket got ${bucket}`);
}

// --- Low-visibility exclusion ---
{
  const samples = synthTurn(mulberry32(1));
  const before = aggregateTurnConfidence(samples.slice(0, -1), 0.62);
  samples.push({ ...samples[0], lVis: 0.2, ratio: 0.99, noseX: 0.9 });
  const after = aggregateTurnConfidence(samples, 0.62);
  assert.deepEqual(after, before, "low-vis sample must not affect confidence");
}

console.log("calibrationCaptureStats.test.ts: all assertions passed");
