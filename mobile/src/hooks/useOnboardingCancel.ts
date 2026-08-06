import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnboardingContext } from "./OnboardingContext";
import { useAuthStore } from "../store/authStore";
import { listOnboardingFormChanges } from "../utils/onboardingFormDiff";

export function useOnboardingCancel() {
  const { t } = useTranslation();
  const { data, getBaseline, revertToBaseline } = useOnboardingContext();
  const setNeedsOnboarding = useAuthStore((s) => s.setNeedsOnboarding);
  const setReturnToProfileAfterOnboarding = useAuthStore((s) => s.setReturnToProfileAfterOnboarding);
  const [visible, setVisible] = useState(false);

  const changes = useMemo(
    () => listOnboardingFormChanges(getBaseline(), data, t),
    [data, getBaseline, t, visible],
  );

  const exitOnboarding = useCallback(() => {
    setNeedsOnboarding(false);
    setReturnToProfileAfterOnboarding(false);
  }, [setNeedsOnboarding, setReturnToProfileAfterOnboarding]);

  const requestCancel = useCallback(() => {
    const pending = listOnboardingFormChanges(getBaseline(), data, t);
    if (pending.length === 0) {
      exitOnboarding();
      return;
    }
    setVisible(true);
  }, [data, exitOnboarding, getBaseline, t]);

  const discardAndExit = useCallback(() => {
    revertToBaseline();
    setVisible(false);
    exitOnboarding();
  }, [exitOnboarding, revertToBaseline]);

  const keepEditing = useCallback(() => setVisible(false), []);

  return {
    requestCancel,
    discardAndExit,
    keepEditing,
    modalVisible: visible,
    changes,
  };
}
