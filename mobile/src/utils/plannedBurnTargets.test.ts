/**
 * Run: npx --yes tsx src/utils/plannedBurnTargets.test.ts
 * (from mobile/)
 */
import {
  computePlannedBurnActivities,
  computePlannedBurnTargets,
} from "./plannedBurnTargets";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Fallback when no planned activities
{
  const result = computePlannedBurnTargets({ minBurnTarget: 138, activities: [] });
  assert(result.bestResultsBurnTarget === 138, "fallback best should equal min");
  assert(result.minBurnTarget === 138, "min preserved");
}

// Sum of planned activities
{
  const activities = [
    { id: "cardio-warmup", kind: "cardioWarmup" as const, sessionLabel: "", kcal: 180 },
    { id: "workout-session", kind: "workoutSession" as const, sessionLabel: "Push", kcal: 287 },
  ];
  const result = computePlannedBurnTargets({ minBurnTarget: 138, activities });
  assert(result.bestResultsBurnTarget === 467, `expected 467, got ${result.bestResultsBurnTarget}`);
  assert(result.minBurnTarget === 138, "min unchanged");
}

// Single activity only
{
  const activities = [
    { id: "workout-session", kind: "workoutSession" as const, sessionLabel: "Legs", kcal: 287 },
  ];
  const result = computePlannedBurnTargets({ minBurnTarget: 110, activities });
  assert(result.bestResultsBurnTarget === 287, "single activity becomes best target");
}

// Fat loss + planner produces cardio + workout when plan exists
{
  const activities = computePlannedBurnActivities({
    restDayActive: false,
    hasWorkoutPlannerAccess: true,
    weightKg: 75,
    preworkoutProfile: {
      primaryGoal: "fat_loss",
      goalPace: "moderate",
      difficulty: "intermediate",
      weightKg: 75,
    },
    todayWorkoutPlan: {
      plan_id: 1,
      month: 8,
      year: 2026,
      today: {
        day: 1,
        split_name: "Push Day",
        is_rest_day: false,
        focus_muscles: ["Chest"],
        exercises: [{ name: "Bench Press", sets: 4, reps: 10, muscle: "Chest" }],
        estimated_duration_min: 45,
        locked: false,
      },
      month_overview: [],
    },
  });
  assert(activities.length === 2, `expected cardio + workout, got ${activities.length}`);
  assert(activities[0].kind === "cardioWarmup" && activities[0].kcal > 0, "cardio kcal");
  assert(activities[1].kind === "workoutSession" && activities[1].kcal > 0, "workout kcal");
}

// Muscle gain: strength preworkout has no kcal — only workout session
{
  const activities = computePlannedBurnActivities({
    restDayActive: false,
    hasWorkoutPlannerAccess: true,
    weightKg: 75,
    preworkoutProfile: {
      primaryGoal: "muscle_gain",
      goalPace: "moderate",
      difficulty: "intermediate",
      weightKg: 75,
    },
    todayWorkoutPlan: {
      plan_id: 1,
      month: 8,
      year: 2026,
      today: {
        day: 1,
        split_name: "Pull",
        is_rest_day: false,
        focus_muscles: ["Back"],
        exercises: [{ name: "Barbell Row", sets: 3, reps: 10, muscle: "Back" }],
        estimated_duration_min: 40,
        locked: false,
      },
      month_overview: [],
    },
  });
  assert(activities.length === 1, "muscle gain should only count workout session");
  assert(activities[0].kind === "workoutSession", "workout only");
}

// Rest day → no activities
{
  const activities = computePlannedBurnActivities({
    restDayActive: true,
    hasWorkoutPlannerAccess: true,
    weightKg: 75,
    preworkoutProfile: {
      primaryGoal: "fat_loss",
      goalPace: "moderate",
      difficulty: "intermediate",
      weightKg: 75,
    },
    todayWorkoutPlan: {
      plan_id: 1,
      month: 8,
      year: 2026,
      today: {
        day: 1,
        split_name: "Rest",
        is_rest_day: true,
        focus_muscles: [],
        exercises: [],
        estimated_duration_min: 0,
        locked: false,
      },
      month_overview: [],
    },
  });
  assert(activities.length === 0, "rest day has no planned burn activities");
}

{
  const activities = computePlannedBurnActivities({
    restDayActive: false,
    hasWorkoutPlannerAccess: true,
    preWorkoutEnabled: false,
    preworkoutProfile: {
      primaryGoal: "fat_loss",
      goalPace: "moderate",
      difficulty: "intermediate",
      weightKg: 75,
    },
    todayWorkoutPlan: {
      plan_id: 1,
      month: 8,
      year: 2026,
      today: {
        day: 1,
        split_name: "Push",
        is_rest_day: false,
        focus_muscles: ["Chest"],
        exercises: [{ name: "Bench Press", sets: 4, reps: "8", muscle: "Chest", rest_sec: 90, cues: "" }],
        estimated_duration_min: 48,
        locked: false,
      },
      month_overview: [],
    },
    weightKg: 75,
  });
  assert(!activities.some((a) => a.kind === "cardioWarmup"), "toggle off excludes warm-up kcal");
  assert(activities.some((a) => a.kind === "workoutSession"), "workout session kcal remains");
}

console.log("plannedBurnTargets.test.ts: all assertions passed");
