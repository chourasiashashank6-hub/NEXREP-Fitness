/**
 * Run: npx --yes tsx src/utils/workoutMuscleInfer.test.ts
 */
import { inferMusclesFromWorkout, musclesFromBodyPart } from "./workoutMuscleInfer";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

assert(musclesFromBodyPart("Arms").join() === "Biceps,Triceps", "generic Arms → biceps + triceps");
assert(musclesFromBodyPart("Triceps").join() === "Triceps", "Triceps body part");
assert(
  inferMusclesFromWorkout({
    exerciseName: "Tricep Pushdown",
    type: "compound",
    notes: "source=workout_planner; body_part=Triceps",
  }).join() === "Triceps",
  "planner tricep log uses notes body_part",
);
assert(
  inferMusclesFromWorkout({
    exerciseName: "Tricep Pushdown",
    type: "compound",
    notes: "body_part=Arms",
  }).join() === "Biceps,Triceps",
  "catalog-only Arms fallback counts both arm muscles",
);
assert(
  inferMusclesFromWorkout({
    exerciseName: "Bent Over Dumbbell Row",
    type: "compound",
    notes: "source=workout_planner; body_part=Back",
  }).join() === "Back",
  "row notes map only to back",
);

console.log("workoutMuscleInfer.test.ts: all assertions passed");
