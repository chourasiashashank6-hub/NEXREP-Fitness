import {
  calibrationNeedsRecalibration,
  computePersonalizedDepthTarget,
  finalizeCalibration,
  mergeCalibrationStep,
} from "./calibrationMerge";

describe("calibrationMerge", () => {
  it("computes depth from user ROM not fixed clamp", () => {
    const depth = computePersonalizedDepthTarget(82, 168);
    expect(depth).toBeGreaterThanOrEqual(65);
    expect(depth).toBeLessThan(156);
    expect(depth).toBeLessThan(100);
  });

  it("does not let turn step overwrite squat depth", () => {
    let acc = mergeCalibrationStep({}, "tpose", {
      torsoLen: 0.31,
      shoulderWidth: 0.19,
      standingKneeDeg: 168,
      frontShoulderRatio: 0.62,
    });
    acc = mergeCalibrationStep(acc, "squats", {
      squatDepthDeg: 78,
      mobility: { depthTargetDeg: 78, hingeMaxDeg: 88, dorsiflexionProxyDeg: 32 },
    });
    acc = mergeCalibrationStep(acc, "turn", {
      mobility: { depthTargetDeg: 105, hingeMaxDeg: 95, dorsiflexionProxyDeg: 28 },
    });
    const final = finalizeCalibration(acc);
    expect(final.mobility.depthTargetDeg).toBeLessThan(95);
    expect(final.squatDepthDeg).toBe(78);
  });

  it("flags corrupted calibration", () => {
    expect(
      calibrationNeedsRecalibration({
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
        mobility: { depthTargetDeg: 105, hingeMaxDeg: 95, dorsiflexionProxyDeg: 28 },
        confidenceByAngle: {},
        calibratedAt: "2026-01-01",
        version: 1,
        standingKneeDeg: 168,
      }),
    ).toBe(true);
  });
});
