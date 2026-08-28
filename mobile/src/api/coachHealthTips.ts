import { apiClient } from "./client";

export type HealthTipItem = {
  id: string;
  category: string;
  title: string;
  body: string;
  tag: string;
};

export type HealthTipsResponse = {
  tips: HealthTipItem[];
  date: string;
};

export async function fetchHealthTips(localDate?: string): Promise<HealthTipsResponse> {
  const { data } = await apiClient.get<HealthTipsResponse>("/api/coach/health-tips", {
    params: localDate ? { local_date: localDate } : undefined,
  });
  return data;
}
