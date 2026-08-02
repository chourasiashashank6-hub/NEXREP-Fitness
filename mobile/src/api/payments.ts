import { apiClient } from "./client";
import type { PlanId } from "../constants/plans";

export type RazorpayOrderResponse = {
  key_id: string;
  order_id: string;
  amount: number;
  currency: string;
};

export async function createRazorpayOrder(payload: {
  plan_id: PlanId;
  billing_cycle: "monthly" | "yearly";
  amount_inr: number;
  payment_method: string;
}): Promise<RazorpayOrderResponse> {
  const { data } = await apiClient.post<RazorpayOrderResponse>("/api/payments/razorpay/order", payload);
  return data;
}

export async function verifyRazorpayPayment(payload: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  plan_id: PlanId;
  billing_cycle: "monthly" | "yearly";
}) {
  const { data } = await apiClient.post("/api/payments/razorpay/verify", payload);
  return data;
}

export async function devActivatePlan(payload: {
  plan_id: PlanId;
  billing_cycle: "monthly" | "yearly";
  amount_inr: number;
}) {
  const { data } = await apiClient.post("/api/payments/dev/activate-plan", payload);
  return data;
}
