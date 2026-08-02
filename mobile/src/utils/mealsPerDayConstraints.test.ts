import { DEFAULT_ONBOARDING_DATA } from "../constants/onboarding";
import {
  buildMealsPerDayOptions,
  canEstimateOnboardingCalories,
  getEstimatedDailyCalories,
  isMealsPerDayDisabled,
} from "./mealsPerDayConstraints";
import { MEALS_PER_DAY_OPTIONS } from "./onboardingOptions";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function selectableAt(kcal: number): number[] {
  return [1, 2, 3, 4, 5, 6].filter((n) => !isMealsPerDayDisabled(kcal, n));
}

// Regression checklist examples (fixed kcal targets)
assert(selectableAt(1600).join(",") === "2,3,4", "fat loss ~1600: 2–4 selectable");
assert(selectableAt(2200).join(",") === "3,4,5,6", "maintain ~2200: 1–2 disabled (>1000 kcal/meal)");
assert(selectableAt(3200).join(",") === "4,5,6", "muscle gain ~3200: 1–3 disabled (>1000 kcal/meal)");

// fail open when estimate unavailable
const incomplete = {
  ...DEFAULT_ONBOARDING_DATA,
  activity: { level: null, workouts_per_week: null, tdee_multiplier: null, workout_types: [] },
};
assert(!canEstimateOnboardingCalories(incomplete), "incomplete profile should not estimate");
assert(getEstimatedDailyCalories(incomplete) === null, "fail open returns null");

// integration: full Screens 1–3 data yields a positive estimate
const complete = {
  ...DEFAULT_ONBOARDING_DATA,
  personal: {
    ...DEFAULT_ONBOARDING_DATA.personal,
    name: "Test",
    age: 30,
    sex: "male" as const,
    height_cm: 175,
    weight_kg: 80,
  },
  goal: {
    ...DEFAULT_ONBOARDING_DATA.goal,
    type: "fat_loss" as const,
    pace: "moderate" as const,
    difficulty: "intermediate" as const,
    target_weight_kg: 72,
  },
  activity: {
    level: "lightly_active" as const,
    workouts_per_week: 2,
    tdee_multiplier: 1.46,
    workout_types: [],
  },
};
assert(canEstimateOnboardingCalories(complete), "complete onboarding can estimate");
const liveKcal = getEstimatedDailyCalories(complete)!;
assert(liveKcal > 0, "live estimate is positive");

const options = buildMealsPerDayOptions(1600, MEALS_PER_DAY_OPTIONS, (key, opts) =>
  key.includes("TooLittle") ? `~${opts?.kcal} kcal each — too little per meal` : `~${opts?.kcal} kcal each — too much`,
);
assert(options.find((o) => o.value === 6)?.disabled === true, "disabled row has caption");
assert(Boolean(options.find((o) => o.value === 6)?.caption), "caption shown");

console.log("mealsPerDayConstraints OK", { liveKcal });
