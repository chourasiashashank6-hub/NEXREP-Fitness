import type { TFunction } from "i18next";
import i18n from "../i18n";

export const WORKOUT_SPLIT_I18N_PREFIX = "coach.workout.split.";

/** Every split_key emitted by workout engine v3 (`split_display_name`). */
export const ENGINE_SPLIT_KEYS = [
  "rest",
  "push",
  "push_a",
  "push_b",
  "pull",
  "pull_a",
  "pull_b",
  "legs",
  "legs_a",
  "legs_b",
  "upper",
  "upper_a",
  "upper_b",
  "lower",
  "lower_a",
  "lower_b",
  "full_body",
  "full_body_a",
  "full_body_b",
  "full_body_c",
] as const;

export type EngineSplitKey = (typeof ENGINE_SPLIT_KEYS)[number];

function titleCaseWords(text: string): string {
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Normalize engine i18n keys, bare split keys, or legacy English labels to a split key. */
export function workoutSplitKeyFromName(splitName: string): EngineSplitKey | null {
  const trimmed = (splitName || "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(WORKOUT_SPLIT_I18N_PREFIX)) {
    const key = trimmed.slice(WORKOUT_SPLIT_I18N_PREFIX.length);
    return (ENGINE_SPLIT_KEYS as readonly string[]).includes(key) ? (key as EngineSplitKey) : null;
  }

  const normalized = trimmed.toLowerCase().replace(/[\s.-]+/g, "_");
  if ((ENGINE_SPLIT_KEYS as readonly string[]).includes(normalized)) {
    return normalized as EngineSplitKey;
  }

  if (normalized.includes("full_body") || normalized.includes("fullbody")) return "full_body";
  if (normalized.includes("push")) return normalized.includes("_b") ? "push_b" : normalized.includes("_a") ? "push_a" : "push";
  if (normalized.includes("pull")) return normalized.includes("_b") ? "pull_b" : normalized.includes("_a") ? "pull_a" : "pull";
  if (normalized.includes("leg")) return normalized.includes("_b") ? "legs_b" : normalized.includes("_a") ? "legs_a" : "legs";
  if (normalized.includes("upper")) return normalized.includes("_b") ? "upper_b" : normalized.includes("_a") ? "upper_a" : "upper";
  if (normalized.includes("lower")) return normalized.includes("_b") ? "lower_b" : normalized.includes("_a") ? "lower_a" : "lower";
  if (normalized.includes("rest")) return "rest";

  return null;
}

/** Render engine v3 i18n split keys or legacy English split names. */
export function formatWorkoutSplitName(splitName: string, t: TFunction = i18n.t.bind(i18n)): string {
  const trimmed = (splitName || "").trim();
  if (!trimmed) return "";

  const splitKey = workoutSplitKeyFromName(trimmed);
  if (splitKey) {
    const i18nKey = `${WORKOUT_SPLIT_I18N_PREFIX}${splitKey}`;
    const translated = t(i18nKey);
    if (translated && translated !== i18nKey) return translated;
    return titleCaseWords(splitKey.replace(/_/g, " "));
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
