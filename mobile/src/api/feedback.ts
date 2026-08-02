import { apiClient } from "./client";

type FeedbackPayload = {
  subject: string;
  body: string;
};

export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  await apiClient.post("/feedback", payload);
}
