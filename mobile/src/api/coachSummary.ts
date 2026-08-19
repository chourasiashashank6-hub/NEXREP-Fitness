import { apiClient } from "./client";
import type { CoachCadence } from "../hooks/useCoachRedesign";
import type { CoachSummaryResponse } from "../types/coachSummary";

export async function fetchCoachSummary(params: {
  domain?: "nutrition" | "workout";
  cadence: Exclude<CoachCadence, "yearly">;
  localDate?: string;
}): Promise<CoachSummaryResponse> {
  const { data } = await apiClient.get<CoachSummaryResponse>("/api/coach/summary", {
    params: {
      domain: params.domain ?? "nutrition",
      cadence: params.cadence,
      local_date: params.localDate,
    },
  });
  return data;
}
