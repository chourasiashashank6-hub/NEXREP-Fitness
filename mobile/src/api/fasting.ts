import { apiClient } from "./client";

export type FastingPeriodType = "navratri" | "ramadan" | "ekadashi" | "custom";

export type FastingPreference = {
  id: number;
  period_type: FastingPeriodType;
  start_date: string;
  end_date: string;
  active: boolean;
  fasting_tag: string;
};

export type FastingPreferencesResponse = {
  items: FastingPreference[];
  active: FastingPreference | null;
  log_date: string;
};

export type FastingPreferencePayload = {
  id?: number;
  period_type: FastingPeriodType;
  start_date: string;
  end_date: string;
  active?: boolean;
};

const localDateParam = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export async function getFastingPreferences(): Promise<FastingPreferencesResponse> {
  const { data } = await apiClient.get<FastingPreferencesResponse>("/api/fasting/preferences", {
    params: { local_date: localDateParam() },
  });
  return data;
}

export async function saveFastingPreference(payload: FastingPreferencePayload): Promise<FastingPreference> {
  const { data } = await apiClient.post<{ preference: FastingPreference }>("/api/fasting/preferences", payload);
  return data.preference;
}

export async function deactivateFastingPreference(preferenceId: number): Promise<FastingPreference> {
  const { data } = await apiClient.post<{ preference: FastingPreference }>(
    `/api/fasting/preferences/${preferenceId}/deactivate`,
  );
  return data.preference;
}
