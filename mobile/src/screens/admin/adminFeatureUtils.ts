export const FEATURE_COLOR_MAP: Record<string, string> = {
  calorie_coach: "#1d9e75",
  meal_day_regen: "#378add",
  workout_coach: "#7f77dd",
  meal_swap: "#ef9f27",
  protein_suggestions: "#d85a30",
  workout_swap: "#d4537e",
  meal_plan_generation: "#3fcf8e",
  workout_plan_generation: "#85b7eb",
  food_photo_analysis: "#1d9e75",
};

export const FEATURE_LABEL_MAP: Record<string, string> = {
  calorie_coach: "admin.features.calorieCoach",
  meal_day_regen: "admin.features.mealDayRegen",
  workout_coach: "admin.features.workoutCoach",
  meal_swap: "admin.features.mealSwap",
  protein_suggestions: "admin.features.proteinSuggestions",
  workout_swap: "admin.features.workoutSwap",
  meal_plan_generation: "admin.features.mealPlanGeneration",
  workout_plan_generation: "admin.features.workoutPlanGeneration",
  food_photo_analysis: "admin.features.foodPhotoAnalysis",
};

export function buildFeatureCostEntries(
  featureData: Array<{ feature: string; cost_inr?: number | string }>
): [string, number][] {
  const featureMap: Record<string, number> = {};
  featureData.forEach((f) => {
    const cost = parseFloat(String(f.cost_inr ?? 0));
    featureMap[f.feature] = (featureMap[f.feature] ?? 0) + cost;
  });
  return Object.entries(featureMap).sort((a, b) => b[1] - a[1]);
}

export function buildFeatureCostFromHistory(
  history: Array<{ feature: string; cost_inr?: number }>
): [string, number][] {
  const featureMap: Record<string, number> = {};
  history.forEach((row) => {
    featureMap[row.feature] = (featureMap[row.feature] ?? 0) + (row.cost_inr ?? 0);
  });
  return Object.entries(featureMap).sort((a, b) => b[1] - a[1]);
}
