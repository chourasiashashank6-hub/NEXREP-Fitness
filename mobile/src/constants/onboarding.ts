import { OnboardingData } from "../types/onboarding";

export const ONBOARDING_COLORS = {
  bg: "#1A1A1A",
  card: "#252525",
  primary: "#7F77DD",
  success: "#1D9E75",
  textPrimary: "#FFFFFF",
  textSecondary: "#888888",
  textTertiary: "#555555",
  border: "#333333",
  requiredBg: "#3D1A1A",
  requiredText: "#E05A5A",
  optionalBg: "#0D2D1F",
  optionalText: "#1D9E75",
  danger: "#E05A5A",
  carbs: "#1D9E75",
  protein: "#7F77DD",
  fat: "#EF9F27",
  coachBg: "#1E1B3A",
  coachText: "#AFA9EC",
};

export const DEFAULT_ONBOARDING_DATA: OnboardingData = {
  personal: {
    name: "",
    age: null,
    sex: null,
    unit_system: "metric",
    height_cm: null,
    height_in: null,
    weight_kg: null,
    weight_lb: null,
    body_fat_percentage: null,
    bf_measurement_method: null,
  },
  goal: {
    type: null,
    pace: null,
    difficulty: null,
    focus_muscle: null,
    target_weight_kg: null,
    target_weight_lb: null,
    target_date: null,
  },
  activity: {
    level: null,
    workouts_per_week: null,
    workout_types: [],
  },
  dietary: {
    diet_type: "standard",
    allergies: [],
    meals_per_day: 3,
  },
  app_setup: {
    weigh_in_reminder_enabled: true,
    reminder_time: "7:00 AM",
    water_intake_goal_liters: null,
    notifications: {
      meal_logging: true,
      coach_insights: true,
      weekly_summary: true,
      streak_alerts: true,
    },
    region: "IN",
  },
};

export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
};
