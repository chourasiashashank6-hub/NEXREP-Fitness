import { apiClient } from "./client";

export const chatWithCoach = async (payload: {
  message: string;
  context?: Record<string, unknown>;
}) => {
  const { data } = await apiClient.post("/ai/chat", payload);
  return data;
};
