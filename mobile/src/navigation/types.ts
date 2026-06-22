import type { PlanId } from "../constants/plans";

export type ProfileStackParamList = {
  ProfileMain: undefined;
  NotificationPreferences: undefined;
  Subscription: undefined;
  ManageSubscription: { userId: string };
  PlanPicker: undefined;
  Payment: { planId: PlanId; displayPrice: number; isYearly: boolean };
  PaymentSuccess: { planName: string; paymentId: string };
};
