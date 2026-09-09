import type { GoalType } from "../../types/onboarding";

export const WORKOUTS_ABSOLUTE_MAX = 14;

export const WORKOUTS_MIN_BY_GOAL: Record<GoalType, number> = {
  fat_loss: 2,
  muscle_gain: 3,
  strength: 3,
  maintain: 2,
  recomp: 2,
};

export const WORKOUTS_WARN_ABOVE: Partial<Record<GoalType, number>> = {
  fat_loss: 6,
  muscle_gain: 6,
  strength: 5,
  maintain: 6,
};

export function workoutsMinForGoal(goal: GoalType | null): number {
  if (!goal) return 1;
  return WORKOUTS_MIN_BY_GOAL[goal] ?? 1;
}

export function workoutsWarnAbove(goal: GoalType | null): number | null {
  if (!goal) return null;
  return WORKOUTS_WARN_ABOVE[goal] ?? null;
}
