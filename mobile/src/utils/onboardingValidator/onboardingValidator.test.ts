import { DEFAULT_ONBOARDING_DATA } from "../../constants/onboarding";
import { getPaceOptionStates, isPaceAllowed, maxFatLossPaceKg } from "./pace";
import { reconcileOnboarding } from "./reconcile";
import {
  validateName,
  validateTargetWeight,
  validateWorkoutsPerWeek,
} from "./rules";
import { validateOnboardingPartialSave } from "./validate";
import { getCurrentWeightKg, getTargetWeightKg, weightsEqualKg, WEIGHT_TOLERANCE_KG } from "./units";
import { workoutsMinForGoal } from "./workouts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function baseData() {
  return {
    ...DEFAULT_ONBOARDING_DATA,
    personal: {
      ...DEFAULT_ONBOARDING_DATA.personal,
      name: "राज शर्मा",
      age: 28,
      sex: "male" as const,
      height_cm: 175,
      weight_kg: 62,
      unit_system: "metric" as const,
    },
    goal: {
      ...DEFAULT_ONBOARDING_DATA.goal,
      type: "fat_loss" as const,
      pace: "moderate" as const,
      difficulty: "intermediate" as const,
      target_weight_kg: 58,
    },
    activity: {
      ...DEFAULT_ONBOARDING_DATA.activity,
      workouts_per_week: 3,
      level: "moderately_active" as const,
      tdee_multiplier: 1.55,
    },
    dietary: {
      ...DEFAULT_ONBOARDING_DATA.dietary,
      diet_type: "standard",
    },
  };
}

// Hindi name passes
assert(validateName("राज शर्मा").valid, "Hindi name should pass");
assert(validateName("12345").valid === false, "digits-only name should fail");

// Fat loss target above current blocked
{
  const data = baseData();
  data.goal.target_weight_kg = 70;
  const result = validateTargetWeight(data);
  assert(!result.valid && result.code === "target.fatLossAboveCurrent", "fat loss target 70 at current 62 blocked");
}

// Muscle gain label direction — target below current blocked
{
  const data = baseData();
  data.goal.type = "muscle_gain";
  data.goal.target_weight_kg = 60;
  const result = validateTargetWeight(data);
  assert(!result.valid && result.code === "target.muscleGainBelowCurrent", "muscle gain target below current blocked");
}

// BMI floor at 160cm ~47kg
{
  const data = baseData();
  data.personal.height_cm = 160;
  data.personal.weight_kg = 55;
  data.goal.target_weight_kg = 45;
  const result = validateTargetWeight(data);
  assert(!result.valid && result.code === "target.bmiFloor", "target below BMI 18.5 hard blocked");
}

// Aggressive pace disabled at 62kg (1% cap = 0.62)
assert(maxFatLossPaceKg(62) === 0.62, "1% cap at 62kg is 0.62");
{
  const data = baseData();
  data.goal.pace = "aggressive";
  assert(!isPaceAllowed(data, "aggressive"), "aggressive 0.75 blocked at 62kg");
}

// Workouts min by goal
assert(workoutsMinForGoal("fat_loss") === 2, "fat loss min workouts 2");
assert(workoutsMinForGoal("muscle_gain") === 3, "muscle gain min workouts 3");
assert(workoutsMinForGoal("maintain") === 2, "maintain min workouts 2");

// Goal change raises workouts
{
  const data = baseData();
  data.activity.workouts_per_week = 2;
  data.goal.type = "muscle_gain";
  const { data: next, notices } = reconcileOnboarding(data, "goal");
  assert(next.activity.workouts_per_week === 3, "muscle gain raises 2 to 3");
  assert(notices.some((n) => n.code === "workouts.raisedToMin"), "notice raised workouts");
}

// Metric round trip tolerance
assert(weightsEqualKg(62, 62 + WEIGHT_TOLERANCE_KG / 2), "weight tolerance avoids spurious block");

// Maintain gap
{
  const data = baseData();
  data.goal.type = "maintain";
  data.goal.pace = null;
  data.goal.target_weight_kg = 65;
  const result = validateTargetWeight(data);
  assert(!result.valid && result.code === "target.maintainGap", "maintain gap >2 blocked");
}

{
  const data = baseData();
  data.goal.type = "maintain";
  data.goal.target_weight_kg = 63;
  assert(validateTargetWeight(data).valid, "maintain gap within 2 ok");
}

// Partial save: screen 3 does not require screen-4-only fields
{
  const data = baseData();
  data.dietary.diet_type = "";
  const screen3Issues = validateOnboardingPartialSave(data, 3);
  assert(screen3Issues.length === 0, "partial save at step 3 skips diet_type");
  const screen4Issues = validateOnboardingPartialSave(data, 4);
  assert(screen4Issues.some((i) => i.field === "diet_type"), "step 4 save requires diet_type");
}

console.log("onboardingValidator.test.ts: all assertions passed");
