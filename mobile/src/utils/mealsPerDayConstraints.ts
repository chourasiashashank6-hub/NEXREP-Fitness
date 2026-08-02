import { MAX_KCAL_PER_MEAL, MIN_KCAL_PER_MEAL } from "../constants/onboarding";
import { calculateNutritionTargets } from "../engine/calculator";
import type { OnboardingData } from "../types/onboarding";
import type { PickerOption } from "./onboardingOptions";

export type MealsPerDayPickerOption = PickerOption<number> & {
  disabled?: boolean;
  caption?: string;
};

function hasPositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** True when onboarding has enough data for `calculateNutritionTargets` (Screens 1–3). */
export function canEstimateOnboardingCalories(data: OnboardingData): boolean {
  const { personal, goal, activity } = data;
  if (!personal.sex || !hasPositiveNumber(personal.age)) return false;

  const weight =
    personal.unit_system === "metric" ? personal.weight_kg : personal.weight_lb;
  const height =
    personal.unit_system === "metric" ? personal.height_cm : personal.height_in;
  if (!hasPositiveNumber(weight) || !hasPositiveNumber(height)) return false;
  if (!goal.type) return false;
  if (activity.workouts_per_week == null || activity.workouts_per_week < 1) return false;
  if (!activity.level && activity.tdee_multiplier == null) return false;

  return true;
}

/** Same calorie target as ResultsScreen preview; null when estimate isn't available (fail open). */
export function getEstimatedDailyCalories(data: OnboardingData): number | null {
  if (!canEstimateOnboardingCalories(data)) return null;
  try {
    const targets = calculateNutritionTargets(data);
    const kcal = targets.target_kcal;
    return Number.isFinite(kcal) && kcal > 0 ? kcal : null;
  } catch {
    return null;
  }
}

export function isMealsPerDayDisabled(estimatedDailyCalories: number, mealsPerDay: number): boolean {
  const perMeal = Math.round(estimatedDailyCalories / mealsPerDay);
  return perMeal < MIN_KCAL_PER_MEAL || perMeal > MAX_KCAL_PER_MEAL;
}

export function buildMealsPerDayOptions(
  estimatedDailyCalories: number,
  baseOptions: PickerOption<number>[],
  t: (key: string, options?: Record<string, unknown>) => string,
): MealsPerDayPickerOption[] {
  return baseOptions.map((option) => {
    const meals = Number(option.value);
    const perMeal = Math.round(estimatedDailyCalories / meals);
    const disabled = perMeal < MIN_KCAL_PER_MEAL || perMeal > MAX_KCAL_PER_MEAL;
    let caption: string | undefined;
    if (disabled) {
      caption =
        perMeal < MIN_KCAL_PER_MEAL
          ? t("onboarding.screen4.mealsPerDayTooLittle", { kcal: perMeal.toLocaleString() })
          : t("onboarding.screen4.mealsPerDayTooMuch", { kcal: perMeal.toLocaleString() });
    }
    return { ...option, disabled, caption };
  });
}
