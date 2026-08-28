import { apiClient } from "./client";
import { localDateIso } from "../utils/localDate";

export type FastingPeriodType =
  | "navratri"
  | "ramadan"
  | "ekadashi"
  | "custom"
  | "karva_chauth"
  | "sawan_somwar"
  | "maha_shivratri"
  | "janmashtami"
  | "vat_savitri"
  | "chhath_puja";

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

const localDateParam = () => localDateIso();

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
