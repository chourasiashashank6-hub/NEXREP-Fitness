import axios from "axios";
import { useState } from "react";
import { Keyboard } from "react-native";
import { upsertOnboardingMe } from "../api/onboarding";
import { updateProfile } from "../api/user";
import { calculateNutritionTargets } from "../engine/calculator";
import { useOnboardingContext } from "./OnboardingContext";
import { useAuthStore } from "../store/authStore";
import { saveOnboardingData, saveTargets } from "../storage/onboarding";
import { formatApiDetail, notifyUser } from "../utils/notify";
import { normalizeGoalFocusFields } from "../utils/onboardingFocusMuscles";
import { validateOnboardingForSave } from "../utils/onboardingValidation";
import i18n from "../i18n";
import { useLanguageStore } from "../i18n/languageStore";

export function useOnboardingSaveAndExit() {
  const { data } = useOnboardingContext();
  const token = useAuthStore((s) => s.token);
  const setNeedsOnboarding = useAuthStore((s) => s.setNeedsOnboarding);
  const language = useLanguageStore((s) => s.explicitLanguage || s.language || s.deviceLanguage);
  const syncExplicitLanguage = useLanguageStore((s) => s.syncExplicitLanguage);
  const [saving, setSaving] = useState(false);

  const saveAndExit = async () => {
    if (!token) {
      notifyUser(i18n.t("onboardingSave.session"), i18n.t("onboardingSave.signInAgain"));
      return;
    }

    const validationError = validateOnboardingForSave(data);
    if (validationError) {
      notifyUser(i18n.t("onboardingSave.completeRequired"), validationError);
      return;
    }

    Keyboard.dismiss();
    setSaving(true);
    try {
      const mapGoalTypeToTag = (goalType: typeof data.goal.type) => {
        if (goalType === "muscle_gain") return "Muscle Gain";
        if (goalType === "strength") return "Strength";
        return "Fat Loss";
      };
      const mapDifficultyToProfile = (difficulty: typeof data.goal.difficulty) => {
        if (difficulty === "advanced") return "Advanced";
        if (difficulty === "beginner") return "Beginner";
        return "Intermediate";
      };
      const onboardingPayload = {
        ...data,
        goal: normalizeGoalFocusFields(data.goal),
        app_setup: {
          ...data.app_setup,
          preferred_language: language,
        },
      };
      const targets = calculateNutritionTargets(onboardingPayload);
      try {
        await upsertOnboardingMe({ onboarding: onboardingPayload, targets });
      } catch (e: unknown) {
        if (!axios.isAxiosError(e)) throw e;
        const status = e.response?.status;
        const detailText = formatApiDetail(e.response?.data?.detail);
        const noResponse = e.response === undefined;
        const routeMissing = status === 404 && detailText === "Not Found";
        if (status === 401 || status === 403) {
          notifyUser(i18n.t("onboardingSave.sessionExpired"), detailText || i18n.t("onboardingSave.signInRetry"));
          return;
        }
        if (status === 422) {
          notifyUser(i18n.t("onboardingSave.saveFailed"), detailText || i18n.t("onboardingSave.serverRejected"));
          return;
        }
        if (!noResponse && !routeMissing && status !== 502 && status !== 503) {
          notifyUser(i18n.t("onboardingSave.saveFailed"), detailText || e.message || i18n.t("onboardingSave.serverError", { status: status ?? "?" }));
          return;
        }
      }

      const profileWeight = data.personal.unit_system === "metric"
        ? Number(data.personal.weight_kg || 0)
        : Number(data.personal.weight_lb || 0) / 2.20462;
      if (onboardingPayload.personal.name?.trim() && profileWeight > 0 && Number(onboardingPayload.personal.age || 0) > 0) {
        await updateProfile({
          name: onboardingPayload.personal.name.trim(),
          age: Number(onboardingPayload.personal.age),
          weight: Number(profileWeight.toFixed(1)),
          goals: mapGoalTypeToTag(onboardingPayload.goal.type),
          goalTag: mapGoalTypeToTag(onboardingPayload.goal.type),
          difficulty: mapDifficultyToProfile(onboardingPayload.goal.difficulty),
        });
      }

      await saveOnboardingData(token, onboardingPayload);
      await saveTargets(token, targets);
      void syncExplicitLanguage();
      setNeedsOnboarding(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      notifyUser(i18n.t("onboardingSave.saveFailed"), msg || i18n.t("onboardingSave.genericFailed"));
    } finally {
      setSaving(false);
    }
  };

  return { saving, saveAndExit };
}
