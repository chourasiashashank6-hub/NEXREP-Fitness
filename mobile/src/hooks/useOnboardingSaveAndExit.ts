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
import { validateOnboardingForSave } from "../utils/onboardingValidation";

export function useOnboardingSaveAndExit() {
  const { data } = useOnboardingContext();
  const token = useAuthStore((s) => s.token);
  const setNeedsOnboarding = useAuthStore((s) => s.setNeedsOnboarding);
  const [saving, setSaving] = useState(false);

  const saveAndExit = async () => {
    if (!token) {
      notifyUser("Session", "Sign in again to save your onboarding.");
      return;
    }

    const validationError = validateOnboardingForSave(data);
    if (validationError) {
      notifyUser("Complete required fields", validationError);
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
      const targets = calculateNutritionTargets(data);
      try {
        await upsertOnboardingMe({ onboarding: data, targets });
      } catch (e: unknown) {
        if (!axios.isAxiosError(e)) throw e;
        const status = e.response?.status;
        const detailText = formatApiDetail(e.response?.data?.detail);
        const noResponse = e.response === undefined;
        const routeMissing = status === 404 && detailText === "Not Found";
        if (status === 401 || status === 403) {
          notifyUser("Session expired", detailText || "Sign in again, then retry.");
          return;
        }
        if (status === 422) {
          notifyUser("Could not save onboarding", detailText || "The server rejected this data. Check all screens and try again.");
          return;
        }
        if (!noResponse && !routeMissing && status !== 502 && status !== 503) {
          notifyUser("Could not save onboarding", detailText || e.message || `Server error (${status ?? "?"}).`);
          return;
        }
      }

      const profileWeight = data.personal.unit_system === "metric"
        ? Number(data.personal.weight_kg || 0)
        : Number(data.personal.weight_lb || 0) / 2.20462;
      if (data.personal.name?.trim() && profileWeight > 0 && Number(data.personal.age || 0) > 0) {
        await updateProfile({
          name: data.personal.name.trim(),
          age: Number(data.personal.age),
          weight: Number(profileWeight.toFixed(1)),
          goals: mapGoalTypeToTag(data.goal.type),
          goalTag: mapGoalTypeToTag(data.goal.type),
          difficulty: mapDifficultyToProfile(data.goal.difficulty),
        });
      }

      await saveOnboardingData(token, data);
      await saveTargets(token, targets);
      setNeedsOnboarding(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      notifyUser("Could not save onboarding", msg || "Something went wrong while saving. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return { saving, saveAndExit };
}
