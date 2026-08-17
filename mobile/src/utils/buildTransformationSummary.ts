import type { XpSummary } from "../api/xp";
import type { StrengthProgress } from "../api/strength";
import type { WorkoutHistoryItem } from "../api/workout";

export type WeightHistoryEntry = {
  log_date: string;
  weight_kg: number;
};

export type TransformationSummaryInput = {
  fromDate: string;
  toDate: string;
  weightEntries: WeightHistoryEntry[];
  strengthProgress: StrengthProgress | null;
  workoutItems: WorkoutHistoryItem[];
  xpSummary?: XpSummary | null;
};

export type StrengthHighlight = {
  exercise_name: string;
  weight_kg: number;
  estimated_1rm_kg?: number;
  date: string | null;
};

export type TransformationSummary = {
  fromDate: string;
  toDate: string;
  weightStartKg: number | null;
  weightEndKg: number | null;
  weightDeltaKg: number | null;
  workoutCount: number;
  prCount: number;
  strengthHighlights: StrengthHighlight[];
  milestones: string[];
  level: number | null;
};

const inRange = (isoDate: string, fromDate: string, toDate: string) => {
  const day = isoDate.slice(0, 10);
  return day >= fromDate && day <= toDate;
};

const dateFromWorkout = (item: WorkoutHistoryItem) => (item.date || "").slice(0, 10);

export function buildTransformationSummary(input: TransformationSummaryInput): TransformationSummary {
  const { fromDate, toDate, weightEntries, strengthProgress, workoutItems, xpSummary } = input;
  const sortedWeights = [...weightEntries]
    .filter((entry) => inRange(entry.log_date, fromDate, toDate))
    .sort((a, b) => a.log_date.localeCompare(b.log_date));

  const weightStartKg = sortedWeights[0]?.weight_kg ?? null;
  const weightEndKg = sortedWeights[sortedWeights.length - 1]?.weight_kg ?? null;
  const weightDeltaKg =
    weightStartKg != null && weightEndKg != null ? Math.round((weightEndKg - weightStartKg) * 10) / 10 : null;

  const workoutsInRange = workoutItems.filter((item) => inRange(dateFromWorkout(item), fromDate, toDate));
  const workoutDays = new Set(workoutsInRange.map(dateFromWorkout));
  const prCount = workoutsInRange.filter((item) => item.strengthLift?.is_new_pr).length;

  const strengthHighlights: StrengthHighlight[] = (strengthProgress?.lifts ?? [])
    .map((lift) => ({
      exercise_name: lift.exercise_name,
      weight_kg: lift.best_lift?.weight_kg ?? lift.current_best_1rm_kg,
      estimated_1rm_kg: lift.current_best_1rm_kg,
      date: lift.best_lift?.date ?? null,
    }))
    .filter((row) => row.date && inRange(row.date, fromDate, toDate))
    .slice(0, 5);

  const milestones: string[] = [];
  if (weightDeltaKg != null && weightDeltaKg !== 0) {
    milestones.push(`weight_delta:${weightDeltaKg}`);
  }
  if (workoutDays.size > 0) {
    milestones.push(`workout_days:${workoutDays.size}`);
  }
  if (prCount > 0) {
    milestones.push(`prs:${prCount}`);
  }
  if (strengthHighlights.length > 0) {
    milestones.push(`strength_prs:${strengthHighlights.length}`);
  }
  if (xpSummary?.level) {
    milestones.push(`level:${xpSummary.level}`);
  }

  return {
    fromDate,
    toDate,
    weightStartKg,
    weightEndKg,
    weightDeltaKg,
    workoutCount: workoutDays.size,
    prCount,
    strengthHighlights,
    milestones,
    level: xpSummary?.level ?? null,
  };
}
