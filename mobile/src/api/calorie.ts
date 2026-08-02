import { apiClient } from "./client";

export const addMeal = async (payload: {
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}) => {
  const { data } = await apiClient.post("/meal", payload);
  return data;
};

export const getCalories = async () => {
  const { data } = await apiClient.get("/calories");
  return data;
};
