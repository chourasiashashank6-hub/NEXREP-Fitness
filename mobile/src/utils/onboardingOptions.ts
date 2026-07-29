import i18n from "../i18n";

export type PickerOption<T = string | number | null> = {
  value: T;
  label: string;
  description?: string;
};

export const AGE_OPTIONS: PickerOption<number>[] = Array.from({ length: 88 }, (_, i) => {
  const n = i + 13;
  return { value: n, label: i18n.t("onboarding.options.years", { count: n }) };
});

export const SEX_OPTIONS: PickerOption<string>[] = [
  { value: "male", label: i18n.t("onboarding.options.sex.male") },
  { value: "female", label: i18n.t("onboarding.options.sex.female") },
  { value: "other", label: i18n.t("onboarding.options.sex.other") },
];

export const GOAL_OPTIONS: PickerOption<string>[] = [
  { value: "fat_loss", label: i18n.t("onboarding.options.goals.fatLoss"), description: i18n.t("onboarding.options.goals.fatLossDescription") },
  { value: "muscle_gain", label: i18n.t("onboarding.options.goals.muscleGain"), description: i18n.t("onboarding.options.goals.muscleGainDescription") },
  { value: "strength", label: i18n.t("onboarding.options.goals.strength"), description: i18n.t("onboarding.options.goals.strengthDescription") },
];

export const GOAL_PACE_OPTIONS: PickerOption<string>[] = [
  { value: "slow", label: i18n.t("onboarding.options.pace.slow") },
  { value: "moderate", label: i18n.t("onboarding.options.pace.moderate") },
  { value: "aggressive", label: i18n.t("onboarding.options.pace.aggressive") },
];

/** @deprecated use FOCUS_MUSCLE_UI_OPTIONS from onboardingFocusMuscles.ts */
export const FOCUS_MUSCLE_OPTIONS: PickerOption<string | null>[] = [
  { value: "Chest", label: i18n.t("coach.workoutPlannerScreen.muscles.chest") },
  { value: "Back", label: i18n.t("coach.workoutPlannerScreen.muscles.back") },
  { value: "Shoulders", label: i18n.t("coach.workoutPlannerScreen.muscles.shoulders") },
  { value: "Legs", label: i18n.t("coach.workoutPlannerScreen.muscles.legs") },
  { value: "Arms", label: i18n.t("coach.workoutPlannerScreen.muscles.arms") },
  { value: "Core", label: i18n.t("coach.workoutPlannerScreen.muscles.core") },
  { value: null, label: i18n.t("coach.workoutPlannerScreen.muscles.balanced") },
];

export const DIFFICULTY_OPTIONS: PickerOption<string>[] = [
  { value: "beginner", label: i18n.t("onboarding.options.difficulty.beginner"), description: i18n.t("onboarding.options.difficulty.beginnerDescription") },
  { value: "intermediate", label: i18n.t("onboarding.options.difficulty.intermediate"), description: i18n.t("onboarding.options.difficulty.intermediateDescription") },
  { value: "advanced", label: i18n.t("onboarding.options.difficulty.advanced"), description: i18n.t("onboarding.options.difficulty.advancedDescription") },
];

export const ACTIVITY_OPTIONS: PickerOption<string>[] = [
  { value: "sedentary", label: i18n.t("onboarding.options.activity.sedentary"), description: i18n.t("onboarding.options.activity.sedentaryDescription") },
  { value: "lightly_active", label: i18n.t("onboarding.options.activity.lightlyActive"), description: i18n.t("onboarding.options.activity.lightlyActiveDescription") },
  { value: "moderately_active", label: i18n.t("onboarding.options.activity.moderatelyActive"), description: i18n.t("onboarding.options.activity.moderatelyActiveDescription") },
  { value: "very_active", label: i18n.t("onboarding.options.activity.veryActive"), description: i18n.t("onboarding.options.activity.veryActiveDescription") },
  { value: "extremely_active", label: i18n.t("onboarding.options.activity.extremelyActive"), description: i18n.t("onboarding.options.activity.extremelyActiveDescription") },
];

export const WORKOUT_TYPE_OPTIONS: PickerOption<string>[] = [
  { value: "strength_training", label: i18n.t("onboarding.options.workoutTypes.strength") },
  { value: "cardio", label: i18n.t("onboarding.options.workoutTypes.cardio") },
  { value: "hiit", label: i18n.t("onboarding.options.workoutTypes.hiit") },
  { value: "yoga", label: i18n.t("onboarding.options.workoutTypes.yoga") },
  { value: "sports", label: i18n.t("onboarding.options.workoutTypes.sports") },
  { value: "walking", label: i18n.t("onboarding.options.workoutTypes.walking") },
];
export const ALLERGY_OPTIONS: PickerOption<string>[] = [
  { value: "dairy", label: i18n.t("onboarding.options.allergies.dairy") },
  { value: "gluten", label: i18n.t("onboarding.options.allergies.gluten") },
  { value: "nuts", label: i18n.t("onboarding.options.allergies.nuts") },
  { value: "eggs", label: i18n.t("onboarding.options.allergies.eggs") },
  { value: "soy", label: i18n.t("onboarding.options.allergies.soy") },
  { value: "shellfish", label: i18n.t("onboarding.options.allergies.shellfish") },
];

