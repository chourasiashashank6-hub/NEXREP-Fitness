import type { PlanId } from "../constants/plans";

export type ProfileStackParamList = {
  ProfileMain: undefined;
  Subscription: undefined;
  Payment: { planId: PlanId; price: number; isYearly: boolean };
};
