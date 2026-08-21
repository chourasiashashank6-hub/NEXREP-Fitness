/**
 * Run: npx --yes tsx src/utils/sessionMilestoneSlots.test.ts
 */
import {
  appendExtraManualSessionSlots,
  buildManualSessionMilestones,
  buildTodaySessionMilestoneItems,
  fillSessionSlots,
} from "./sessionMilestoneSlots";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Rest / empty plan → zero boxes
assert(fillSessionSlots([], []).length === 0, "empty plan");
assert(fillSessionSlots(null, ["Pull-Up"]).length === 0, "null plan");

// Box count = plan exercise count (not hardcoded 6)
{
  const three = fillSessionSlots([{ name: "A" }, { name: "B" }, { name: "C" }], ["B"]);
  assert(three.length === 3, "3-exercise day");
  assert(three.map((s) => s.label).join("|") === "A|B|C", "labels from plan");
  assert(!three[0].filled && three[1].filled && !three[2].filled, "only B filled");
}

{
  const six = fillSessionSlots(
    ["Pull-Up", "Leg Press Calf Raise", "Row", "Press", "Curl", "Plank"].map((name) => ({ name })),
    ["pull-up", "Curl"],
  );
  assert(six.length === 6, "6-exercise day");
  assert(six[0].filled, "case-insensitive match");
  assert(six[4].filled, "Curl filled");
  assert(six.filter((s) => s.filled).length === 2, "two filled");
}

{
  const manual = buildManualSessionMilestones([
    { id: 1, exerciseName: "Bench Press" },
    { id: 2, exerciseName: "Squat" },
  ]);
  assert(manual.length === 2, "manual session boxes");
  assert(manual.every((s) => s.filled), "all manual sessions filled");
}

{
  const five = buildTodaySessionMilestoneItems({
    hasWorkoutPlannerAccess: true,
    todayWorkoutPlan: {
      plan_id: 1,
      month: 8,
      year: 2026,
      focus_muscles: [],
      generated_at: "",
      today: {
        day: 21,
        is_rest_day: false,
        split_name: "Lower A",
        focus_muscles: [],
        exercises: [
          { name: "Squats", sets: 3, reps: "10", muscle: "Legs", note: "", rest_seconds: 60 },
          { name: "Lunges", sets: 3, reps: "10", muscle: "Legs", note: "", rest_seconds: 60 },
          { name: "Leg Press", sets: 3, reps: "10", muscle: "Legs", note: "", rest_seconds: 60 },
          { name: "Cable Woodchops", sets: 3, reps: "10", muscle: "Core", note: "", rest_seconds: 60 },
          { name: "Hip Thrusts", sets: 3, reps: "10", muscle: "Glutes", note: "", rest_seconds: 60 },
        ],
        estimated_duration_min: 50,
      },
      month_overview: [],
    },
    workoutHistory: [
      { id: 1, date: "2026-08-21T10:00:00", exerciseName: "Squats", notes: "source=workout_planner" },
      { id: 2, date: "2026-08-21T10:05:00", exerciseName: "Lunges", notes: "source=workout_planner" },
      { id: 3, date: "2026-08-21T10:10:00", exerciseName: "Leg Press", notes: "source=workout_planner" },
      { id: 4, date: "2026-08-21T10:15:00", exerciseName: "Cable Woodchops", notes: "source=workout_planner" },
      { id: 5, date: "2026-08-21T10:20:00", exerciseName: "Hip Thrusts", notes: "source=workout_planner" },
    ],
    todayKey: "2026-08-21",
  });
  assert(five.length === 5, "5-exercise plan yields 5 milestone boxes (not hardcoded 6)");
  assert(five.every((slot) => slot.filled), "all planned exercises filled");
}

{
  const reflowCorrupted = buildTodaySessionMilestoneItems({
    hasWorkoutPlannerAccess: true,
    todayWorkoutPlan: {
      plan_id: 1,
      month: 8,
      year: 2026,
      focus_muscles: [],
      generated_at: "",
      today: {
        day: 21,
        is_rest_day: false,
        split_name: "Lower A",
        focus_muscles: [],
        exercises: [
          { name: "Squats", sets: 3, reps: "10", muscle: "Legs", note: "", rest_seconds: 60 },
          { name: "Lunges", sets: 3, reps: "10", muscle: "Legs", note: "", rest_seconds: 60 },
          { name: "Leg Press", sets: 3, reps: "10", muscle: "Legs", note: "", rest_seconds: 60 },
          { name: "Cable Woodchops", sets: 3, reps: "10", muscle: "Core", note: "", rest_seconds: 60 },
          { name: "Hip Thrusts", sets: 3, reps: "10", muscle: "Glutes", note: "", rest_seconds: 60 },
          ...Array.from({ length: 10 }, (_, i) => ({
            name: `Reflow ${i + 1}`,
            sets: 3,
            reps: "10",
            muscle: "Legs",
            note: "",
            rest_seconds: 60,
            reflow_source_day: 18,
          })),
        ],
        estimated_duration_min: 50,
      },
      month_overview: [],
    },
    workoutHistory: [],
    todayKey: "2026-08-21",
  });
  assert(reflowCorrupted.length === 5, "reflow-inflated plan still yields 5 milestone boxes");
}

{
  const plan = [
    { name: "Squats" },
    { name: "Lunges" },
    { name: "Leg Press" },
    { name: "Cable Woodchops" },
    { name: "Hip Thrusts" },
  ];
  const logs = [
    { id: 1, date: "2026-08-21T10:00:00", exerciseName: "Squats", notes: "source=workout_planner" },
    { id: 2, date: "2026-08-21T10:05:00", exerciseName: "Lunges", notes: "source=workout_planner" },
    { id: 3, date: "2026-08-21T10:10:00", exerciseName: "Leg Press", notes: "source=workout_planner" },
    { id: 4, date: "2026-08-21T10:15:00", exerciseName: "Cable Woodchops", notes: "source=workout_planner" },
    { id: 5, date: "2026-08-21T10:20:00", exerciseName: "Hip Thrusts", notes: "source=workout_planner" },
    { id: 6, date: "2026-08-21T10:25:00", exerciseName: "Concentration Curl", notes: "manual" },
  ];
  const withExtra = appendExtraManualSessionSlots(fillSessionSlots(plan, logs.map((l) => l.exerciseName)), plan, logs);
  assert(withExtra.length === 6, "adds extra box for unplanned manual log");
  assert(withExtra[5].label === "Concentration Curl", "extra box uses exercise name");
  assert(withExtra[5].isExtra === true, "extra box flagged");
}

{
  const plan = [{ name: "Bench Press" }];
  const logs = [{ id: 1, date: "2026-08-21T10:00:00", exerciseName: "Bench Press", notes: "manual" }];
  const replaced = appendExtraManualSessionSlots(fillSessionSlots(plan, ["Bench Press"]), plan, logs);
  assert(replaced.length === 1, "manual log matching planned exercise is not extra");
  assert(!replaced[0].isExtra, "planned slot stays normal");
}

console.log("sessionMilestoneSlots.test.ts: all assertions passed");
