import { apiClient } from "./client";

export const getSummary = async () => {
  const { data } = await apiClient.get("/summary");
  return data;
};

export const addActivity = async (payload: {
  kind: "meal" | "exercise";
  title: string;
  calories?: number;
  duration?: number;
  intensity?: string;
  time?: string;
}) => {
  const { data } = await apiClient.post("/activity", payload);
  return data;
};
