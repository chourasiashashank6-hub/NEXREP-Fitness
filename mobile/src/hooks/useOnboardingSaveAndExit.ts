import axios from "axios";
import { useContext, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { upsertOnboardingMe } from "../api/onboarding";
import { updateProfile } from "../api/user";
import { calculateNutritionTargets } from "../engine/calculator";
import { useOnboardingContext } from "./OnboardingContext";
import { useAuthStore } from "../store/authStore";
import { saveOnboardingData, saveTargets } from "../storage/onboarding";
import { formatApiDetail, notifyUser } from "../utils/notify";
import { normalizeGoalFocusFields } from "../utils/onboardingFocusMuscles";
import { validateOnboardingForSave, validateOnboardingPartialSave } from "../utils/onboardingValidation";
import { exitOnboardingFlow } from "../utils/exitOnboardingFlow";
import { listOnboardingFormChanges } from "../utils/onboardingFormDiff";
import { toUserMessage } from "../utils/toUserMessage";
import {
  ONBOARDING_SERVER_UNAVAILABLE_NOTIFY,
  classifyUpsertOnboardingError,
  onboardingServerUnavailableNotification,
} from "./onboardingSaveUpsertError";
import i18n from "../i18n";
import { useLanguageStore } from "../i18n/languageStore";
import { EditOnboardingModalContext } from "./useEditOnboardingModal";

export type SaveAndExitResult = {
  ok: boolean;
  serverSaved: boolean;
};

export type SaveAndExitOptions = {
  /** Validate screens 1…N only (progressive save). Omit for full completion (screen 6). */
  throughStep?: number;
  /** True on final step — stay in flow for Results instead of exiting immediately. */
  completeFlow?: boolean;
};

export function useOnboardingSaveAndExit() {
  const { data, getBaseline } = useOnboardingContext();
  const isEditModal = useContext(EditOnboardingModalContext);
  const token = useAuthStore((s) => s.token);
  const language = useLanguageStore((s) => s.explicitLanguage || s.language || s.deviceLanguage);
  const syncExplicitLanguage = useLanguageStore((s) => s.syncExplicitLanguage);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const saveAndExit = async (options?: SaveAndExitOptions): Promise<SaveAndExitResult> => {
    if (inFlightRef.current) {
      return { ok: false, serverSaved: false };
    }

    if (!token) {
      const msg = i18n.t("onboardingSave.signInAgain");
      setSaveError(msg);
      notifyUser(i18n.t("onboardingSave.session"), msg);
      return { ok: false, serverSaved: false };
    }

    const validationError =
      options?.throughStep != null
        ? validateOnboardingPartialSave(data, options.throughStep)
        : validateOnboardingForSave(data);
    if (validationError) {
      setSaveError(validationError);
      notifyUser(i18n.t("onboardingSave.completeRequired"), validationError);
      return { ok: false, serverSaved: false };
    }

    if (isEditModal && listOnboardingFormChanges(getBaseline(), data, i18n.t).length === 0) {
      exitOnboardingFlow(true);
      return { ok: true, serverSaved: true };
    }

    Keyboard.dismiss();
    setSaveError(null);
    inFlightRef.current = true;
    setSaving(true);
    let serverSaved = true;
    try {
      const mapGoalTypeToTag = (goalType: typeof data.goal.type) => {
        if (goalType === "muscle_gain") return "Muscle Gain";
        if (goalType === "strength") return "Strength";
        if (goalType === "maintain") return "Maintain";
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
        const action = classifyUpsertOnboardingError(e);
        if (action.type === "rethrow") throw e;
        if (action.type === "abort") {
          const detailText = axios.isAxiosError(e) ? formatApiDetail(e.response?.data?.detail) : "";
          const msg = detailText || i18n.t("onboardingSave.signInRetry");
          setSaveError(msg);
          notifyUser(i18n.t("onboardingSave.sessionExpired"), msg);
          return { ok: false, serverSaved: false };
        }
        if (action.type === "fatal_abort") {
          const detailText = axios.isAxiosError(e) ? formatApiDetail(e.response?.data?.detail) : "";
          const status = axios.isAxiosError(e) ? e.response?.status : undefined;
          const msg =
            detailText ||
            (axios.isAxiosError(e) ? e.message : "") ||
            i18n.t("onboardingSave.serverError", { status: status ?? "?" });
          setSaveError(status === 422 ? detailText || i18n.t("onboardingSave.serverRejected") : msg);
          notifyUser(
            i18n.t("onboardingSave.saveFailed"),
            status === 422 ? detailText || i18n.t("onboardingSave.serverRejected") : msg,
          );
          return { ok: false, serverSaved: false };
        }
        serverSaved = false;
        const warning = onboardingServerUnavailableNotification(e);
        if (warning) {
          notifyUser(i18n.t(warning.titleKey), i18n.t(warning.bodyKey));
        }
      }

      const profileWeight = data.personal.unit_system === "metric"
        ? Number(data.personal.weight_kg || 0)
        : Number(data.personal.weight_lb || 0) / 2.20462;
      if (onboardingPayload.personal.name?.trim() && profileWeight > 0 && Number(onboardingPayload.personal.age || 0) > 0) {
        try {
          await updateProfile({
            name: onboardingPayload.personal.name.trim(),
            age: Number(onboardingPayload.personal.age),
            weight: Number(profileWeight.toFixed(1)),
            goals: mapGoalTypeToTag(onboardingPayload.goal.type),
            goalTag: mapGoalTypeToTag(onboardingPayload.goal.type),
            difficulty: mapDifficultyToProfile(onboardingPayload.goal.difficulty),
          });
        } catch {
          if (serverSaved) {
            serverSaved = false;
            notifyUser(
              i18n.t(ONBOARDING_SERVER_UNAVAILABLE_NOTIFY.titleKey),
              i18n.t(ONBOARDING_SERVER_UNAVAILABLE_NOTIFY.bodyKey),
            );
          }
        }
      }

      await saveOnboardingData(token, onboardingPayload);
      await saveTargets(token, targets);
      void syncExplicitLanguage();
      if (!options?.completeFlow) {
        exitOnboardingFlow(isEditModal);
      }
      return { ok: true, serverSaved };
    } catch (e: unknown) {
      const { body } = toUserMessage(e, "onboardingSave.genericFailed");
      setSaveError(body);
      notifyUser(i18n.t("onboardingSave.saveFailed"), body);
      return { ok: false, serverSaved: false };
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  const clearSaveError = () => setSaveError(null);

  return { saving, saveError, clearSaveError, saveAndExit };
}
