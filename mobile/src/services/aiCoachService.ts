// TODO: route through server — never call AI APIs from mobile
import { apiClient, COACH_API_TIMEOUT_MS } from "../api/client";
import axios from "axios";
import i18n from "../i18n";
import type { AICoachResponse, NutritionData, Task } from "../types/coach";
import { normalizeCalorieCoachResponse } from "./coachNormalize";

export function hasOpenAiKey() {
  return true;
}

export async function getCalorieCoachInsight(data: NutritionData): Promise<AICoachResponse> {
  try {
    const requestConfig = {
      timeout: COACH_API_TIMEOUT_MS,
      data: {
        generateDietTips: true,
        tipCount: 5,
        focus: ["gut_health", "macro_gaps", "meal_timing", "digestion"],
      },
    };
    let payload: Record<string, unknown>;
    try {
      const response = await apiClient.request<Record<string, unknown>>({
        method: "GET",
        url: "/api/calories/coach/insight",
        ...requestConfig,
      });
      payload = response.data;
    } catch (e) {
      if (!axios.isAxiosError(e) || ![400, 405, 415, 422].includes(e.response?.status ?? 0)) {
        throw e;
      }
      const response = await apiClient.get<Record<string, unknown>>("/api/calories/coach/insight", {
        timeout: COACH_API_TIMEOUT_MS,
      });
      payload = response.data;
    }
    return normalizeCalorieCoachResponse(payload, data);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail;
      if (typeof detail === "string" && detail.trim()) {
        throw new Error(detail);
      }
      throw new Error(e.message || i18n.t("services.coachApiFailed"));
    }
    throw e;
  }
}

export async function generateDailyTasks(data: NutritionData, insight: string): Promise<Task[]> {
  void data;
  void insight;
  return [];
}
