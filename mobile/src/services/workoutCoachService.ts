import { apiClient, COACH_API_TIMEOUT_MS } from "../api/client";
import axios from "axios";
import type { WorkoutCoachInsight, WorkoutData } from "../types/workoutCoach";
import { normalizeWorkoutCoachResponse } from "./coachNormalize";

export async function getWorkoutCoachInsight(data: WorkoutData): Promise<WorkoutCoachInsight> {
  try {
    const { data: payload } = await apiClient.post<Record<string, unknown>>(
      "/workout/coach/insight",
      { workoutData: data },
      { timeout: COACH_API_TIMEOUT_MS },
    );
    return normalizeWorkoutCoachResponse(payload, data);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail;
      if (typeof detail === "string" && detail.trim()) throw new Error(detail);
      throw new Error(e.message || "Workout coach API failed");
    }
    throw e;
  }
}

export function getFallbackInsight(data: WorkoutData): WorkoutCoachInsight {
  return normalizeWorkoutCoachResponse({}, data);
}
