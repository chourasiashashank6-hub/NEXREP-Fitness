import { PropsWithChildren, createContext, useContext, useEffect, useRef } from "react";
import { DEFAULT_ONBOARDING_DATA } from "../constants/onboarding";
import { UseOnboardingReturn, useOnboarding } from "./useOnboarding";
import { fetchOnboardingMe } from "../api/onboarding";
import { getProfile } from "../api/user";
import { getOnboardingData } from "../storage/onboarding";
import { useAuthStore } from "../store/authStore";
import { mergeOnboardingWithProfile } from "../utils/onboardingProfileMerge";
import { normalizeGoalFocusFields } from "../utils/onboardingFocusMuscles";

const OnboardingContext = createContext<UseOnboardingReturn | null>(null);

export const OnboardingProvider = ({ children }: PropsWithChildren) => {
  const value = useOnboarding();
  const token = useAuthStore((s) => s.token);
  const returnToProfile = useAuthStore((s) => s.returnToProfileAfterOnboarding);
  const hydrateRef = useRef(value.hydrate);
  const resetRef = useRef(value.reset);
  hydrateRef.current = value.hydrate;
  resetRef.current = value.reset;

  useEffect(() => {
    let cancelled = false;
    resetRef.current();

    (async () => {
      if (!token || cancelled) return;

      let profile: Awaited<ReturnType<typeof getProfile>> | null = null;
      try {
        profile = await getProfile();
      } catch {
        profile = null;
      }
      if (cancelled) return;

      let next: typeof DEFAULT_ONBOARDING_DATA | null = null;

      try {
        const remote = await fetchOnboardingMe();
        if (cancelled) return;
        if (remote?.onboarding) {
          next = remote.onboarding;
        }
      } catch {
        if (cancelled) return;
      }

      if (!next) {
        const local = await getOnboardingData(token);
        if (cancelled) return;
        if (local) next = local;
      }

      if (!next && profile) {
        next = mergeOnboardingWithProfile(DEFAULT_ONBOARDING_DATA, profile);
      } else if (!next) {
        next = DEFAULT_ONBOARDING_DATA;
      } else {
        next = mergeOnboardingWithProfile(next, profile);
      }

      if (cancelled) return;
      hydrateRef.current({
        ...next,
        goal: normalizeGoalFocusFields(next.goal),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [token, returnToProfile]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
};

export const useOnboardingContext = () => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboardingContext must be used inside OnboardingProvider");
  return ctx;
};
