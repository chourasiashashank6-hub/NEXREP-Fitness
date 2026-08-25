import type { TFunction } from "i18next";

/** Render engine v3 i18n split keys or legacy English split names. */
export function formatWorkoutSplitName(splitName: string, t: TFunction): string {
  const trimmed = (splitName || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("coach.workout.split.")) {
    const translated = t(trimmed);
    return translated === trimmed ? trimmed.replace("coach.workout.split.", "").replace(/_/g, " ") : translated;
  }
  return trimmed;
}

export function formatSuggestedWeightRange(
  ex: {
    weight_kg?: number | null;
    weight_kg_low?: number | null;
    weight_kg_high?: number | null;
  },
  t: TFunction,
): string | null {
  const low = ex.weight_kg_low;
  const high = ex.weight_kg_high;
  if (low != null && high != null && low > 0 && high > 0) {
    return t("coach.workoutPlannerScreen.suggestedWeightRange", { low, high });
  }
  if (ex.weight_kg != null && ex.weight_kg > 0) {
    return t("coach.workoutPlannerScreen.suggestedWeightSingle", { weight: ex.weight_kg });
  }
  return null;
}
