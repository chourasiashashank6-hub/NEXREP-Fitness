export type MacroStatusValue = "low" | "on_track" | "high";

export type CoachSummaryNote = {
  kind: string;
  key: string;
  params?: Record<string, string | number>;
};

export type CoachSummaryDay = {
  date: string;
  logged: boolean;
  meals_count: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_l: number;
  target_calories: number;
  target_protein_g: number;
  target_carbs_g: number;
  target_fat_g: number;
  target_water_l: number;
  calories_remaining: number;
  on_target: boolean;
  adherence_pct: number;
  macro_status: Record<"protein" | "carbs" | "fat", MacroStatusValue>;
  score: number;
  score_label_key: string;
};

export type CoachSummaryDailyBreakdown = {
  date: string;
  logged: boolean;
  adherence_pct: number;
  on_target: boolean;
};

export type CoachSummaryAggregate = {
  days_total: number;
  days_logged: number;
  days_on_target: number;
  adherence_pct: number;
  avg_calories: number;
  avg_protein_g: number;
  avg_carbs_g: number;
  avg_fat_g: number;
  avg_water_l: number;
};

export type CoachSummaryWeekly = CoachSummaryAggregate & {
  week_score: number;
  label_days: number;
  hero_label_key?: string;
};

export type CoachSummaryMonthly = CoachSummaryAggregate & {
  weight: {
    start_kg: number | null;
    end_kg: number | null;
    change_kg: number | null;
    weigh_ins: number;
  };
  target_weight_kg: number | null;
  pacing_key: string | null;
  mom: {
    adherence_pct: number;
    adherence_pct_delta: number;
    avg_protein_g: number;
    avg_protein_g_delta: number;
    days_logged: number;
    days_logged_delta: number;
    comparable: boolean;
  } | null;
};

export type CoachSummaryReadinessFactor = {
  type: "good" | "warning" | "bad" | "info";
  label_key: string;
  params?: Record<string, string | number>;
};

export type CoachSummaryWorkoutTip = {
  key: string;
  params?: Record<string, string | number>;
  priority: "high" | "medium" | "low";
  icon: string;
  category: string;
};

export type CoachSummaryRecoveryCard = {
  icon: "sleep" | "water" | "stretch" | "food" | "rest";
  title_key: string;
  body_key: string;
};

export type CoachSummaryMuscleGroup = {
  name: string;
  status: "sore" | "tired" | "ready" | "fresh";
  recovery_percent: number;
  last_trained_at: string | null;
};

export type CoachSummaryWorkoutDaily = {
  readiness_score: number;
  readiness_label_key: string;
  completed_sets_today: number;
  completed_sets_week: number;
  target_sets_week: number;
  weekly_percent: number;
  muscle_groups: CoachSummaryMuscleGroup[];
  readiness_factors: CoachSummaryReadinessFactor[];
  tips: CoachSummaryWorkoutTip[];
  recovery_cards: CoachSummaryRecoveryCard[];
};

export type CoachSummaryWorkoutWeekly = {
  week_score: number;
  hero_label_key: string;
  completed_sets: number;
  target_sets: number;
  weekly_percent: number;
  sessions: number;
  volume_by_muscle: Array<{ muscle: string; sets: number; target_sets: number }>;
  consistency: Array<{ date: string; trained: boolean }>;
};

export type CoachSummaryWorkoutMonthly = {
  month_score: number;
  hero_label_key: string;
  sessions: number;
  total_sets: number;
  volume_trend_pct: number | null;
  volume_by_week: Array<{ week: number; sets: number }>;
  strength_progression: Array<{
    label_key: string;
    start_kg: number;
    end_kg: number;
    delta_kg: number;
  }>;
};

export type CoachSummaryResponse = {
  enabled?: boolean;
  domain: "nutrition" | "workout";
  cadence: "daily" | "weekly" | "monthly";
  period: {
    start_date: string;
    end_date: string;
    days_in_period: number;
    days_with_data?: number;
    label_partial?: boolean;
  };
  targets?: {
    target_calories: number;
    target_protein_g: number;
    target_carbs_g: number;
    target_fat_g: number;
    target_water_l: number;
  };
  streak?: {
    current_streak: number;
    personal_best_streak: number;
  };
  daily?: CoachSummaryDay | CoachSummaryWorkoutDaily;
  weekly?: CoachSummaryWeekly | CoachSummaryWorkoutWeekly;
  monthly?: CoachSummaryMonthly | CoachSummaryWorkoutMonthly;
  daily_breakdown?: CoachSummaryDailyBreakdown[];
  notes?: CoachSummaryNote[];
  journey_events?: Array<{
    id: number;
    event_type: string;
    status: string;
    detected_at: string | null;
    recommendation_key: string;
    recommendation_params: Record<string, string | number>;
  }>;
  generated_at?: string;
};

export function isNutritionSummary(summary: CoachSummaryResponse): summary is CoachSummaryResponse & { domain: "nutrition" } {
  return summary.domain === "nutrition";
}

export function isWorkoutSummary(summary: CoachSummaryResponse): summary is CoachSummaryResponse & { domain: "workout" } {
  return summary.domain === "workout";
}

export function isNutritionDay(day: CoachSummaryDay | CoachSummaryWorkoutDaily): day is CoachSummaryDay {
  return "score_label_key" in day;
}

export function isWorkoutDay(day: CoachSummaryDay | CoachSummaryWorkoutDaily): day is CoachSummaryWorkoutDaily {
  return "readiness_label_key" in day;
}
