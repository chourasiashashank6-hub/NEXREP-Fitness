import { apiClient } from "./client";

export type StrengthLiftProgress = {
  exercise_id?: number | null;
  exercise_name: string;
  target_weight_kg: number;
  current_best_1rm_kg: number;
  percent: number;
  best_lift: {
    id: number;
    exercise_id?: number | null;
    weight_kg: number;
    reps: number;
    date: string | null;
  } | null;
};

export type StrengthProgress = {
  goal_type?: string | null;
  lifts: StrengthLiftProgress[];
  overall_percent: number;
  weeks_left: number | null;
  has_target_lifts: boolean;
};

export const logStrengthLift = async (payload: {
  exercise_id?: number | null;
  exercise_name: string;
  weight_kg: number;
  reps: number;
  workout_id?: number;
}) => {
  const { data } = await apiClient.post("/api/strength/lift", payload);
  return data;
};

export const updateStrengthLift = async (
  liftId: number,
  payload: {
    weight_kg: number;
    reps: number;
  },
) => {
  const { data } = await apiClient.patch(`/api/strength/lift/${liftId}`, payload);
  return data;
};

export const deleteStrengthLift = async (liftId: number): Promise<{ deleted: boolean; id: number }> => {
  const { data } = await apiClient.delete<{ deleted: boolean; id: number }>(`/api/strength/lift/${liftId}`);
  return data;
};

export const getStrengthProgress = async (): Promise<StrengthProgress> => {
  const { data } = await apiClient.get<StrengthProgress>("/api/strength/progress");
  return data;
};
