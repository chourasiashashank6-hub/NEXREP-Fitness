/**
 * Run: npx --yes tsx src/utils/workoutLogSource.test.ts
 */
import { resolveWorkoutLogSource, findGuidedWarmupLogForDay } from "./workoutLogSource";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

assert(
  resolveWorkoutLogSource({ exerciseName: "Barbell Bench Press", notes: "body_part=Chest; goal_tag=strength" }) ===
    "manual",
  "manual log form",
);
assert(
  resolveWorkoutLogSource({
    exerciseName: "Incline Dumbbell Press",
    notes: "source=workout_planner; body_part=Chest",
  }) === "workout_planner",
  "planner checkbox",
);
assert(
  resolveWorkoutLogSource({
    exerciseName: "Guided Warm-up",
    notes: "active_session:warmup-123",
  }) === "guided_warmup",
  "guided warm-up session",
);
assert(
  resolveWorkoutLogSource({
    exerciseName: "Barbell Squat",
    notes: "active_session:abc-123",
  }) === "active_session",
  "active workout session",
);

assert(
  findGuidedWarmupLogForDay(
    [{ id: 9, exerciseName: "Guided Warm-up", notes: "active_session:w1", date: "2026-08-13T10:00:00Z" }],
    "2026-08-13",
  )?.id === 9,
  "guided warm-up by day key",
);

console.log("workoutLogSource.test.ts: all assertions passed");
