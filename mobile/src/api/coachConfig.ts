import { apiClient } from "./client";

export type CoachConfigResponse = {
  redesign_enabled: boolean;
  feature_tiers?: Record<string, string>;
};

export type CoachConfigMeResponse = CoachConfigResponse & {
  history_days: number;
  history_days_nutrition: number | null;
  history_days_workout: number | null;
  yearly_unlocked: boolean;
  days_until_yearly: number;
  yearly_unlock_at_days: number;
};

export async function fetchCoachConfig(): Promise<CoachConfigResponse> {
  const { data } = await apiClient.get<CoachConfigResponse>("/api/coach/config");
  return data;
}

export async function fetchCoachConfigMe(): Promise<CoachConfigMeResponse> {
  const { data } = await apiClient.get<CoachConfigMeResponse>("/api/coach/config/me");
  return data;
}

export type CoachYearlySummaryResponse = {
  enabled: boolean;
  cadence: "yearly";
  period: { start: string; end: string; year: number; days_with_data?: number; label_partial?: boolean };
  yearly: {
    year_score: number;
    hero_label_key: string;
    nutrition: {
      days_logged: number;
      days_on_target: number;
      adherence_pct: number;
      avg_protein_g: number;
      weight: { start_kg: number | null; end_kg: number | null; change_kg: number | null; weigh_ins: number };
      target_weight_kg: number | null;
    };
    workout: { sessions: number; total_sets: number };
    journey_events: number;
  };
};

export async function fetchYearlyCoachSummary(localDate?: string): Promise<CoachYearlySummaryResponse> {
  const { data } = await apiClient.get<CoachYearlySummaryResponse>("/api/coach/yearly-summary", {
    params: localDate ? { local_date: localDate } : undefined,
  });
  return data;
}
