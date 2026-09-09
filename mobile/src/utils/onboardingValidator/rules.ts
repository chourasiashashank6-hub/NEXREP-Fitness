import type { GoalType, OnboardingData } from "../../types/onboarding";
import { isPaceAllowed } from "./pace";
import { issue, ok, type ValidationResult } from "./types";
import {
  MAINTAIN_MAX_GAP_KG,
  MIN_AGE,
  MIN_GAP_KG,
  bmi35WeightKg,
  bmiKgCm,
  getCurrentWeightKg,
  getHeightCm,
  getTargetWeightKg,
  minTargetWeightKg,
  weightsEqualKg,
} from "./units";
import { workoutsMinForGoal, workoutsWarnAbove } from "./workouts";

const NAME_MIN = 2;
const NAME_MAX = 50;

export function validateName(name: string): ValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return issue("name", "name.required");
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    return issue("name", "name.length", { min: NAME_MIN, max: NAME_MAX });
  }
  if (!/[\p{L}]/u.test(trimmed)) return issue("name", "name.letterRequired");
  if (/^[\p{N}\s]+$/u.test(trimmed)) return issue("name", "name.digitsOnly");
  return ok();
}

export function validateAge(age: number | null): ValidationResult {
  if (age == null || age < MIN_AGE) return issue("age", "age.min", { min: MIN_AGE });
  return ok();
}

export function validateSex(sex: string | null): ValidationResult {
  if (!sex) return issue("sex", "sex.required");
  return ok();
}

export function validateHeight(data: OnboardingData): ValidationResult {
  const { personal } = data;
  if (personal.unit_system === "metric") {
    const h = personal.height_cm;
    if (!h || h < 100 || h > 250) return issue("height", "height.rangeCm", { min: 100, max: 250 });
    return ok();
  }
  const h = personal.height_in;
  if (!h || h < 39 || h > 98) return issue("height", "height.rangeIn", { min: 39, max: 98 });
  return ok();
}

export function validateCurrentWeight(data: OnboardingData): ValidationResult {
  const kg = getCurrentWeightKg(data);
  if (kg == null || kg < 30 || kg > 300) return issue("weight", "weight.rangeKg", { min: 30, max: 300 });
  return ok();
}

export function isTargetWeightRequired(goal: GoalType | null): boolean {
  return goal === "fat_loss" || goal === "muscle_gain";
}

export function targetWeightLabelCode(goal: GoalType | null): string | null {
  if (goal === "fat_loss") return "target.labelLess";
  if (goal === "muscle_gain") return "target.labelMore";
  return null;
}

export function validateTargetWeight(data: OnboardingData): ValidationResult {
  const goal = data.goal.type;
  const currentKg = getCurrentWeightKg(data);
  const targetKg = getTargetWeightKg(data);
  const heightCm = getHeightCm(data);
  const unit = data.personal.unit_system;

  if (goal === "maintain") {
    if (targetKg == null) return ok();
    if (currentKg != null && Math.abs(targetKg - currentKg) > MAINTAIN_MAX_GAP_KG) {
      return issue("target", "target.maintainGap", { maxGap: MAINTAIN_MAX_GAP_KG });
    }
    return ok();
  }

  if (goal === "strength") return ok();

  if (!isTargetWeightRequired(goal)) return ok();

  if (targetKg == null || targetKg <= 0) return issue("target", "target.required");

  if (currentKg == null) return ok();

  const gap = targetKg - currentKg;

  if (goal === "fat_loss") {
    if (targetKg >= currentKg - WEIGHT_TOLERANCE) {
      return issue("target", "target.fatLossAboveCurrent");
    }
    if (Math.abs(gap) < MIN_GAP_KG) {
      return issue("target", "target.gapTooSmall", { minGap: MIN_GAP_KG });
    }
  }

  if (goal === "muscle_gain") {
    if (targetKg <= currentKg + WEIGHT_TOLERANCE) {
      return issue("target", "target.muscleGainBelowCurrent");
    }
    if (Math.abs(gap) < MIN_GAP_KG) {
      return issue("target", "target.gapTooSmall", { minGap: MIN_GAP_KG });
    }
  }

  if (heightCm != null && heightCm > 0) {
    const floorKg = minTargetWeightKg(heightCm);
    if (targetKg < floorKg - WEIGHT_TOLERANCE) {
      return issue("target", "target.bmiFloor", { floorKg, unit });
    }
  }

  return ok();
}

