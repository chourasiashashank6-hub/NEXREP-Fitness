/**
 * Run: npx --yes tsx src/utils/workoutPlannerLog.test.ts
 * (from mobile/)
 */
import {
  buildLoggedExerciseIdMap,
  estimatePlannerTimeTaken,
  exerciseLogKey,
  findPlannerWorkoutLog,
  isPlannerLoggedWorkout,
  mergeLoggedExerciseIdMap,
  hasAnyPlannerLogForDay,
  allPlannerExercisesLogged,
  parsePlannerReps,
} from "./workoutPlannerLog";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const bench = { name: "Barbell Bench Press", sets: 4, reps: "8-12", muscle: "Chest", note: "", rest_seconds: 90 };
const squat = { name: "Back Squat", sets: 3, reps: "10", muscle: "Legs", note: "", rest_seconds: 120 };

assert(exerciseLogKey(bench, 0) === "n:0:barbell bench press", "log key lowercases name");
assert(parsePlannerReps("8-12") === 8, "parse range reps → first number");
assert(parsePlannerReps("45s") === 45, "parse timed reps");
assert(parsePlannerReps(12) === 12, "parse numeric reps");
assert(parsePlannerReps("abc") === 10, "invalid reps → default 10");

const timing = estimatePlannerTimeTaken(bench);
assert(timing.durationMin >= 1, "duration at least 1 min");
assert(/^\d+:\d{2}$/.test(timing.timeTaken), "timeTaken M:SS format");

const today = "2026-07-27";
const history = [
  {
    id: 101,
    exerciseName: "Barbell Bench Press",
    notes: "source=workout_planner; body_part=Chest",
    date: "2026-07-27T10:00:00Z",
  },
  {
    id: 102,
    exerciseName: "Back Squat",
    notes: "body_part=Legs", // manual log — no planner source
    date: "2026-07-27T11:00:00Z",
  },
  {
    id: 103,
    exerciseName: "Barbell Bench Press",
    notes: "source=workout_planner; body_part=Chest",
    date: "2026-07-26T10:00:00Z", // different day
  },
];

assert(isPlannerLoggedWorkout(history[0]) === true, "planner source detected");
assert(isPlannerLoggedWorkout(history[1]) === false, "manual log not planner-sourced");

const match = findPlannerWorkoutLog(history, bench, today);
assert(match?.id === 101, "matches planner log for today by name");

assert(findPlannerWorkoutLog(history, squat, today) === undefined, "manual same-day log does not fill checkbox");

const allLogged = buildLoggedExerciseIdMap(history, [bench, squat], today);
assert(hasAnyPlannerLogForDay(history, [bench, squat], today) === true, "any planner log detected");
assert(allPlannerExercisesLogged(history, [bench], today) === true, "single exercise fully logged");
assert(allPlannerExercisesLogged(history, [bench, squat], today) === false, "partial day not all logged");

const map = buildLoggedExerciseIdMap(history, [bench, squat], today);
assert(map["n:0:barbell bench press"] === 101, "bench maps to planner workout id");
assert(map["n:1:back squat"] === undefined, "squat not mapped (manual only)");

// After delete from Session History, map is empty for that exercise
const afterDelete = buildLoggedExerciseIdMap(
  history.filter((h) => h.id !== 101),
  [bench, squat],
  today,
);
assert(afterDelete["n:0:barbell bench press"] === undefined, "delete clears checkbox mapping");

const fetched = { "n:1:back squat": 202 };
const optimistic = { "n:0:barbell bench press": { id: 101, at: Date.now() } };
const merged = mergeLoggedExerciseIdMap(fetched, optimistic);
assert(merged["n:0:barbell bench press"] === 101, "optimistic grace preserves recent checkbox");
assert(merged["n:1:back squat"] === 202, "merge keeps fetched ids");

// UTC-naive server timestamp after local midnight (IST): Home counts as Aug 13, planner must too.
const istLateNight = {
  id: 201,
  exerciseName: "Plank",
  notes: "source=workout_planner; body_part=Core",
  date: "2026-08-12T21:18:00", // UTC ≈ Aug 13 02:48 IST
};
const aug13 = "2026-08-13";
assert(
  findPlannerWorkoutLog([istLateNight], { name: "Plank" }, aug13)?.id === 201,
  "naive UTC timestamp maps to local plan day",
);

console.log("workoutPlannerLog.test.ts: all assertions passed");
