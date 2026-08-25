/**
 * Run: npx --yes tsx src/utils/sessionCalories.active.test.ts
 */
import assert from "node:assert/strict";
import { calcActiveSetKcal } from "./sessionCalories";

const WEIGHT = 75;
const MET = 5.5;

const fast10 = calcActiveSetKcal({
  exerciseName: "Dips",
  userWeightKg: WEIGHT,
  metValue: MET,
  workSec: 35,
  restSec: 90,
  reps: 10,
  prescribedReps: 10,
});
const low6 = calcActiveSetKcal({
  exerciseName: "Dips",
  userWeightKg: WEIGHT,
  metValue: MET,
  workSec: 35,
  restSec: 90,
  reps: 6,
  prescribedReps: 10,
});
const high15 = calcActiveSetKcal({
  exerciseName: "Dips",
  userWeightKg: WEIGHT,
  metValue: MET,
  workSec: 50,
  restSec: 90,
  reps: 15,
  prescribedReps: 10,
});

assert.equal(fast10, 16);
assert.equal(low6, 13);
assert.equal(high15, 18);
assert.notEqual(fast10, low6);

console.log("sessionCalories.active.test.ts: all assertions passed");
