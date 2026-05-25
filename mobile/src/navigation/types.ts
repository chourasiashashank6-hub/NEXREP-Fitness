import type { PlanId } from "../constants/plans";

export type ProfileStackParamList = {
  ProfileMain: undefined;
  Subscription: undefined;
  ManageSubscription: { userId: string };
  Payment: { planId: PlanId; displayPrice: number; isYearly: boolean };
  PaymentSuccess: { planName: string; paymentId: string };
};
