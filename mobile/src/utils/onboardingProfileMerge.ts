import type { OnboardingData } from "../types/onboarding";

type ProfileLike = {
  name?: string | null;
  age?: number | null;
  weight?: number | null;
};

/** Keep onboarding personal fields aligned with the authenticated profile row. */
export function mergeOnboardingWithProfile(
  onboarding: OnboardingData,
  profile: ProfileLike | null | undefined,
): OnboardingData {
  if (!profile) return onboarding;

  const personal = { ...onboarding.personal };
  const profileName = String(profile.name || "").trim();
  if (profileName) personal.name = profileName;

  if (profile.age != null && Number(profile.age) > 0) {
    personal.age = Number(profile.age);
  }

  if (profile.weight != null && Number(profile.weight) > 0) {
    personal.weight_kg = Number(profile.weight);
  }

  return { ...onboarding, personal };
}
