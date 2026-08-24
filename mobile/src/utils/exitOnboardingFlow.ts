import { CommonActions } from "@react-navigation/native";
import { useAuthStore } from "../store/authStore";
import { navigationRef } from "../navigation/navigationRef";

/**
 * Edit onboarding is a transparentModal route on the root stack with its own
 * inner step stack. goBack() pops one inner step when not on Screen 1 — use an
 * explicit root navigation to dismiss the whole modal in one shot.
 */
export function dismissEditOnboardingModal() {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: "Main",
      params: { screen: "Profile" },
    }),
  );
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
