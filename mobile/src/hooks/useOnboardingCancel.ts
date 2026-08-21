import { useCallback, useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { useOnboardingContext } from "./OnboardingContext";
import { useAuthStore } from "../store/authStore";
import { EditOnboardingModalContext } from "./useEditOnboardingModal";
import { listOnboardingFormChanges } from "../utils/onboardingFormDiff";

export function useOnboardingCancel() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isEditModal = useContext(EditOnboardingModalContext);
  const { data, getBaseline, revertToBaseline } = useOnboardingContext();
  const setNeedsOnboarding = useAuthStore((s) => s.setNeedsOnboarding);
  const setReturnToProfileAfterOnboarding = useAuthStore((s) => s.setReturnToProfileAfterOnboarding);
  const [visible, setVisible] = useState(false);

  const changes = useMemo(
    () => listOnboardingFormChanges(getBaseline(), data, t),
    [data, getBaseline, t, visible],
  );

  const exitOnboarding = useCallback(() => {
    if (isEditModal) {
      navigation.goBack();
      return;
    }
    setNeedsOnboarding(false);
    setReturnToProfileAfterOnboarding(false);
  }, [isEditModal, navigation, setNeedsOnboarding, setReturnToProfileAfterOnboarding]);

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
