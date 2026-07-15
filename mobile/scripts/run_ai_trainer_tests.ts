/**
 * Lightweight unit checks for AI trainer core (no Jest).
 * Run: cd mobile && node --import tsx scripts/run_ai_trainer_tests.ts
 */
import assert from "node:assert/strict";
import {
  createPhaseMachine,
  emaAngle,
  stepPhaseMachine,
} from "../src/services/aiTrainer/repStateMachine";
import {
  classifyOrientationFrame,
  orientationMatches,
} from "../src/services/aiTrainer/orientation";
import { scoreSetFromReps } from "../src/data/aiTrainer/formScore";
import { remapSpecWithCalibration, resolvePoseSpec } from "../src/data/aiTrainer/resolvePoseSpec";
import type { AiRepEvent, PoseCalibration } from "../src/data/aiTrainer/types";
import en from "../src/i18n/locales/en.json";
import hi from "../src/i18n/locales/hi.json";
import hinglish from "../src/i18n/locales/hinglish.json";
import es from "../src/i18n/locales/es.json";
import fr from "../src/i18n/locales/fr.json";
import de from "../src/i18n/locales/de.json";

// --- rep machine ---
{
  const rule = { topAngle: 160, bottomAngle: 95, minRepDurationSec: 0.01 };
  let st = createPhaseMachine();
  for (const a of [155, 140, 120, 100, 92, 90, 90, 90, 90]) {
    ({ state: st } = stepPhaseMachine(st, a, rule, 1000));
  }
  let completed = false;
  for (const a of [100, 120, 140, 155, 162, 165, 165, 165, 165]) {
    const r = stepPhaseMachine(st, a, rule, 2000);
    st = r.state;
    if (r.repCompleted) completed = true;
  }
  assert.equal(completed, true, "normal rep counted");
  assert.equal(st.repCount, 1);
}

{
  const rule = {
    topAngle: 60,
    bottomAngle: 150,
    direction: "inverted" as const,
    minRepDurationSec: 0.01,
  };
  let st = createPhaseMachine();
  for (const a of [80, 100, 130, 150, 155, 155, 155, 155]) {
    ({ state: st } = stepPhaseMachine(st, a, rule, 1000));
  }
  let completed = false;
  for (const a of [130, 100, 80, 60, 55, 55, 55, 55]) {
    const r = stepPhaseMachine(st, a, rule, 2000);
    st = r.state;
    if (r.repCompleted) completed = true;
  }
  assert.equal(completed, true, "inverted curl counted");
}

assert.equal(emaAngle(null, 100), 100);
assert.ok(Math.abs(emaAngle(100, 0, 0.35) - 65) < 0.01);

// --- remapping ---
{
  const spec = resolvePoseSpec("Goblet Squat");
  assert.ok(spec, "goblet squat has poseSpec");
  const cal: PoseCalibration = {
    torsoLen: 0.3,
    shoulderWidth: 0.18,
    hipWidth: 0.14,
    limbs: {
      upperArmL: 0.12,
      upperArmR: 0.12,
      thighL: 0.2,
      thighR: 0.2,
      shankL: 0.18,
      shankR: 0.18,
    },
    asymmetryFlags: [],
    mobility: { depthTargetDeg: 102, hingeMaxDeg: 95, dorsiflexionProxyDeg: 28 },
    confidenceByAngle: {},
    calibratedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  };
  const remapped = remapSpecWithCalibration(spec!, cal);
  const depth = remapped.checks.find((c) => c.id === "depth");
  assert.ok(depth?.rule.includes("102"));
  assert.equal(depth?.cue, "cue_full_range_ok");
}

// --- orientation ---
{
  const mk = (lx: number, rx: number, vis = 0.9) => {
    const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }));
    lms[11] = { x: lx, y: 0.3, visibility: vis };
    lms[12] = { x: rx, y: 0.3, visibility: vis };
    lms[23] = { x: 0.45, y: 0.55, visibility: vis };
    lms[24] = { x: 0.55, y: 0.55, visibility: vis };
    return lms;
  };
  assert.equal(classifyOrientationFrame(mk(0.35, 0.65)).orientation, "front");
  assert.equal(orientationMatches("front_45", "front"), true);
  assert.equal(orientationMatches("side", "front"), false);
}

