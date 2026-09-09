import { CommonActions } from "@react-navigation/native";
import { useAuthStore } from "../store/authStore";
import { navigationRef } from "../navigation/navigationRef";

/** Dismiss the edit-onboarding modal and return to Main tabs. */
export function dismissEditOnboardingModal() {
  if (!navigationRef.isReady()) return;

  const state = navigationRef.getRootState();
  const modalOpen = state.routes.some((route) => route.name === "EditOnboardingModal");

  if (modalOpen) {
    // Root goBack() pops the nested onboarding step stack first (Screen 3 → Screen 2).
    // Navigate to Main to dismiss the entire modal in one step.
    navigationRef.dispatch(CommonActions.navigate({ name: "Main" }));
    return;
  }

  if (navigationRef.canGoBack()) {
    navigationRef.goBack();
  }
}

/** Leave onboarding without decrementing the inner step stack. */
export function exitOnboardingFlow(isEditModal: boolean) {
  if (isEditModal) {
    dismissEditOnboardingModal();
    return;
  }
  useAuthStore.getState().setNeedsOnboarding(false);
  useAuthStore.getState().setReturnToProfileAfterOnboarding(false);
}
