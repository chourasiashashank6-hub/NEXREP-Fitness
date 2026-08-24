import type { OnboardingData } from "../types/onboarding";

/** Default true — existing users without the field keep warm-up behavior. */
export function isPreWorkoutEnabled(
  onboarding: Pick<OnboardingData, "app_setup"> | null | undefined,
): boolean {
  return onboarding?.app_setup?.pre_workout_enabled !== false;
}
