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
    focus_muscles: [],
    focus_muscle: null,
    target_lifts: [],
    target_weight_kg: null,
    target_weight_lb: null,
    target_date: null,
  },
  activity: {
    level: null,
    workouts_per_week: null,
    tdee_multiplier: null,
    workout_types: [],
    equipment_access: "full_gym",
  },
  dietary: {
    diet_type: "standard",
    allergies: [],
    meals_per_day: 3,
  },
  body_type: {
    gender: "male",
    current_body_id: "",
    goal_body_id: "",
    problem_areas: [],
  },
  app_setup: {
    pre_workout_enabled: true,
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
    preferred_language: null,
  },
};

export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
};

/** Piecewise-linear TDEE anchors (workouts/week → Mifflin activity factor). */
const TDEE_ANCHORS: [number, number][] = [
  [0, 1.2],
  [1.5, 1.375],
  [3.5, 1.55],
  [5.5, 1.725],
  [14, 1.9],
];

/** Keep in sync with server/src/services/calorie_log_targets.py */
export function getTdeeMultiplier(workoutsPerWeek: number): number {
  for (let i = 0; i < TDEE_ANCHORS.length - 1; i++) {
    const [x0, y0] = TDEE_ANCHORS[i];
    const [x1, y1] = TDEE_ANCHORS[i + 1];
    if (x0 <= workoutsPerWeek && workoutsPerWeek <= x1) {
      const t = (workoutsPerWeek - x0) / (x1 - x0);
      return Math.round((y0 + t * (y1 - y0)) * 100) / 100;
    }
  }
  if (workoutsPerWeek > TDEE_ANCHORS[TDEE_ANCHORS.length - 1][0]) {
    return TDEE_ANCHORS[TDEE_ANCHORS.length - 1][1];
  }
  return TDEE_ANCHORS[0][1];
}

/** Keep in sync with server/src/services/calorie_log_targets.py */
export function getActivityLevel(workoutsPerWeek: number): import("../types/onboarding").ActivityLevel {
  if (workoutsPerWeek <= 0) return "sedentary";
  if (workoutsPerWeek <= 2) return "lightly_active";
  if (workoutsPerWeek <= 4) return "moderately_active";
  if (workoutsPerWeek <= 6) return "very_active";
  return "extremely_active";
}

export const WORKOUTS_PER_WEEK_MIN = 0;
export const WORKOUTS_PER_WEEK_MAX = 14;

/** Per-meal kcal bounds for meals-per-day picker (Screen 4). */
export const MIN_KCAL_PER_MEAL = 350;
export const MAX_KCAL_PER_MEAL = 1000;
