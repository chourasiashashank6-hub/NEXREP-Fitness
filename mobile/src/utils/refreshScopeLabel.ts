import type { TFunction } from "i18next";
import type { CoachCadence } from "../hooks/useCoachRedesign";

export function refreshScopeLabel(cadence: CoachCadence, t: TFunction): string {
  if (cadence === "daily") return t("coach.workoutPlannerScreen.day");
  if (cadence === "weekly") return t("coach.mealPlannerScreen.week");
  if (cadence === "monthly") return t("coach.workoutPlannerScreen.month");
  return t("coach.common.year");
}
