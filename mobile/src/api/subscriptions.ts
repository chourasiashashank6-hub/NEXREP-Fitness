import { apiClient } from "./client";
import type { PaymentRecord, PlanHistoryEntry, Subscription } from "../types/subscription";

export async function fetchSubscriptionApi(userId: string): Promise<{
  subscription: Subscription;
  planHistory: PlanHistoryEntry[];
}> {
  const { data } = await apiClient.get<{ subscription: Subscription; planHistory: PlanHistoryEntry[] }>(
    `/api/subscriptions/${userId}`,
  );
  return data;
}

export async function fetchPaymentsApi(userId: string): Promise<{ payments: PaymentRecord[] }> {
  const { data } = await apiClient.get<{ payments: PaymentRecord[] }>(`/api/subscriptions/${userId}/payments`);
  return data;
}

export async function cancelSubscriptionApi(payload: {
  userId: string;
  subscriptionId: string;
  reason?: string;
}): Promise<{ subscription: Subscription; message: string }> {
  const { data } = await apiClient.post<{ subscription: Subscription; message: string }>(
    "/api/subscriptions/cancel",
    payload,
  );
  return data;
}

export async function exportInvoicesApi(userId: string): Promise<{
  invoices: Array<{ paymentId: string; date: string; amount: number; url: string }>;
  count: number;
}> {
  const { data } = await apiClient.get(`/api/invoices/export/${userId}`);
  return data;
}
