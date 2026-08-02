export type BiologicalSex = "male" | "female" | "other";
export type UnitSystem = "metric" | "imperial";
export type GoalType = "fat_loss" | "muscle_gain" | "strength" | "recomp" | "maintain";
export type GoalPace = "slow" | "moderate" | "aggressive";
export type DifficultyLevel = "beginner" | "intermediate" | "advanced";
export type ActivityLevel = "sedentary" | "lightly_active" | "moderately_active" | "very_active" | "extremely_active";
export type FocusMuscle = "Chest" | "Back" | "Shoulders" | "Legs" | "Arms" | "Core";
export type TargetLift = { exercise_id?: number | null; exercise_name: string; target_weight_kg: number };

export interface BodyTypeData {
  gender: "male" | "female";
  current_body_id: string;
  goal_body_id: string;
  problem_areas: string[];
}

export type OnboardingData = {
  personal: {
    name: string;
    age: number | null;
    sex: BiologicalSex | null;
    unit_system: UnitSystem;
    height_cm: number | null;
    height_in: number | null;
    weight_kg: number | null;
    weight_lb: number | null;
    body_fat_percentage: number | null;
    bf_measurement_method: "smart_scale" | "calipers" | "dexa_scan" | "visual_estimate" | null;
  };
  goal: {
    type: GoalType | null;
    pace: GoalPace | null;
    difficulty: DifficultyLevel | null;
    focus_muscles: FocusMuscle[];
    /** @deprecated use focus_muscles; kept for legacy payloads */
    focus_muscle?: FocusMuscle | null;
    target_lifts?: TargetLift[];
    target_weight_kg: number | null;
    target_weight_lb: number | null;
    target_date: string | null;
  };
  activity: {
    level: ActivityLevel | null;
    workouts_per_week: number | null;
    tdee_multiplier: number | null;
    workout_types: string[];
  };
  dietary: {
    diet_type: string;
    allergies: string[];
    meals_per_day: number | null;
  };
  body_type?: BodyTypeData;
  app_setup: {
    weigh_in_reminder_enabled: boolean;
    reminder_time: string;
    water_intake_goal_liters: number | null;
    notifications: {
      meal_logging: boolean;
      coach_insights: boolean;
      weekly_summary: boolean;
      streak_alerts: boolean;
    };
    region: string;
    preferred_language?: string | null;
  };
};

export type NutritionTargets = {
  calculated_at: string;
  formula_version: string;
  bmr: { formula_used: "mifflin_st_jeor" | "katch_mcardle"; value_kcal: number };
  tdee: { activity_multiplier: number; value_kcal: number };
  target_kcal: number;
  macros: {
    protein_g: number;
    protein_kcal: number;
    protein_pct: number;
    carbs_g: number;
    carbs_kcal: number;
    carbs_pct: number;
    fat_g: number;
    fat_kcal: number;
    fat_pct: number;
    fiber_g: number;
    water_l: number;
  };
  timeline: {
    weeks_to_goal: number | null;
    estimated_completion_date: string | null;
    weekly_change_kg: number;
    daily_delta_kcal: number;
    exercise_share: number;
    diet_share: number;
    exercise_delta_kcal: number;
    diet_delta_kcal: number;
    pace_label: string;
  };
  safety: {
    floor_kcal: number;
    is_safe: boolean;
    was_clamped: boolean;
    warning: string | null;
  };
  coach_message: string;
};
