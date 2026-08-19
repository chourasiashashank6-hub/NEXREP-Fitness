import { apiClient } from "./client";

export type CoachConfigResponse = {
  redesign_enabled: boolean;
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
