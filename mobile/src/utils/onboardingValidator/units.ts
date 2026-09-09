import type { OnboardingData } from "../../types/onboarding";

export const WEIGHT_TOLERANCE_KG = 0.1;
export const HEIGHT_TOLERANCE_CM = 0.5;
export const MIN_GAP_KG = 1.0;
export const MAINTAIN_MAX_GAP_KG = 2.0;
export const MIN_AGE = 18;

export function getHeightCm(data: OnboardingData): number | null {
  const { personal } = data;
  if (personal.unit_system === "metric") {
    return personal.height_cm ?? null;
  }
  if (personal.height_in == null) return null;
  return personal.height_in * 2.54;
}

export function getCurrentWeightKg(data: OnboardingData): number | null {
  const { personal } = data;
  if (personal.unit_system === "metric") {
    return personal.weight_kg ?? null;
  }
  if (personal.weight_lb == null) return null;
  return personal.weight_lb * 0.45359237;
}

export function getTargetWeightKg(data: OnboardingData): number | null {
  const { goal, personal } = data;
  if (personal.unit_system === "metric") {
    return goal.target_weight_kg ?? null;
  }
  if (goal.target_weight_lb == null) return null;
  return goal.target_weight_lb * 0.45359237;
}

export function weightsEqualKg(a: number, b: number): boolean {
  return Math.abs(a - b) < WEIGHT_TOLERANCE_KG;
}

export function bmiKgCm(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function minTargetWeightKg(heightCm: number): number {
  const m = heightCm / 100;
  return Math.round(m * m * 18.5 * 10) / 10;
}

export function bmi35WeightKg(heightCm: number): number {
  const m = heightCm / 100;
  return Math.round(m * m * 35 * 10) / 10;
}

export function formatWeightForUnit(kg: number, unit: "metric" | "imperial"): number {
  if (unit === "metric") return Math.round(kg * 10) / 10;
  return Math.round(kg / 0.45359237);
}
