import { useAuthStore } from "../store/authStore";
import { navigationRef } from "../navigation/navigationRef";

/** Pop the edit-onboarding transparent modal without remounting Main tabs. */
export function dismissEditOnboardingModal() {
  if (!navigationRef.isReady()) return;
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
