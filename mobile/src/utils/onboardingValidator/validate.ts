import type { OnboardingData } from "../../types/onboarding";
import {
  validateAge,
  validateCurrentWeight,
  validateDifficulty,
  validateDietType,
  validateGoalPace,
  validateGoalType,
  validateHeight,
  validateName,
  validateSex,
  validateTargetWeight,
  validateWorkoutsPerWeek,
} from "./rules";
import { isIssue, type ValidationIssue } from "./types";

function collect(results: ReturnType<typeof validateName>[]): ValidationIssue[] {
  return results.filter(isIssue);
}

export function validateScreen1(data: OnboardingData): ValidationIssue[] {
  return collect([
    validateName(data.personal.name),
    validateAge(data.personal.age),
    validateSex(data.personal.sex),
    validateHeight(data),
    validateCurrentWeight(data),
  ]);
}

export function validateScreen2(data: OnboardingData): ValidationIssue[] {
  const issues = collect([
    validateGoalType(data.goal.type),
    validateDifficulty(data),
    validateTargetWeight(data),
    validateGoalPace(data),
  ]);
  if (data.goal.type === "strength") {
    const lifts = data.goal.target_lifts ?? [];
    if (lifts.some((l) => !l.target_weight_kg || l.target_weight_kg <= 0)) {
      issues.push({ valid: false, field: "target_lifts", code: "targetLifts.required" });
    }
  }
  return issues;
}

export function validateScreen3(data: OnboardingData): ValidationIssue[] {
  return collect([validateWorkoutsPerWeek(data)]);
}

export function validateScreen4(data: OnboardingData): ValidationIssue[] {
  return collect([validateDietType(data.dietary.diet_type)]);
}

const SCREEN_VALIDATORS = [
  validateScreen1,
  validateScreen2,
  validateScreen3,
  validateScreen4,
] as const;

/** Validate only screens the user has reached (1–4). Screens 5–6 have no required fields. */
export function validateOnboardingPartialSave(data: OnboardingData, throughStep: number): ValidationIssue[] {
  const capped = Math.max(1, Math.min(throughStep, SCREEN_VALIDATORS.length));
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < capped; i++) {
    issues.push(...SCREEN_VALIDATORS[i](data));
  }
  return issues;
}

export function validateOnboardingForSave(data: OnboardingData): ValidationIssue[] {
  return validateOnboardingPartialSave(data, SCREEN_VALIDATORS.length);
}
