export type PlanTier = "FREE" | "PRO" | "ELITE";
export type PlanStatus = "active" | "cancelled" | "expired" | "trial" | "past_due";
export type BillingCycle = "monthly" | "yearly";

export interface Subscription {
  id: string;
  userId: string;
  tier: PlanTier;
  status: PlanStatus;
  billingCycle: BillingCycle;
  priceINR: number;
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt?: string;
  trialEndsAt?: string;
  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: "INR";
  status: "paid" | "failed" | "refunded" | "pending";
  description: string;
  date: string;
  invoiceUrl?: string;
  razorpayPaymentId?: string;
}

export interface PlanHistoryEntry {
  tier: PlanTier;
  startDate: string;
  endDate?: string;
  reason: "initial" | "upgrade" | "downgrade" | "renewal" | "cancelled" | "expired";
}
