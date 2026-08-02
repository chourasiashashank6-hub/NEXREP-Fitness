import { apiClient, COACH_API_TIMEOUT_MS } from "../api/client";
import axios from "axios";
import i18n from "../i18n";
import type { OnboardingData } from "../types/onboarding";
import type { WorkoutCoachInsight, WorkoutData } from "../types/workoutCoach";
import { normalizeWorkoutCoachResponse } from "./coachNormalize";

export async function getWorkoutCoachInsight(data: WorkoutData, onboardingData?: OnboardingData | null): Promise<WorkoutCoachInsight> {
  try {
    const { data: payload } = await apiClient.post<Record<string, unknown>>(
      "/workout/coach/insight",
      { workoutData: data },
      { timeout: COACH_API_TIMEOUT_MS },
    );
    return normalizeWorkoutCoachResponse(payload, data, onboardingData);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail;
      if (typeof detail === "string" && detail.trim()) throw new Error(detail);
      throw new Error(e.message || i18n.t("services.workoutCoachApiFailed"));
    }
    throw e;
  }
}

export function getFallbackInsight(data: WorkoutData, onboardingData?: OnboardingData | null): WorkoutCoachInsight {
  return normalizeWorkoutCoachResponse({}, data, onboardingData);
}
