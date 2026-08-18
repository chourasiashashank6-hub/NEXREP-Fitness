import { apiClient } from "./client";

export type JourneyEventItem = {
  id: number;
  domain: string;
  event_type: string;
  status: "active" | "resolved";
  detected_at: string | null;
  resolved_at: string | null;
  payload_json: Record<string, unknown>;
  recommendation_key: string;
  recommendation_params: Record<string, string | number>;
};

export type JourneyEventsResponse = {
  items: JourneyEventItem[];
  total: number;
  limit: number;
  offset: number;
};

export async function fetchJourneyEvents(params?: {
  domain?: string;
  status?: "active" | "resolved";
  limit?: number;
  offset?: number;
}): Promise<JourneyEventsResponse> {
  const { data } = await apiClient.get<JourneyEventsResponse>("/api/journey/events", { params });
  return data;
}
