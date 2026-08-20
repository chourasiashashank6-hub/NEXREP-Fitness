import type { CalorieDayPayload } from "../api/caloriesLog";
import type { WorkoutPlanCurrent } from "../types/planner";
import { sanitizeWorkoutPlanCurrent } from "../utils/sanitizePlannerDay";

export type GamePlanHistoryRow = {
  date: string;
  exerciseName?: string;
  type?: string;
  notes?: string | null;
  bodyPart?: string | null;
};

export type GamePlanCacheSnapshot = {
  fetchedAt: number;
  calorieDay: CalorieDayPayload | null;
  todayWorkoutPlan: WorkoutPlanCurrent | null;
  workoutHistory: GamePlanHistoryRow[];
  weightKg: number;
};

const TTL_MS = 45_000;

let snapshot: GamePlanCacheSnapshot | null = null;

export function setGamePlanCache(data: Omit<GamePlanCacheSnapshot, "fetchedAt">): void {
  snapshot = { ...data, fetchedAt: Date.now() };
}

export function getGamePlanCache(): GamePlanCacheSnapshot | null {
  if (!snapshot) return null;
  if (Date.now() - snapshot.fetchedAt > TTL_MS) {
    snapshot = null;
    return null;
  }
  return snapshot;
}

export function clearGamePlanCache(): void {
  snapshot = null;
}

/** Keep Home/Game Plan cache in sync after Smart Reflow patches the plan elsewhere. */
export function updateGamePlanCacheWorkoutPlan(todayWorkoutPlan: WorkoutPlanCurrent | null): void {
  if (!snapshot) return;
  snapshot = { ...snapshot, todayWorkoutPlan: sanitizeWorkoutPlanCurrent(todayWorkoutPlan), fetchedAt: Date.now() };
}
