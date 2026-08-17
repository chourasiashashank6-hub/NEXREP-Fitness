import { apiClient } from "./client";

export type WeightHistoryEntry = {
  id: number;
  weight_kg: number;
  weight_lb: number;
  log_date: string;
  note?: string | null;
};

export type WeightHistoryResponse = {
  entries: WeightHistoryEntry[];
  total_entries: number;
  latest_weight_kg?: number | null;
  first_weight_kg?: number | null;
  total_change_kg?: number | null;
  lowest_kg?: number | null;
  highest_kg?: number | null;
  days_requested: number;
};

export async function fetchWeightHistory(days = 365): Promise<WeightHistoryResponse> {
  const { data } = await apiClient.get<WeightHistoryResponse>("/api/weight/history", { params: { days } });
  return data;
}
