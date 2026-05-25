import { apiClient } from "./client";

export const getProfile = async () => {
  const { data } = await apiClient.get("/profile");
  return data;
};

export const updateProfile = async (payload: {
  name: string;
  age: number;
  weight: number;
  goals: string;
  goalTag: string;
  difficulty: string;
}) => {
  const { data } = await apiClient.put("/profile", payload);
  return data;
};

export const getWorkoutPreferenceOptions = async () => {
  const { data } = await apiClient.get("/workout/preferences/options");
  return data;
};
