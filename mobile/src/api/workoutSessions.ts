import { apiClient } from "./client";

export interface CompleteSessionPayload {
  session_id: string;
  plan_day_id: string;
  started_at: string;
  ended_at: string;
  status: "completed" | "abandoned";
  set_logs: Array<{
    exercise_name: string;
    set_number: number;
    reps: number;
    weight_kg: number | null;
    started_at: string;
    completed_at: string;
    tracking_method?: "manual" | "ai_camera";
  }>;
  user_weight_kg: number;
}

export interface CompleteSessionResponse {
  session_id: string;
  server_kcal_total: number;
  streak_incremented: boolean;
}

export async function postSessionComplete(
  payload: CompleteSessionPayload,
): Promise<CompleteSessionResponse> {
  const { data } = await apiClient.post<CompleteSessionResponse>("/api/sessions/complete", payload);
  return data;
}
