export type PlanId = "free" | "pro" | "elite";

/** Offline fallback — kept in sync with server/src/core/feature_tiers.py */
export const FEATURE_TIERS_FALLBACK: Record<string, PlanId> = {
  food_photo_analysis: "pro",
  calorie_coach: "pro",
  workout_coach: "pro",
  coach_daily_analysis: "pro",
  coach_weekly_analysis: "pro",
  coach_monthly_analysis: "elite",
  coach_yearly_analysis: "elite",
  meal_plan_generation: "pro",
  meal_day_regen: "pro",
  meal_swap: "pro",
  protein_suggestions: "pro",
  workout_plan_generation: "pro",
  workout_swap: "pro",
  meal_regen_remaining: "pro",
  workout_regen_remaining: "pro",
  mediapipe_pose_guidance: "pro",
  ai_rep_counter: "pro",
  preworkout_recommendation: "pro",
  guided_warmup_session: "elite",
  daily_game_plan: "pro",
  gym_squads_join: "free",
  gym_squads_create: "pro",
  smart_reflow: "pro",
  progress_xp: "free",
  fasting_aware_meals: "free",
  progress_photos: "free",
  progress_photo_comparison: "pro",
  workout_logging: "free",
  calorie_logging: "free",
  weight_logging: "free",
  water_logging: "free",
  basic_nutrition: "free",
};

/** @deprecated Use FEATURE_TIERS_FALLBACK or getFeatureTiers() */
export const FEATURE_TIERS = FEATURE_TIERS_FALLBACK;

let remoteFeatureTiers: Record<string, PlanId> | null = null;

export function setRemoteFeatureTiers(tiers: Record<string, string> | undefined | null): void {
  if (!tiers || typeof tiers !== "object") return;
  const normalized: Record<string, PlanId> = {};
  for (const [key, plan] of Object.entries(tiers)) {
    if (plan === "free" || plan === "pro" || plan === "elite") {
      normalized[key] = plan;
    }
  }
  remoteFeatureTiers = Object.keys(normalized).length ? normalized : null;
}

export function getFeatureTiers(): Record<string, PlanId> {
  return remoteFeatureTiers ?? FEATURE_TIERS_FALLBACK;
}

const PLAN_HIERARCHY: Record<PlanId, number> = {
  free: 0,
  pro: 1,
  elite: 2,
};

export function canAccess(userPlan: PlanId | string, feature: string): boolean {
  const tiers = getFeatureTiers();
  const required = tiers[feature] ?? "elite";
  const userLevel = PLAN_HIERARCHY[userPlan as PlanId] ?? 0;
  const neededLevel = PLAN_HIERARCHY[required as PlanId] ?? 2;
  return userLevel >= neededLevel;
}

export function getRequiredPlan(feature: string): PlanId {
  return (getFeatureTiers()[feature] as PlanId) ?? "elite";
}