export const WORKOUTS_PER_WEEK_OPTIONS: PickerOption<number>[] = Array.from({ length: 15 }, (_, i) => ({
  value: i,
  label: i === 0 ? i18n.t("onboarding.options.workouts.zero") : i === 1 ? i18n.t("onboarding.options.workouts.one") : i18n.t("onboarding.options.workouts.many", { count: i }),
}));

export const DIET_TYPE_OPTIONS: PickerOption<string>[] = [
  { value: "standard", label: i18n.t("onboarding.options.diet.standard") },
  { value: "vegetarian", label: i18n.t("onboarding.options.diet.vegetarian") },
  { value: "vegan", label: i18n.t("onboarding.options.diet.vegan") },
  { value: "keto", label: i18n.t("onboarding.options.diet.keto") },
  { value: "high_protein", label: i18n.t("onboarding.options.diet.highProtein") },
  { value: "intermittent_fasting", label: i18n.t("onboarding.options.diet.intermittentFasting") },
  { value: "halal", label: i18n.t("onboarding.options.diet.halal") },
  { value: "jain", label: i18n.t("onboarding.options.diet.jain") },
];

export const MEALS_PER_DAY_OPTIONS: PickerOption<number>[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  value: n,
  label: n === 1 ? i18n.t("onboarding.options.meals.one") : n === 3 ? i18n.t("onboarding.options.meals.default") : i18n.t("onboarding.options.meals.many", { count: n }),
}));

export const BODY_FAT_OPTIONS: PickerOption<number | null>[] = [
  { value: null, label: i18n.t("onboarding.options.bodyFatSkip") },
  ...Array.from({ length: 68 }, (_, i) => ({ value: i + 3, label: `${i + 3}%` })),
];

export const BF_METHOD_OPTIONS: PickerOption<string>[] = [
  { value: "smart_scale", label: i18n.t("onboarding.options.bodyFatMethods.smartScale") },
  { value: "calipers", label: i18n.t("onboarding.options.bodyFatMethods.calipers") },
  { value: "dexa_scan", label: i18n.t("onboarding.options.bodyFatMethods.dexa") },
  { value: "visual_estimate", label: i18n.t("onboarding.options.bodyFatMethods.visual") },
];

export const WATER_GOAL_OPTIONS: PickerOption<number | null>[] = [
  { value: null, label: i18n.t("onboarding.options.waterAuto") },
  { value: 1.0, label: "1.0 L" },
  { value: 1.5, label: "1.5 L" },
  { value: 2.0, label: "2.0 L" },
  { value: 2.5, label: "2.5 L" },
  { value: 3.0, label: "3.0 L" },
  { value: 3.5, label: "3.5 L" },
  { value: 4.0, label: "4.0 L" },
  { value: 4.5, label: "4.5 L" },
  { value: 5.0, label: "5.0 L" },
];

export const REGION_OPTIONS: PickerOption<string>[] = [
  { value: "IN", label: i18n.t("onboarding.options.regions.india") },
  { value: "US", label: i18n.t("onboarding.options.regions.us") },
  { value: "GB", label: i18n.t("onboarding.options.regions.gb") },
  { value: "CA", label: i18n.t("onboarding.options.regions.canada") },
  { value: "AU", label: i18n.t("onboarding.options.regions.australia") },
  { value: "OTHER", label: i18n.t("onboarding.options.regions.other") },
];

export const REMINDER_TIME_OPTIONS: PickerOption<string>[] = [];
for (let h = 5; h <= 23; h++) {
  for (const m of [0, 30]) {
    if (h === 23 && m > 30) continue;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    const mm = String(m).padStart(2, "0");
    REMINDER_TIME_OPTIONS.push({ value: `${h12}:${mm} ${ampm}`, label: `${h12}:${mm} ${ampm}` });
  }
}

export const getMetricHeightOptions = (): PickerOption<number>[] =>
  Array.from({ length: 151 }, (_, i) => ({ value: i + 100, label: `${i + 100} cm` }));

export const getImperialHeightOptions = (): PickerOption<number>[] => {
  const out: PickerOption<number>[] = [];
  for (let inches = 39; inches <= 98; inches++) {
    const ft = Math.floor(inches / 12);
    const inch = inches % 12;
    out.push({ value: inches, label: `${ft}'${inch}"` });
  }
  return out;
};

export const getMetricWeightOptions = (): PickerOption<number>[] => {
  const out: PickerOption<number>[] = [];
  for (let v = 30; v <= 300; v += 0.5) {
    out.push({ value: Number(v.toFixed(1)), label: `${Number(v.toFixed(1))} kg` });
  }
  return out;
};

export const getImperialWeightOptions = (): PickerOption<number>[] =>
  Array.from({ length: 595 }, (_, i) => ({ value: i + 66, label: `${i + 66} lbs` }));
