import { apiClient } from "./client";
import type { WorkoutData } from "../types/workoutCoach";

export type WorkoutHistoryItem = {
  id: number;
  exercise_id?: number | null;
  type: string;
  exerciseName: string;
  sets?: number | null;
  reps?: number | null;
  duration?: number | null;
  bodyPart?: string | null;
  musclesTrained?: string[];
  notes?: string | null;
  caloriesBurned?: number | null;
  strengthLift?: {
    id: number;
    exercise_id?: number | null;
    exercise_name: string;
    weight_kg: number;
    reps: number;
    estimated_1rm_kg: number;
    is_new_pr: boolean;
    date: string | null;
  } | null;
  date: string;
};

export const addWorkout = async (payload: {
  exercise_id?: number | null;
  type: "stability" | "hiit" | "compound";
  exerciseName: string;
  sets?: number;
  reps?: number;
  duration?: number;
  difficulty?: string;
  metValue?: number;
  timeTaken?: string;
  notes?: string;
}) => {
  const { data } = await apiClient.post("/workout", payload);
  return data;
};

/** Same server MET model as saving a workout — preview only. */
export const estimateWorkoutCalories = async (payload: {
  exercise_id?: number | null;
  type: string;
  exerciseName: string;
  sets?: number;
  reps?: number;
  duration?: number;
  difficulty?: string;
  metValue?: number;
  timeTaken?: string;
}): Promise<{ estimatedCalories: number }> => {
  const { data } = await apiClient.post<{ estimatedCalories: number }>("/workout/estimate", payload);
  return data;
};

export type WorkoutHistoryParams = {
  hours?: number;
  range?: "recent" | "all";
  limit?: number;
  offset?: number;
  search?: string;
};

export const getWorkoutHistory = async (
  paramsOrHours: number | WorkoutHistoryParams = 24,
): Promise<{ items: WorkoutHistoryItem[]; total?: number; limit?: number; offset?: number }> => {
  const params = typeof paramsOrHours === "number" ? { hours: paramsOrHours } : paramsOrHours;
  const { data } = await apiClient.get<{ items: WorkoutHistoryItem[]; total?: number; limit?: number; offset?: number }>(
    "/workout/history",
    { params },
  );
  return data;
};

export const getWorkoutTotalBurn = async (): Promise<{ totalCaloriesBurned: number; sessionCount: number }> => {
  const { data } = await apiClient.get<{ totalCaloriesBurned: number; sessionCount: number }>("/workout/total-burn");
  return data;
};

export const deleteWorkout = async (workoutId: number): Promise<{ deleted: boolean; workout_id: number }> => {
  try {
    const { data } = await apiClient.post<{ deleted: boolean; workout_id: number }>(`/workout/${workoutId}/delete`);
    return data;
  } catch {
    const { data } = await apiClient.delete<{ deleted: boolean; workout_id: number }>(`/workout/${workoutId}`);
    return data;
  }
};

export const updateWorkout = async (
  workoutId: number,
  payload: { sets?: number; reps?: number; duration?: number; timeTaken?: string },
): Promise<{
  updated: boolean;
  id: number;
  sets?: number | null;
  reps?: number | null;
  duration?: number | null;
  caloriesBurned?: number | null;
  timeTaken?: string | null;
}> => {
  const { data } = await apiClient.patch<{
    updated: boolean;
    id: number;
    sets?: number | null;
    reps?: number | null;
    duration?: number | null;
    caloriesBurned?: number | null;
    timeTaken?: string | null;
  }>(`/workout/${workoutId}`, payload);
  return data;
};

export const getWorkoutCatalog = async () => {
  const { data } = await apiClient.get("/workout/catalog");
  return data;
};

export const getWorkoutCatalogFiltered = async (params: {
  bodyPart?: string;
  type?: string;
  goalTag?: string;
  difficulty?: string;
  exerciseName?: string;
  equipment?: string;
}) => {
  const { data } = await apiClient.get("/workout/catalog", { params });
  return data;
};

export const getWorkoutCoachData = async (days = 14): Promise<WorkoutData> => {
  const { data } = await apiClient.get<WorkoutData>("/workout/coach/data", { params: { days } });
  return data;
};
