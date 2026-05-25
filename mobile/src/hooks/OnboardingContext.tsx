import { PropsWithChildren, createContext, useContext, useEffect, useRef } from "react";
import { UseOnboardingReturn, useOnboarding } from "./useOnboarding";
import { useAuthStore } from "../store/authStore";
import { fetchOnboardingMe } from "../api/onboarding";
import { getOnboardingData } from "../storage/onboarding";

const OnboardingContext = createContext<UseOnboardingReturn | null>(null);

export const OnboardingProvider = ({ children }: PropsWithChildren) => {
  const value = useOnboarding();
  const token = useAuthStore((s) => s.token);
  const hydrateRef = useRef(value.hydrate);
  hydrateRef.current = value.hydrate;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) return;
      try {
        const remote = await fetchOnboardingMe();
        if (cancelled) return;
        if (remote?.onboarding) {
          hydrateRef.current(remote.onboarding);
          return;
        }
      } catch {
        if (cancelled) return;
      }
      const local = await getOnboardingData(token);
      if (!cancelled && local) hydrateRef.current(local);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
};

export const useOnboardingContext = () => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboardingContext must be used inside OnboardingProvider");
  return ctx;
};
