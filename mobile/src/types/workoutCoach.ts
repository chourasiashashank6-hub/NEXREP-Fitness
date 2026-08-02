export type MuscleStatus = "fresh" | "ready" | "tired" | "sore";

export interface MuscleGroup {
  name: string;
  status: MuscleStatus;
  recoveryPercent: number;
  lastTrainedLabel: string;
}

export interface VolumeEntry {
  muscle: string;
  sets: number;
  targetSets: number;
  color: string;
}

/** @deprecated Legacy static tips shape — use DynamicCoachingTip */
export interface CoachingTip {
  icon: string;
  iconBg: string;
  title: string;
  description: string;
}

export type DynamicCoachingTipIcon =
  | "lightning"
  | "repeat"
  | "droplet"
  | "moon"
  | "target"
  | "fire"
  | "clock"
  | "shield"
  | "chart"
  | "dumbbell";

export type DynamicCoachingTipCategory =
  | "recovery"
  | "volume"
  | "technique"
  | "nutrition"
  | "mindset"
  | "programming";

export type DynamicCoachingTipPriority = "high" | "medium" | "low";

export interface DynamicCoachingTip {
  icon: DynamicCoachingTipIcon;
  title: string;
  body: string;
  category: DynamicCoachingTipCategory;
  priority: DynamicCoachingTipPriority;
}

export interface ReadinessFactor {
  label: string;
  type: "good" | "warning" | "bad" | "info";
}

export interface WorkoutExercise {
  name: string;
  sets: number;
  reps: string;
  muscle: string;
  note: string;
}

export interface TodaysPlan {
  splitName: string;
  focusMuscles: string[];
  avoidMuscles: string[];
  exercises: WorkoutExercise[];
  estimatedDuration: string;
}

export interface WeeklyProgress {
  completedSets: number;
  targetSets: number;
  percentComplete: number;
  insight: string;
}

export type RecoveryTipIcon = "sleep" | "water" | "stretch" | "food" | "rest";

export interface RecoveryTip {
  icon: RecoveryTipIcon;
  title: string;
  description: string;
}

export interface WorkoutCoachInsight {
  insightText: string;
  todaysPlan: TodaysPlan;
  readinessScore: number;
  readinessLabel: string;
  readinessDescription: string;
  readinessFactors: ReadinessFactor[];
  weeklyProgress: WeeklyProgress;
  recoveryTips: RecoveryTip[];
  coachingTips: DynamicCoachingTip[];
  source?: string;
}

export interface RecentWorkout {
  date: string;
  type: string;
  musclesTrained: string[];
  durationMin: number;
}

export interface WorkoutData {
  recentWorkouts: RecentWorkout[];
  weeklyVolume: VolumeEntry[];
  muscleGroups: MuscleGroup[];
  lastWorkoutDate: string;
  totalWeeklySets: number;
  targetWeeklySets: number;
}
