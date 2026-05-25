import type { OnboardingData } from "../types/onboarding";

/** Minimum data required before saving targets / calling the API. */
export function validateOnboardingForSave(data: OnboardingData): string | null {
  const { personal, goal, activity } = data;
  if (!personal.name?.trim()) return "Please enter your name on Screen 1.";
  if (personal.age == null || personal.age <= 0) return "Please enter a valid age on Screen 1.";
  if (!personal.sex) return "Please select biological sex on Screen 1.";

  if (personal.unit_system === "metric") {
    if (!personal.height_cm || personal.height_cm <= 0) return "Please enter height (cm) on Screen 1.";
    if (!personal.weight_kg || personal.weight_kg <= 0) return "Please enter weight (kg) on Screen 1.";
  } else {
    if (!personal.height_in || personal.height_in <= 0) return "Please enter height (in) on Screen 1.";
    if (!personal.weight_lb || personal.weight_lb <= 0) return "Please enter weight (lb) on Screen 1.";
  }

  if (!goal.type) return "Please select a goal on Screen 2.";
  if (!goal.difficulty) return "Please select difficulty on Screen 2.";
  if (!activity.level) return "Please select activity level on Screen 3.";

  return null;
}
