import type { OnboardingData } from "../../types/onboarding";
import { getActivityLevel, getTdeeMultiplier } from "../../constants/onboarding";
import { goalPatchFromFocusMuscles } from "../onboardingFocusMuscles";
import { isPaceAllowed } from "./pace";
import { validateTargetWeight } from "./rules";
import { getCurrentWeightKg, getTargetWeightKg } from "./units";
import { workoutsMinForGoal } from "./workouts";
import type { ValidationIssue } from "./types";

export type ReconcileNotice = ValidationIssue & { action: string };

export type ReconcileResult = {
  data: OnboardingData;
  notices: ReconcileNotice[];
};

function clone(data: OnboardingData): OnboardingData {
  return JSON.parse(JSON.stringify(data)) as OnboardingData;
}

/** Clear or adjust downstream fields after an upstream edit (A4). */
export function reconcileOnboarding(
  data: OnboardingData,
  trigger: "personal" | "goal" | "activity" | "dietary",
): ReconcileResult {
  const next = clone(data);
  const notices: ReconcileNotice[] = [];

  if (trigger === "personal" || trigger === "goal") {
    const targetIssue = validateTargetWeight(next);
    if (!targetIssue.valid) {
      if (next.personal.unit_system === "metric") {
        next.goal.target_weight_kg = null;
      } else {
        next.goal.target_weight_lb = null;
      }
      notices.push({
        ...targetIssue,
        action: "cleared_target",
      });
    }
  }

  if (trigger === "personal" || trigger === "goal") {
    if (next.goal.pace && !isPaceAllowed(next, next.goal.pace)) {
      next.goal.pace = null;
      notices.push({
        valid: false,
        field: "pace",
        code: "pace.clearedInvalid",
        action: "cleared_pace",
      });
    }
  }

  if (trigger === "goal" || trigger === "personal") {
    if (next.goal.type === "strength" || next.goal.type === "maintain") {
      if (next.goal.pace) {
        next.goal.pace = null;
      }
    }
  }

  if (trigger === "goal") {
    const min = workoutsMinForGoal(next.goal.type);
    const current = next.activity.workouts_per_week ?? 0;
    if (current < min) {
      next.activity.workouts_per_week = min;
      next.activity.level = getActivityLevel(min);
      next.activity.tdee_multiplier = getTdeeMultiplier(min);
      notices.push({
        valid: false,
        field: "workouts",
        code: "workouts.raisedToMin",
        params: { min, previous: current },
        action: "raised_workouts",
      });
    }
  }

  if (trigger === "goal" || trigger === "personal") {
    const muscles = next.goal.focus_muscles ?? [];
    if (muscles.length > 3) {
      const trimmed = muscles.slice(0, 3);
      Object.assign(next.goal, goalPatchFromFocusMuscles(trimmed));
      notices.push({
        valid: false,
        field: "muscle_focus",
        code: "muscleFocus.trimmed",
        params: { max: 3 },
        action: "trimmed_muscle_focus",
      });
    }
  }

  if (trigger === "goal") {
    const currentKg = getCurrentWeightKg(next);
    const targetKg = getTargetWeightKg(next);
    if (
      next.goal.type === "muscle_gain" &&
      currentKg != null &&
      targetKg != null &&
      targetKg < currentKg
    ) {
      if (next.personal.unit_system === "metric") next.goal.target_weight_kg = null;
      else next.goal.target_weight_lb = null;
      notices.push({
        valid: false,
        field: "target",
        code: "target.clearedOnGoalChange",
        action: "cleared_target_goal_change",
      });
    }
    if (
      next.goal.type === "fat_loss" &&
      currentKg != null &&
      targetKg != null &&
      targetKg > currentKg
    ) {
      if (next.personal.unit_system === "metric") next.goal.target_weight_kg = null;
      else next.goal.target_weight_lb = null;
      notices.push({
        valid: false,
        field: "target",
        code: "target.clearedOnGoalChange",
        action: "cleared_target_goal_change",
      });
    }
  }

  return { data: next, notices };
}
