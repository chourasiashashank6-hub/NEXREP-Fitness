export type PickerOption<T = string | number | null> = {
  value: T;
  label: string;
  description?: string;
};

export const AGE_OPTIONS: PickerOption<number>[] = Array.from({ length: 88 }, (_, i) => {
  const n = i + 13;
  return { value: n, label: `${n} years` };
});

export const SEX_OPTIONS: PickerOption<string>[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Prefer not to say" },
];

export const GOAL_OPTIONS: PickerOption<string>[] = [
  { value: "fat_loss", label: "Fat loss", description: "Lose body fat while preserving muscle" },
  { value: "muscle_gain", label: "Muscle gain", description: "Build muscle in a controlled surplus" },
  { value: "strength", label: "Strength", description: "Maximize performance and lifts" },
];

export const GOAL_PACE_OPTIONS: PickerOption<string>[] = [
  { value: "slow", label: "Slow — 0.25 kg/week" },
  { value: "moderate", label: "Moderate — 0.5 kg/week (recommended)" },
  { value: "aggressive", label: "Aggressive — 0.75 kg/week" },
];

export const FOCUS_MUSCLE_OPTIONS: PickerOption<string | null>[] = [
  { value: "Chest", label: "Chest" },
  { value: "Back", label: "Back" },
  { value: "Shoulders", label: "Shoulders" },
  { value: "Legs", label: "Legs" },
  { value: "Arms", label: "Arms" },
  { value: "Core", label: "Core" },
  { value: null, label: "Balanced" },
];

export const DIFFICULTY_OPTIONS: PickerOption<string>[] = [
  { value: "beginner", label: "Beginner", description: "Starter-friendly exercise recommendations" },
  { value: "intermediate", label: "Intermediate", description: "Moderate challenge and progression" },
  { value: "advanced", label: "Advanced", description: "High-intensity and complex movements" },
];

export const ACTIVITY_OPTIONS: PickerOption<string>[] = [
  { value: "sedentary", label: "Sedentary", description: "Desk job, little to no exercise" },
  { value: "lightly_active", label: "Lightly active", description: "1–2 workouts per week" },
  { value: "moderately_active", label: "Moderately active", description: "3–4 workouts per week" },
  { value: "very_active", label: "Very active", description: "5–6 hard sessions per week" },
  { value: "extremely_active", label: "Extremely active", description: "Athlete or physical job" },
];

export const WORKOUT_TYPE_OPTIONS = ["Strength training", "Cardio", "HIIT", "Yoga", "Sports", "Walking"];
export const ALLERGY_OPTIONS = ["Dairy", "Gluten", "Nuts", "Eggs", "Soy", "Shellfish"];

export const WORKOUTS_PER_WEEK_OPTIONS: PickerOption<number>[] = Array.from({ length: 15 }, (_, i) => ({
  value: i,
  label: i === 0 ? "0 workouts" : i === 1 ? "1 workout" : `${i} workouts`,
}));

export const DIET_TYPE_OPTIONS: PickerOption<string>[] = [
  { value: "standard", label: "No preference" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "keto", label: "Keto" },
  { value: "high_protein", label: "High-protein" },
  { value: "intermittent_fasting", label: "Intermittent fasting" },
  { value: "halal", label: "Halal" },
  { value: "jain", label: "Jain" },
];

export const MEALS_PER_DAY_OPTIONS: PickerOption<number>[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  value: n,
  label: n === 1 ? "1 meal" : n === 3 ? "3 meals (default)" : `${n} meals`,
}));

export const BODY_FAT_OPTIONS: PickerOption<number | null>[] = [
  { value: null, label: "Skip — I don't know" },
  ...Array.from({ length: 68 }, (_, i) => ({ value: i + 3, label: `${i + 3}%` })),
];

export const BF_METHOD_OPTIONS: PickerOption<string>[] = [
  { value: "smart_scale", label: "Smart scale" },
  { value: "calipers", label: "Calipers" },
  { value: "dexa_scan", label: "DEXA scan" },
  { value: "visual_estimate", label: "Visual estimate" },
];

export const WATER_GOAL_OPTIONS: PickerOption<number | null>[] = [
  { value: null, label: "2.5 L (auto-calculated)" },
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
  { value: "IN", label: "India" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "OTHER", label: "Other" },
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
