import { useState } from "react";
import { DEFAULT_ONBOARDING_DATA } from "../constants/onboarding";
import { OnboardingData } from "../types/onboarding";

export const useOnboarding = () => {
  const [data, setData] = useState<OnboardingData>(DEFAULT_ONBOARDING_DATA);

  const updatePersonal = (updates: Partial<OnboardingData["personal"]>) => {
    setData((prev) => ({ ...prev, personal: { ...prev.personal, ...updates } }));
  };
  const updateGoal = (updates: Partial<OnboardingData["goal"]>) => {
    setData((prev) => ({ ...prev, goal: { ...prev.goal, ...updates } }));
  };
  const updateActivity = (updates: Partial<OnboardingData["activity"]>) => {
    setData((prev) => ({ ...prev, activity: { ...prev.activity, ...updates } }));
  };
  const updateDietary = (updates: Partial<OnboardingData["dietary"]>) => {
    setData((prev) => ({ ...prev, dietary: { ...prev.dietary, ...updates } }));
  };
  const updateAppSetup = (updates: Partial<OnboardingData["app_setup"]>) => {
    setData((prev) => ({ ...prev, app_setup: { ...prev.app_setup, ...updates } }));
  };

  const reset = () => setData(DEFAULT_ONBOARDING_DATA);
  const hydrate = (next: OnboardingData) => setData(next);

  return { data, updatePersonal, updateGoal, updateActivity, updateDietary, updateAppSetup, reset, hydrate };
};

export type UseOnboardingReturn = ReturnType<typeof useOnboarding>;
