import { apiClient, COACH_API_TIMEOUT_MS } from "./client";
import type { FocusMuscle, WorkoutDayPlan, WorkoutPlanCurrent } from "../types/planner";
import { localDateIso } from "../utils/localDate";

const params = () => ({ local_date: localDateIso() });

export async function fetchWorkoutPlanCurrent(): Promise<WorkoutPlanCurrent | null> {
  try {
    const { data } = await apiClient.get<WorkoutPlanCurrent>("/api/workout-planner/current", { params: params() });
    return data;
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw e;
  }
}

export async function generateWorkoutPlan(focusMuscles: FocusMuscle[]): Promise<WorkoutPlanCurrent> {
  const { data } = await apiClient.post<WorkoutPlanCurrent>(
    "/api/workout-planner/generate",
    { focus_muscles: focusMuscles.length > 0 ? focusMuscles : null },
    { params: params(), timeout: COACH_API_TIMEOUT_MS },
  );
  return data;
}

export async function fetchWorkoutPlanDay(day: number): Promise<WorkoutDayPlan> {
  const { data } = await apiClient.get<WorkoutDayPlan>(`/api/workout-planner/day/${day}`, { params: params() });
  return data;
}

export async function deleteWorkoutPlan(): Promise<void> {
  await apiClient.delete("/api/workout-planner/current", { params: params() });
}

export async function regenerateWorkoutMonthPlan(planId: number): Promise<WorkoutPlanCurrent> {
  const { data } = await apiClient.post<WorkoutPlanCurrent>(
    "/api/workout-planner/regenerate-remaining",
    { plan_id: planId },
    { params: params(), timeout: COACH_API_TIMEOUT_MS },
  );
  return data;
}

export async function regenerateWorkoutPlanDay(payload: { plan_id: number; day: number }): Promise<WorkoutDayPlan> {
  const { data } = await apiClient.post<WorkoutDayPlan>("/api/workout-planner/regenerate-day", payload, {
    params: params(),
    timeout: COACH_API_TIMEOUT_MS,
  });
  return data;
}

export async function swapWorkoutExercise(payload: {
  plan_id: number;
  day: number;
  exercise_index: number;
  reason?: string;
}): Promise<WorkoutDayPlan> {
  const { data } = await apiClient.post<WorkoutDayPlan>("/api/workout-planner/swap-exercise", payload, {
    params: params(),
    timeout: COACH_API_TIMEOUT_MS,
  });
  return data;
}
