// TODO: route through server — never call AI APIs from mobile
import { apiClient, COACH_API_TIMEOUT_MS } from "../api/client";
import axios from "axios";
import type { AICoachResponse, NutritionData, Task } from "../types/coach";
import { normalizeCalorieCoachResponse } from "./coachNormalize";

export function hasOpenAiKey() {
  return true;
}

export async function getCalorieCoachInsight(data: NutritionData): Promise<AICoachResponse> {
  try {
    const { data: payload } = await apiClient.get<Record<string, unknown>>("/api/calories/coach/insight", {
      timeout: COACH_API_TIMEOUT_MS,
    });
    return normalizeCalorieCoachResponse(payload, data);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail;
      if (typeof detail === "string" && detail.trim()) {
        throw new Error(detail);
      }
      throw new Error(e.message || "Coach API request failed");
    }
    throw e;
  }
}

export async function generateDailyTasks(data: NutritionData, insight: string): Promise<Task[]> {
  void data;
  void insight;
  return [];
}
