export type BudgetLevel = "budget" | "moderate" | "flexible";

export type FocusMuscle = "Chest" | "Back" | "Shoulders" | "Legs" | "Arms" | "Core";

export type MealFoodItem = {
  food: string;
  food_id?: number;
  units?: number;
  unit_label?: string;
  region?: string;
  quantity_g: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type MealPlanMeal = {
  meal_type: string;
  time: string;
  items: MealFoodItem[];
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  prep_time_min: number;
  estimated_cost_inr: number;
};

export type MealPlanTargets = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
};

export type MealDayPlan = {
  day: number;
  is_cheat_day: boolean;
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  total_fiber_g: number;
  target_kcal?: number;
  target_protein_g?: number;
  target_carbs_g?: number;
  target_fat_g?: number;
  target_fiber_g?: number;
  meals: MealPlanMeal[];
  locked?: boolean;
  message?: string;
  swaps_used_today?: number;
  swaps_limit?: number;
  day_regens_used?: number;
  day_regens_limit?: number;
  day_regens_remaining?: number;
  month_plan_regens_used?: number;
  month_plan_regens_limit?: number;
  month_plan_regens_remaining?: number;
  planner_limits_exempt?: boolean;
  planner_days_unlocked?: boolean;
};

export type MealMonthOverviewDay = {
  day: number;
  total_calories: number | null;
  is_cheat_day: boolean;
  is_past: boolean;
  is_today: boolean;
  is_future: boolean;
};

export type ProteinSuggestionIcon = "shake" | "bar" | "egg" | "meal" | "dairy" | "legume" | "meat";

export type ProteinSuggestion = {
  icon: ProteinSuggestionIcon;
  title: string;
  description: string;
  protein_g: number;
  time_suggestion: string;
  estimated_cost_inr: number;
};

export type ProteinSuggestionsResponse = {
  protein_gap_g: number;
  target_protein_g: number;
  consumed_protein_g: number;
  gap_pct: number;
  show_suggestions: boolean;
  suggestions: ProteinSuggestion[];
};

export type SupplementIcon = "power" | "shake" | "sun" | "mineral" | "fish" | "leaf" | "pill" | "metabolic";

export type SupplementRecommendation = {
  name: string;
  icon: SupplementIcon;
  dose: string;
  when: string;
  benefit: string;
  tags: string[];
};

export type SupplementRecommendationsResponse = {
  goal: string;
  goal_label: string;
  supplements: SupplementRecommendation[];
  total_count: number;
};

export type MealPlanCurrent = {
  plan_id: number;
  month: number;
  year: number;
  budget_level: BudgetLevel;
  generated_at: string;
  targets?: MealPlanTargets;
  today: MealDayPlan | null;
  month_overview: MealMonthOverviewDay[];
  generation_mode?: string;
  week_number?: number;
  week_start_day?: number;
  week_end_day?: number;
  week_label?: string;
  day_regens_used?: number;
  day_regens_limit?: number;
  day_regens_remaining?: number;
  month_plan_regens_used?: number;
  month_plan_regens_limit?: number;
  month_plan_regens_remaining?: number;
  planner_limits_exempt?: boolean;
  planner_days_unlocked?: boolean;
};

export type WeekTab = {
  week_number: number;
  start_day: number;
  end_day: number;
  label: string;
  days: number[];
  plan_id?: number | null;
  is_current: boolean;
  is_past: boolean;
  is_generated: boolean;
  can_generate: boolean;
};

export type WeeksOverviewResponse = {
  month: number;
  year: number;
  weeks: WeekTab[];
};

export type MealPlanWeeklyCurrent = {
  generation_mode: "weekly";
  current_week: MealPlanCurrent | null;
  weeks_generated: number;
  total_weeks: number;
  day_regens_used?: number;
  day_regens_limit?: number;
  day_regens_remaining?: number;
  month_plan_regens_used?: number;
  month_plan_regens_limit?: number;
  month_plan_regens_remaining?: number;
  planner_limits_exempt?: boolean;
  planner_days_unlocked?: boolean;
};

export function isWeeklyPlannerCurrent(data: unknown): data is MealPlanWeeklyCurrent {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as MealPlanWeeklyCurrent).generation_mode === "weekly"
  );
}

export type WorkoutExercise = {
  name: string;
  sets: number;
  reps: string;
  muscle: string;
  note: string;
  rest_seconds: number;
};

export type WorkoutDayPlan = {
  day: number;
  is_rest_day: boolean;
  split_name: string;
  focus_muscles: string[];
  exercises: WorkoutExercise[];
  estimated_duration_min: number;
  locked?: boolean;
  message?: string;
  swaps_used_today?: number;
  swaps_limit?: number;
  day_regens_used?: number;
  day_regens_limit?: number;
  day_regens_remaining?: number;
  month_plan_regens_used?: number;
  month_plan_regens_limit?: number;
  month_plan_regens_remaining?: number;
  planner_limits_exempt?: boolean;
  planner_days_unlocked?: boolean;
};

export type WorkoutMonthOverviewDay = {
  day: number;
  split_name: string;
  is_rest_day: boolean;
  is_past: boolean;
  is_today: boolean;
  is_future: boolean;
};

export type WorkoutPlanCurrent = {
  plan_id: number;
  month: number;
  year: number;
  focus_muscles: FocusMuscle[];
  /** @deprecated use focus_muscles */
  focus_muscle?: FocusMuscle | null;
  generated_at: string;
  today: WorkoutDayPlan | null;
  month_overview: WorkoutMonthOverviewDay[];
  day_regens_used?: number;
  day_regens_limit?: number;
  day_regens_remaining?: number;
  month_plan_regens_used?: number;
  month_plan_regens_limit?: number;
  month_plan_regens_remaining?: number;
  planner_limits_exempt?: boolean;
  planner_days_unlocked?: boolean;
};