const WEIGHT_TOLERANCE = 0.1;

export function validateTargetWeightBmiWarning(data: OnboardingData): ValidationResult {
  const targetKg = getTargetWeightKg(data);
  const heightCm = getHeightCm(data);
  if (targetKg == null || heightCm == null) return ok();
  const warnKg = bmi35WeightKg(heightCm);
  if (targetKg > warnKg + WEIGHT_TOLERANCE) {
    return issue("target", "target.bmiHighWarn", { bmi: Math.round(bmiKgCm(targetKg, heightCm) * 10) / 10 });
  }
  return ok();
}

export function validateGoalPace(data: OnboardingData): ValidationResult {
  const goal = data.goal.type;
  if (goal === "strength" || goal === "maintain") return ok();
  if (goal !== "fat_loss" && goal !== "muscle_gain") return ok();
  if (!data.goal.pace) return issue("pace", "pace.required");
  if (!isPaceAllowed(data, data.goal.pace)) {
    return issue("pace", "pace.notAllowed");
  }
  return ok();
}

export function validateDifficulty(data: OnboardingData): ValidationResult {
  if (!data.goal.difficulty) return issue("difficulty", "difficulty.required");
  const workouts = data.activity.workouts_per_week ?? 0;
  if (data.goal.difficulty === "advanced" && workouts > 0 && workouts <= 2) {
    return issue("difficulty", "difficulty.advancedLowWorkouts");
  }
  return ok();
}

export function validateWorkoutsPerWeek(data: OnboardingData): ValidationResult {
  const n = data.activity.workouts_per_week;
  const min = workoutsMinForGoal(data.goal.type);
  if (n == null || n < min) {
    return issue("workouts", "workouts.belowMin", { min, goal: data.goal.type ?? "" });
  }
  return ok();
}

export function validateWorkoutsRecoveryWarning(data: OnboardingData): ValidationResult {
  const n = data.activity.workouts_per_week ?? 0;
  const warn = workoutsWarnAbove(data.goal.type);
  if (warn != null && n > warn) {
    return issue("workouts", "workouts.recoveryWarn", { count: n });
  }
  return ok();
}

export function validateEquipmentStrengthWarning(data: OnboardingData): ValidationResult {
  if (data.goal.type === "strength" && data.activity.equipment_access === "bodyweight_only") {
    return issue("equipment", "equipment.strengthBodyweightWarn");
  }
  return ok();
}

export function validateMuscleFocusCount(data: OnboardingData): ValidationResult {
  const muscles = data.goal.focus_muscles ?? [];
  if (muscles.length > 3) return issue("muscle_focus", "muscleFocus.max", { max: 3 });
  return ok();
}

export function validateMuscleFocusLowWorkoutsWarning(data: OnboardingData): ValidationResult {
  const muscles = data.goal.focus_muscles ?? [];
  const workouts = data.activity.workouts_per_week ?? 0;
  if (workouts <= 2 && muscles.length >= 2) {
    return issue("muscle_focus", "muscleFocus.lowWorkoutsWarn");
  }
  return ok();
}

export function validateProblemAreasCount(areas: string[]): ValidationResult {
  if (areas.length > 4) return issue("problem_areas", "problemAreas.max", { max: 4 });
  return ok();
}

export function validateDietType(dietType: string): ValidationResult {
  if (!String(dietType || "").trim()) return issue("diet_type", "dietType.required");
  return ok();
}

export function validateGoalType(goal: GoalType | null): ValidationResult {
  if (!goal) return issue("goal", "goal.required");
  return ok();
}
