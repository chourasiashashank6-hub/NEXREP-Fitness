import { createContext, useContext } from "react";

export const EditOnboardingModalContext = createContext(false);

export function useIsEditOnboardingModal() {
  return useContext(EditOnboardingModalContext);
}
