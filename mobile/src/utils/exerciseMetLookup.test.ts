/**
 * Run: npx --yes tsx src/utils/exerciseMetLookup.test.ts
 */
import assert from "node:assert/strict";
import { resolveMetForExercise } from "./exerciseMetLookup";
import { calcExerciseEstimateKcal } from "./sessionCalories";

const weightKg = 75;
const sets = 3;

const bugExercises = {
  Dips: 45,
  "Cable Fly": 33,
  "Tricep Pushdown": 30,
  "Incline Dumbbell Press": 42,
};

for (const [name, expected] of Object.entries(bugExercises)) {
  const kcal = calcExerciseEstimateKcal(name, sets, weightKg);
  assert.equal(kcal, expected, `${name} kcal mismatch (met=${resolveMetForExercise(name)})`);
}

const distinct = new Set(
  Object.keys(bugExercises).map((name) => calcExerciseEstimateKcal(name, sets, weightKg)),
);
assert.equal(distinct.size, 4, "bug-report exercises should not all share the same kcal");

assert.equal(resolveMetForExercise("Totally Unknown Move"), 5.0);

console.log("exerciseMetLookup.test.ts: all assertions passed");
