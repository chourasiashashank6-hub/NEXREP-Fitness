import type { OnboardingData } from "../types/onboarding";
import i18n from "../i18n";

/** Minimum data required before saving targets / calling the API. */
export function validateOnboardingForSave(data: OnboardingData): string | null {
  const { personal, goal, activity, dietary } = data;
  if (!personal.name?.trim()) return i18n.t("onboarding.validation.name");
  if (personal.age == null || personal.age <= 0) return i18n.t("onboarding.validation.age");
  if (!personal.sex) return i18n.t("onboarding.validation.sex");

  if (personal.unit_system === "metric") {
    if (!personal.height_cm || personal.height_cm <= 0) return i18n.t("onboarding.validation.heightCm");
    if (!personal.weight_kg || personal.weight_kg <= 0) return i18n.t("onboarding.validation.weightKg");
  } else {
    if (!personal.height_in || personal.height_in <= 0) return i18n.t("onboarding.validation.heightIn");
    if (!personal.weight_lb || personal.weight_lb <= 0) return i18n.t("onboarding.validation.weightLb");
  }

  if (!goal.type) return i18n.t("onboarding.validation.goal");
  if (!goal.difficulty) return i18n.t("onboarding.validation.difficulty");
  if (!activity.level) return i18n.t("onboarding.validation.activity");
  if (!dietary.regional_food_styles?.length) return i18n.t("onboarding.validation.regionalFood");

  return null;
}