// --- form score ---
{
  const reps: AiRepEvent[] = [
    {
      repIndex: 1,
      verdict: "flagged",
      failedChecks: ["depth"],
      tempo: { eccentricSec: 1, concentricSec: 1 },
      peakAngles: {},
    },
    {
      repIndex: 2,
      verdict: "clean",
      failedChecks: [],
      tempo: { eccentricSec: 1, concentricSec: 1 },
      peakAngles: {},
    },
  ];
  const score = scoreSetFromReps(reps, { depth: "critical" });
  assert.ok(score < 100 && score >= 40);
}

// --- i18n cue key parity ---
const CUE_KEYS = [
  "cue_go_deeper",
  "cue_chest_up",
  "cue_sit_back",
  "cue_heels_down",
  "cue_knees_out",
  "cue_slow_down",
  "cue_flat_back",
  "cue_soft_knees",
  "cue_squeeze_glutes",
  "cue_bar_close",
  "cue_full_range",
  "cue_press_lockout",
  "cue_tuck_elbows",
  "cue_even_press",
  "cue_lockout_overhead",
  "cue_ribs_down",
  "cue_no_swing",
  "cue_pull_back",
  "cue_full_stretch",
  "cue_shoulders_down",
  "cue_full_hang",
  "cue_pull_higher",
  "cue_no_kipping",
  "cue_pin_elbows",
  "cue_lock_upper_arm",
  "cue_full_lockout",
  "cue_to_shoulder_height",
  "cue_soft_elbows",
  "cue_hips_down",
  "cue_control_negative",
  "cue_knee_position",
  "cue_hips_level",
  "cue_neck_neutral",
  "cue_soft_lockout",
  "cue_drop_back_knee",
  "cue_drive_lead_leg",
  "cue_chin_tuck",
  "cue_hinge_not_squat",
  "cue_press_together",
  "cue_chest_to_floor",
  "cue_lean_forward",
  "cue_hold_hinge",
  "cue_sit_tall",
  "cue_elbows_high",
  "cue_arms_straight",
  "cue_straight_up",
  "cue_dont_go_lower",
  "cue_upper_arm_level",
  "cue_brace_core",
  "cue_clean_rep",
  "cue_streak",
  "cue_set_done",
  "cue_turn_side",
  "cue_turn_front",
  "cue_low_light",
  "cue_move_back",
  "cue_full_range_ok",
  "cam_flat_bench",
  "cam_incline_bench",
  "cam_decline_bench",
  "cam_upright_bench",
  "cam_seated_chest_press",
  "cam_seated_shoulder_press",
  "cam_pec_deck",
  "cam_lat_pulldown",
  "cam_seated_row",
  "cam_chest_supported_row",
  "cam_t_bar",
  "cam_bench_support_row",
  "cam_cable_station",
  "cam_preacher_bench",
  "cam_smith_rack",
  "cam_hack_squat",
  "cam_leg_press",
  "cam_leg_extension",
  "cam_lying_leg_curl",
  "cam_seated_leg_curl",
  "cam_standing_calf",
  "cam_seated_calf",
  "cam_hip_thrust",
  "cal_title",
  "cal_fair",
  "cal_limb",
  "cal_baseline",
  "cal_mobility",
  "cal_depth",
  "cal_step",
  "cal_skip",
  "calibrate_banner",
];

const locales: Record<string, any> = { en, hi, hinglish, es, fr, de };
for (const [name, loc] of Object.entries(locales)) {
  const block = loc.aiTrainer || {};
  for (const k of CUE_KEYS) {
    assert.ok(typeof block[k] === "string" && block[k].length > 0, `missing aiTrainer.${k} in ${name}`);
  }
}

console.log("ai trainer core tests: PASS");
