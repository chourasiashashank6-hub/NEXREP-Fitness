import assert from "node:assert/strict";
import { getExerciseCoachCue } from "./exerciseGuidanceLookup";
import { resolveExerciseCoachMuscles } from "./resolveExerciseCoachMuscles";
import {
  buildExerciseBestMap,
  exercisesMatch,
  lookupExerciseBest,
} from "./sessionExerciseBest";

assert.deepEqual(resolveExerciseCoachMuscles("Barbell Bench Press"), ["Chest", "Shoulders", "Triceps"]);
assert.deepEqual(resolveExerciseCoachMuscles("Barbell Row"), ["Shoulders", "Back", "Biceps"]);
assert.deepEqual(resolveExerciseCoachMuscles("Unknown Move", "Legs"), ["Legs"]);

const cue = getExerciseCoachCue("Barbell Bench Press");
assert.ok(cue && cue.length > 10, "expected authored coach cue for bench press");

assert.ok(exercisesMatch("Bench Press", "Barbell Bench Press"));
assert.ok(!exercisesMatch("Squat", "Bench Press"));

const bestMap = buildExerciseBestMap(
  {
    goal_type: "strength",
    lifts: [
      {
        exercise_name: "Barbell Bench Press",
        target_weight_kg: 100,
        current_best_1rm_kg: 95,
        percent: 95,
        best_lift: { id: 1, weight_kg: 80, reps: 5, date: "2026-01-15" },
      },
    ],
    overall_percent: 95,
    weeks_left: 8,
    has_target_lifts: true,
  },
  [],
);

const benchBest = lookupExerciseBest(bestMap, "Bench Press");
assert.equal(benchBest?.weight_kg, 80);
assert.equal(benchBest?.reps, 5);

const emptyBest = lookupExerciseBest(bestMap, "Lat Pulldown");
assert.equal(emptyBest, null);

console.log("sessionExerciseInsights.test.ts: ok");
