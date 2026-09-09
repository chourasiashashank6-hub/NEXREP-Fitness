import type { GoalPace, GoalType, OnboardingData } from "../../types/onboarding";
import { calculateNutritionTargets } from "../../engine/calculator";
import { getCurrentWeightKg } from "./units";

const FAT_LOSS_PACE_KG: Record<GoalPace, number> = {
  slow: 0.25,
  moderate: 0.5,
  aggressive: 0.75,
};

const MUSCLE_GAIN_PACE_KG: Record<GoalPace, number> = {
  slow: 0.14,
  moderate: 0.25,
  aggressive: 0.5,
};

export function paceKgPerWeek(goal: GoalType | null, pace: GoalPace | null): number | null {
  if (!goal || !pace) return null;
  if (goal === "fat_loss") return FAT_LOSS_PACE_KG[pace];
  if (goal === "muscle_gain") return MUSCLE_GAIN_PACE_KG[pace];
  return null;
}

export function maxFatLossPaceKg(currentKg: number): number {
  return Math.min(1.0, Math.round(currentKg * 0.01 * 100) / 100);
}

export type PaceOptionState = {
  pace: GoalPace;
  disabled: boolean;
  code?: string;
  params?: Record<string, string | number>;
};

export function getPaceOptionStates(data: OnboardingData): PaceOptionState[] {
  const goal = data.goal.type;
  const currentKg = getCurrentWeightKg(data);
  const paces: GoalPace[] = ["slow", "moderate", "aggressive"];

  if (goal !== "fat_loss" && goal !== "muscle_gain") {
    return paces.map((pace) => ({ pace, disabled: true, code: "pace.notApplicable" }));
  }

  return paces.map((pace) => {
    const kg = paceKgPerWeek(goal, pace);
    if (kg == null) return { pace, disabled: true, code: "pace.notApplicable" };

    if (goal === "muscle_gain") {
      if (kg < 0.1 || kg > 0.5) {
        return { pace, disabled: true, code: "pace.outOfRangeMuscleGain", params: { kg } };
      }
      return { pace, disabled: false };
    }

    if (currentKg == null || currentKg <= 0) {
      return { pace, disabled: false };
    }

    const cap = maxFatLossPaceKg(currentKg);
    if (kg > cap + 0.001) {
      return {
        pace,
        disabled: true,
        code: "pace.exceedsBodyweightCap",
        params: { cap, current: currentKg },
      };
    }
    if (kg < 0.25) {
      return { pace, disabled: true, code: "pace.belowMinFatLoss" };
    }
    return { pace, disabled: false };
  });
}

export function isPaceAllowed(data: OnboardingData, pace: GoalPace): boolean {
  const state = getPaceOptionStates(data).find((s) => s.pace === pace);
  return Boolean(state && !state.disabled);
}

export type PaceClampInfo = {
  clamped: boolean;
  fastestSafePace: GoalPace | null;
  floorKcal: number;
  rawTargetKcal: number;
};

export function getPaceClampInfo(data: OnboardingData): PaceClampInfo | null {
  if (data.goal.type !== "fat_loss" && data.goal.type !== "muscle_gain") return null;
  if (!data.goal.pace) return null;
  try {
    const targets = calculateNutritionTargets(data);
    const states = getPaceOptionStates(data).filter((s) => !s.disabled);
    const fastest = states.length ? states[states.length - 1].pace : null;
    return {
      clamped: targets.safety.was_clamped,
      fastestSafePace: fastest,
      floorKcal: targets.safety.floor_kcal,
      rawTargetKcal: targets.target_kcal,
    };
  } catch {
    return null;
  }
}
