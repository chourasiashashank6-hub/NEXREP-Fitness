import { apiClient } from "./client";

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  age: number;
  weight: number;
  goals: string;
  goalTag: string;
  difficulty: string;
  createdAt: string | null;
  disciplineScore: number;
  plan_id?: string;
  preferredLanguage?: string | null;
};

export const getProfile = async (): Promise<UserProfile> => {
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

export const updatePreferredLanguage = async (preferredLanguage: string | null) => {
  const { data } = await apiClient.patch<{ preferredLanguage: string | null }>(
    "/profile/language",
    { preferredLanguage },
  );
  return data;
};

export const getWorkoutPreferenceOptions = async () => {
  const { data } = await apiClient.get("/workout/preferences/options");
  return data;
};
