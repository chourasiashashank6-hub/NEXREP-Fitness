import i18n from "../i18n";

export type PlanId = "pro" | "elite";

export type PlanFeature = { label: string; included: boolean };

export type Plan = {
  id: PlanId;
  name: string;
  desc: string;
  monthlyPrice: number;
  yearlyPrice: number;
  discountedMonthly: number;
  discountedYearly: number;
  featured: boolean;
  features: PlanFeature[];
};

export const VALID_COUPON = "NEXREP50";

/** Set true when server-side coupon validation ships. */
export const COUPONS_UI_ENABLED = false;

/** Must match server PLAN_PRICES_INR (GST-inclusive) — used for Razorpay order amount validation. */
export const SERVER_PLAN_AMOUNTS_INR: Record<PlanId, Record<"monthly" | "yearly", number>> = {
  pro: { monthly: 999, yearly: 832 * 12 },
  elite: { monthly: 1999, yearly: 1665 * 12 },
};

export function getServerPlanAmountInr(planId: PlanId, billingCycle: "monthly" | "yearly"): number {
  return SERVER_PLAN_AMOUNTS_INR[planId][billingCycle];
}

export const PLANS: Plan[] = [
  {
    id: "pro",
    name: "PRO",
    desc: i18n.t("subscription.plans.pro.desc"),
    monthlyPrice: 999,
    yearlyPrice: 832,
    discountedMonthly: 499,
    discountedYearly: 415,
    featured: false,
    features: [
      { label: i18n.t("subscription.plans.pro.features.workoutLogging"), included: true },
      { label: i18n.t("subscription.plans.pro.features.repCounter"), included: true },
      { label: i18n.t("subscription.plans.pro.features.analytics"), included: true },
      { label: i18n.t("subscription.plans.pro.features.guidedPlans"), included: true },
      { label: i18n.t("subscription.plans.pro.features.nutritionTracker"), included: true },
      { label: i18n.t("subscription.plans.pro.features.monthlyPlanners"), included: true },
      { label: i18n.t("subscription.plans.pro.features.trainerAccess"), included: false },
      { label: i18n.t("subscription.plans.pro.features.prioritySupport"), included: false },
    ],
  },
  {
    id: "elite",
    name: "ELITE",
    desc: i18n.t("subscription.plans.elite.desc"),
    monthlyPrice: 1999,
    yearlyPrice: 1665,
    discountedMonthly: 999,
    discountedYearly: 832,
    featured: true,
    features: [
      { label: i18n.t("subscription.plans.elite.features.everythingPro"), included: true },
      { label: i18n.t("subscription.plans.elite.features.trainerAccess"), included: true },
      { label: i18n.t("subscription.plans.elite.features.bodyComposition"), included: true },
      { label: i18n.t("subscription.plans.elite.features.prioritySupport"), included: true },
      { label: i18n.t("subscription.plans.elite.features.liveChallenges"), included: true },
      { label: i18n.t("subscription.plans.elite.features.wearableSync"), included: true },
      { label: i18n.t("subscription.plans.elite.features.earlyAccess"), included: true },
    ],
  },
];

export function getPrice(plan: Plan, isYearly: boolean, couponApplied: boolean): number {
  if (couponApplied) {
    return isYearly ? plan.discountedYearly : plan.discountedMonthly;
  }
  return isYearly ? plan.yearlyPrice : plan.monthlyPrice;
}

export function getOriginalPrice(plan: Plan, isYearly: boolean): number {
  return isYearly ? plan.yearlyPrice : plan.monthlyPrice;
}

export type CheckoutPlanName = "PRO" | "ELITE";

export type CheckoutPlan = {
  name: CheckoutPlanName;
  planId: PlanId;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  desc: string;
  headline: string;
};

export const CHECKOUT_COUPONS: Record<string, number> = {
  NEXREP20: 0.2,
  FIRST10: 0.1,
};

export function planToCheckout(plan: Plan): CheckoutPlan {
  return {
    name: plan.name as CheckoutPlanName,
    planId: plan.id,
    priceMonthly: plan.monthlyPrice,
    priceYearly: Math.round(plan.yearlyPrice * 12 * 0.8),
    features: plan.features.filter((f) => f.included).map((f) => f.label),
    desc: plan.desc,
    headline: plan.id === "pro" ? i18n.t("subscription.plans.pro.headline") : i18n.t("subscription.plans.elite.headline"),
  };
}

export function getPlanById(planId: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  return plan;
}
