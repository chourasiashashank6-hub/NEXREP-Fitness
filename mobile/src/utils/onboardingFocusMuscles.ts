import type { FocusMuscle, OnboardingData } from "../types/onboarding";
import i18n from "../i18n";

export const FOCUS_MUSCLE_CHIP_OPTIONS = ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core"] as const;
export const FOCUS_MUSCLE_BALANCED = "Balanced" as const;

export const FOCUS_MUSCLE_UI_OPTIONS = [...FOCUS_MUSCLE_CHIP_OPTIONS, FOCUS_MUSCLE_BALANCED] as const;

type GoalSlice = OnboardingData["goal"];

export function getGoalFocusMuscles(goal: Pick<GoalSlice, "focus_muscles" | "focus_muscle">): FocusMuscle[] {
  if (Array.isArray(goal.focus_muscles) && goal.focus_muscles.length > 0) {
    return goal.focus_muscles;
  }
  if (goal.focus_muscle) return [goal.focus_muscle];
  return [];
}

/** Keep legacy single field in sync for older server reads. */
export function goalPatchFromFocusMuscles(muscles: FocusMuscle[]): Pick<GoalSlice, "focus_muscles" | "focus_muscle"> {
  return {
    focus_muscles: muscles,
    focus_muscle: muscles[0] ?? null,
  };
}

export function toggleGoalFocusMuscle(goal: GoalSlice, muscle: string): Pick<GoalSlice, "focus_muscles" | "focus_muscle"> {
  const current = getGoalFocusMuscles(goal);
  if (muscle === FOCUS_MUSCLE_BALANCED) {
    return goalPatchFromFocusMuscles([]);
  }
  const m = muscle as FocusMuscle;
  const next = current.includes(m) ? current.filter((x) => x !== m) : [...current, m];
  return goalPatchFromFocusMuscles(next);
}

export function isGoalFocusMuscleSelected(goal: GoalSlice, muscle: string): boolean {
  if (muscle === FOCUS_MUSCLE_BALANCED) return getGoalFocusMuscles(goal).length === 0;
  return getGoalFocusMuscles(goal).includes(muscle as FocusMuscle);
}

export function normalizeGoalFocusFields(goal: GoalSlice): GoalSlice {
  const muscles = getGoalFocusMuscles(goal);
  return { ...goal, ...goalPatchFromFocusMuscles(muscles) };
}

export function focusMusclesHint(muscles: FocusMuscle[]): string {
  if (muscles.length === 0) return i18n.t("onboarding.focusMuscles.balancedHint");
  if (muscles.length === 1) return i18n.t("onboarding.focusMuscles.singleHint", { muscle: muscles[0] });
  return i18n.t("onboarding.focusMuscles.multiHint", { muscles: muscles.join(", ") });
}
