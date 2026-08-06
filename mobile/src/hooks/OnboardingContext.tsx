import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { DEFAULT_ONBOARDING_DATA } from "../constants/onboarding";
import { UseOnboardingReturn, useOnboarding } from "./useOnboarding";
import { fetchOnboardingMeShared, type OnboardingMeResponse } from "../api/onboarding";
import { getProfile } from "../api/user";
import { getOnboardingData } from "../storage/onboarding";
import { useAuthStore } from "../store/authStore";
import { mergeOnboardingWithProfile } from "../utils/onboardingProfileMerge";
import { normalizeGoalFocusFields } from "../utils/onboardingFocusMuscles";
import type { OnboardingData } from "../types/onboarding";

function cloneOnboarding(data: OnboardingData): OnboardingData {
  return JSON.parse(JSON.stringify(data)) as OnboardingData;
}

export type OnboardingContextValue = UseOnboardingReturn & {
  /** True while onboarding data is being fetched and hydrated on mount/refresh. */
  isHydrating: boolean;
  /**
   * Re-fetches onboarding data (profile + /onboarding/me, with local-storage fallback),
   * hydrates the shared `data`/`targets` state, and returns the merged result. Screens that
   * need the raw onboarding+targets payload (e.g. HomeScreen) should call this instead of
   * calling `fetchOnboardingMe()` directly, so the fetch and its result are shared with every
   * other consumer of this context rather than duplicated.
   */
  refresh: () => Promise<OnboardingMeResponse | null>;
  /** Snapshot taken when onboarding data was last loaded — used for cancel/discard diffing. */
  getBaseline: () => OnboardingData;
  revertToBaseline: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export const OnboardingProvider = ({ children }: PropsWithChildren) => {
  const value = useOnboarding();
  const token = useAuthStore((s) => s.token);
  const returnToProfile = useAuthStore((s) => s.returnToProfileAfterOnboarding);
  const [isHydrating, setIsHydrating] = useState(false);
  const hydrateRef = useRef(value.hydrate);
  const resetRef = useRef(value.reset);
  const setTargetsRef = useRef(value.setTargets);
  const baselineRef = useRef<OnboardingData>(cloneOnboarding(DEFAULT_ONBOARDING_DATA));
  hydrateRef.current = value.hydrate;
  resetRef.current = value.reset;
  setTargetsRef.current = value.setTargets;

  const setBaseline = (data: OnboardingData) => {
    baselineRef.current = cloneOnboarding(data);
  };

  const getBaseline = useCallback(() => baselineRef.current, []);

  const revertToBaseline = useCallback(() => {
    hydrateRef.current(cloneOnboarding(baselineRef.current));
  }, []);

  const refresh = useCallback(async (): Promise<OnboardingMeResponse | null> => {
    const tokenAtStart = useAuthStore.getState().token;
    if (!tokenAtStart) {
      setIsHydrating(false);
      return null;
    }
    setIsHydrating(true);
    try {
    // Guards against applying a stale result if the session changes (login/logout) while
    // this fetch is still in flight — mirrors the old effect's `cancelled` flag.
    const stillCurrentSession = () => useAuthStore.getState().token === tokenAtStart;

    // Reuse the profile bootstrap() already fetched while validating the session, instead
    // of firing a second GET /profile for the same data right after app start.
    let profile: Awaited<ReturnType<typeof getProfile>> | null =
      useAuthStore.getState().consumeCachedProfile();
    if (!profile) {
      try {
        profile = await getProfile();
      } catch {
        profile = null;
      }
    }

    let remote: OnboardingMeResponse | null = null;
    let next: typeof DEFAULT_ONBOARDING_DATA | null = null;
    try {
      remote = await fetchOnboardingMeShared();
      if (remote?.onboarding) {
        next = remote.onboarding;
      }
    } catch {
      remote = null;
    }

    if (!next) {
      const local = await getOnboardingData(tokenAtStart);
      if (local) next = local;
    }

    if (!next && profile) {
      next = mergeOnboardingWithProfile(DEFAULT_ONBOARDING_DATA, profile);
    } else if (!next) {
      next = DEFAULT_ONBOARDING_DATA;
    } else {
      next = mergeOnboardingWithProfile(next, profile);
    }

    const normalized = { ...next, goal: normalizeGoalFocusFields(next.goal) };
    if (stillCurrentSession()) {
      hydrateRef.current(normalized);
      setBaseline(normalized);
      setTargetsRef.current(remote?.targets ?? null);
      if (profile) useAuthStore.getState().setPlanId(String(profile.plan_id || "free"));
    }

    return { onboarding: normalized, targets: remote?.targets ?? null };
    } finally {
      setIsHydrating(false);
    }
  }, []);

  useEffect(() => {
    resetRef.current();
    setBaseline(DEFAULT_ONBOARDING_DATA);
    if (token) {
      setIsHydrating(true);
      void refresh();
    } else {
      setIsHydrating(false);
    }
  }, [token, returnToProfile, refresh]);

  return (
    <OnboardingContext.Provider value={{ ...value, isHydrating, refresh, getBaseline, revertToBaseline }}>
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboardingContext = () => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboardingContext must be used inside OnboardingProvider");
  return ctx;
};
