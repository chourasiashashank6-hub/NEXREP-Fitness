/**
 * Run: npx --yes tsx src/utils/stalePlanDiff.test.ts
 * (from mobile/)
 */

import { detectAffectedPlanners } from "./stalePlanDiff";
import type { OnboardingData } from "../types/onboarding";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

function makeOnboarding(overrides: Partial<{
  age: number;
  weight_kg: number;
  goal_type: string;
  goal_pace: string;
  target_weight_kg: number;
  difficulty: string;
  workouts_per_week: number;
  workout_types: string[];
  diet_type: string;
  allergies: string[];
  meals_per_day: number;
  activity_level: string;
  body_type: object;
  full_name: string;
}> = {}): OnboardingData {
  return {
    personal: {
      name: overrides.full_name ?? "Test User",
      age: overrides.age ?? 28,
      biological_sex: "male",
      height_cm: 175,
      weight_kg: overrides.weight_kg ?? 75,
      weight_lb: undefined,
      height_in: undefined,
      unit_system: "metric",
    },
    goal: {
      type: (overrides.goal_type ?? "fat_loss") as any,
      pace: overrides.goal_pace ?? "moderate",
      target_weight_kg: overrides.target_weight_kg ?? 70,
      target_weight_lb: undefined,
      difficulty: (overrides.difficulty ?? "intermediate") as any,
      focus_muscles: [],
      focus_muscle: undefined,
    },
    activity: {
      level: (overrides.activity_level ?? "moderately_active") as any,
      workouts_per_week: overrides.workouts_per_week ?? 4,
      workout_types: overrides.workout_types ?? ["strength"],
    },
    dietary: {
      diet_type: overrides.diet_type ?? "standard",
      allergies: overrides.allergies ?? [],
      meals_per_day: overrides.meals_per_day ?? 3,
    },
    body_type: overrides.body_type ?? {} as any,
    app_setup: { region: "IN" },
  } as unknown as OnboardingData;
}

const base = makeOnboarding();

// 1. Changing a meal-only field → only meal affected
{
  const next = makeOnboarding({ diet_type: "vegan" });
  const affected = detectAffectedPlanners(base, next);
  assert(affected.includes("meal"), "diet_type change → meal affected");
  assert(!affected.includes("workout"), "diet_type change → workout NOT affected");
}

// 2. Changing primary_goal → both planners affected
{
  const next = makeOnboarding({ goal_type: "muscle_gain" });
  const affected = detectAffectedPlanners(base, next);
  assert(affected.includes("meal"), "primary_goal → meal affected");
  assert(affected.includes("workout"), "primary_goal → workout affected");
}

// 3. Unmapped fields (full_name) → no planner affected
{
  const next = makeOnboarding({ full_name: "New Name" });
  const affected = detectAffectedPlanners(base, next);
  assert(affected.length === 0, "full_name change → no planners affected");
}

// 4. Regenerate now → after save + regeneration, prev equals next, no planners affected
{
  const next = makeOnboarding({ diet_type: "keto" });
  // After regeneration, prev is updated to next
  const affected = detectAffectedPlanners(next, next);
  assert(affected.length === 0, "same data → no affected planners");
}

// 5. Workout-only field (difficulty) → only workout affected
{
  const next = makeOnboarding({ difficulty: "advanced" });
  const affected = detectAffectedPlanners(base, next);
  assert(!affected.includes("meal"), "difficulty → meal NOT affected");
  assert(affected.includes("workout"), "difficulty → workout affected");
}

// 6. workouts_per_week change → only workout affected
{
  const next = makeOnboarding({ workouts_per_week: 5 });
  const affected = detectAffectedPlanners(base, next);
  assert(!affected.includes("meal"), "workouts_per_week → meal NOT affected");
  assert(affected.includes("workout"), "workouts_per_week → workout affected");
}

// 7. Allergy order difference should NOT trigger modal (sorted comparison)
{
  const base2 = makeOnboarding({ allergies: ["nuts", "gluten"] });
  const next = makeOnboarding({ allergies: ["gluten", "nuts"] });
  const affected = detectAffectedPlanners(base2, next);
  assert(!affected.includes("meal"), "allergy order change → no meal change");
}

console.log("stalePlanDiff.test.ts: all assertions passed");
