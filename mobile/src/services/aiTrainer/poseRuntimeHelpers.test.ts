import assert from "node:assert/strict";
import {
  BOTTOM_ANGLE_TOLERANCE_DEG,
  resolveCountBottom,
  resolveFormBottom,
} from "./poseRuntimeHelpers";
import type { ResolvedPoseSpec } from "../../data/aiTrainer/types";
import { DEFAULT_POSE_CALIBRATION } from "../../data/aiTrainer/types";
import type { RepRule } from "./repStateMachine";

function spec(
  family: string,
  bottom: number,
  depthTarget?: number,
): ResolvedPoseSpec & { _depthTargetDeg?: number } {
  return {
    id: "test",
    family,
    view: "side",
    repJoint: "knee",
    repRule: { topAngle: 160, bottomAngle: bottom },
    checks: [],
    machineProfileId: null,
    machineProfile: null,
    ...(depthTarget != null ? { _depthTargetDeg: depthTarget } : {}),
  };
}

// F1: non-squat families use spec bottom, not calibration mobility leak
assert.equal(
  resolveFormBottom(spec("curl", 150), { bottomAngle: 150, direction: "inverted" }, DEFAULT_POSE_CALIBRATION),
  150,
);
assert.equal(
  resolveFormBottom(spec("horizontal_press", 85), { bottomAngle: 85 }, DEFAULT_POSE_CALIBRATION),
  85,
);
assert.equal(
  resolveFormBottom(spec("vertical_pull", 70), { bottomAngle: 70 }, DEFAULT_POSE_CALIBRATION),
  70,
);
assert.equal(
  resolveFormBottom(spec("hip_hinge", 80), { bottomAngle: 80 }, DEFAULT_POSE_CALIBRATION),
  80,
);
assert.equal(
  resolveFormBottom(spec("leg_isolation", 95), { bottomAngle: 95 }, DEFAULT_POSE_CALIBRATION),
  95,
);

// Squat/lunge: calibrated depth via _depthTargetDeg
assert.equal(
  resolveFormBottom(spec("squat_lunge", 101, 101), { bottomAngle: 101 }, DEFAULT_POSE_CALIBRATION),
  101,
);

// F5: explicit per-exercise bottom (leg_press) — no _depthTargetDeg, uses repRule
assert.equal(
  resolveFormBottom(spec("squat_lunge", 90), { bottomAngle: 90 }, DEFAULT_POSE_CALIBRATION),
  90,
);

// F16: count bottom matches form bottom
assert.equal(resolveCountBottom(150, 60, true), 150);
assert.equal(resolveCountBottom(101, 160, false), 101);
assert.equal(BOTTOM_ANGLE_TOLERANCE_DEG, 5);

console.log("poseRuntimeHelpers.test.ts: ok");
