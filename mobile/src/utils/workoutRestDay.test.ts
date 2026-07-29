/**
 * Run: npx --yes tsx src/utils/workoutRestDay.test.ts
 * (from mobile/)
 */
import type { WorkoutPlanCurrent } from "../types/planner";
import { isHomeRestDayActive, isWorkoutRestDay } from "./workoutRestDay";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function planStub(partial: Partial<WorkoutPlanCurrent> & { today?: WorkoutPlanCurrent["today"] }): WorkoutPlanCurrent {
  return {
    plan_id: 1,
    month: 7,
    year: 2026,
    focus_muscles: [],
    generated_at: "2026-07-01T00:00:00Z",
    today: null,
    month_overview: [],
    ...partial,
  };
}

// isWorkoutRestDay — mirrors Planner R / REST DAY banner
{
  assert(isWorkoutRestDay(null) === true, "null day → rest");
  assert(isWorkoutRestDay({ is_rest_day: true, split_name: "Push" }) === true, "flag → rest");
  assert(isWorkoutRestDay({ is_rest_day: false, split_name: "Rest Day" }) === true, "split rest → rest");
  assert(isWorkoutRestDay({ is_rest_day: false, split_name: "Off" }) === true, "off → rest");
  assert(isWorkoutRestDay({ is_rest_day: false, split_name: "Push A" }) === false, "training day");
}

const restToday = { day: 27, is_rest_day: true, split_name: "Rest", focus_muscles: [], exercises: [], estimated_duration_min: 0 };
const trainToday = {
  day: 28,
  is_rest_day: false,
  split_name: "Legs",
  focus_muscles: ["Legs"],
  exercises: [{ name: "Squat", sets: 3, reps: "8", muscle: "Legs", note: "", rest_seconds: 90 }],
  estimated_duration_min: 45,
};

// 1) All three true → restDayActive
assert(
  isHomeRestDayActive({
    hasWorkoutPlannerAccess: true,
    plan: planStub({ today: restToday }),
  }) === true,
  "elite + plan + rest → active",
);

// 2a) Not elite
assert(
  isHomeRestDayActive({
    hasWorkoutPlannerAccess: false,
    plan: planStub({ today: restToday }),
  }) === false,
  "non-elite → inactive",
);

// 2b) Elite but no plan
assert(
  isHomeRestDayActive({
    hasWorkoutPlannerAccess: true,
    plan: null,
  }) === false,
  "no plan → inactive",
);

// 2c) Elite + plan but training day
assert(
  isHomeRestDayActive({
    hasWorkoutPlannerAccess: true,
    plan: planStub({ today: trainToday }),
  }) === false,
  "training day → inactive",
);

console.log("workoutRestDay.test.ts: all assertions passed");
