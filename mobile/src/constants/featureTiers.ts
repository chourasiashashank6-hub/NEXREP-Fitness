export type PlanId = "free" | "pro" | "elite";

export const FEATURE_TIERS: Record<string, PlanId> = {
  food_photo_analysis: "pro",
  calorie_coach: "pro",
  workout_coach: "pro",
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

const PLAN_HIERARCHY: Record<PlanId, number> = {
  free: 0,
  pro: 1,
  elite: 2,
};

export function canAccess(userPlan: PlanId | string, feature: string): boolean {
  const required = FEATURE_TIERS[feature] ?? "elite";
  const userLevel = PLAN_HIERARCHY[userPlan as PlanId] ?? 0;
  const neededLevel = PLAN_HIERARCHY[required as PlanId] ?? 2;
  return userLevel >= neededLevel;
}

export function getRequiredPlan(feature: string): PlanId {
  return (FEATURE_TIERS[feature] as PlanId) ?? "elite";
}
