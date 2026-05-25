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

export const PLANS: Plan[] = [
  {
    id: "pro",
    name: "PRO",
    desc: "Perfect for dedicated athletes",
    monthlyPrice: 999,
    yearlyPrice: 832,
    discountedMonthly: 499,
    discountedYearly: 415,
    featured: false,
    features: [
      { label: "Unlimited workout logging", included: true },
      { label: "AI-powered rep counter", included: true },
      { label: "Progress analytics & charts", included: true },
      { label: "100+ guided workout plans", included: true },
      { label: "Nutrition tracker", included: true },
      { label: "Personal trainer access", included: false },
      { label: "Custom meal plans", included: false },
      { label: "Priority support", included: false },
    ],
  },
  {
    id: "elite",
    name: "ELITE",
    desc: "For serious performance gains",
    monthlyPrice: 1999,
    yearlyPrice: 1665,
    discountedMonthly: 999,
    discountedYearly: 832,
    featured: true,
    features: [
      { label: "Everything in Pro", included: true },
      { label: "Personal trainer access", included: true },
      { label: "Custom AI meal plans", included: true },
      { label: "Advanced body composition", included: true },
      { label: "Priority 24/7 support", included: true },
      { label: "Exclusive live challenges", included: true },
      { label: "Wearable sync (Fitbit, Apple)", included: true },
      { label: "Early feature access", included: true },
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
    headline: plan.id === "pro" ? "Train Smarter." : "Peak Performance.",
  };
}

export function getPlanById(planId: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  return plan;
}
