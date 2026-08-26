import type { CoachingTip, WorkoutData } from "../types/workoutCoach";
import i18n from "../i18n";

export const WC_COLORS = {
  PURPLE: "#534AB7",
  PURPLE_LIGHT: "#F0EEF9",
  PURPLE_MID: "#7B68CC",
  GREEN: "#0F6E56",
  GREEN_LIGHT: "#E8F5EE",
  BLUE: "#4A90D9",
  BLUE_LIGHT: "#EEF4FB",
  ORANGE: "#D85A30",
  ORANGE_LIGHT: "#FFF1EE",
  AMBER: "#FFB800",
  AMBER_LIGHT: "#FFF8E8",
  AMBER_TEXT: "#C08000",
  GOLD: "#FFD700",
  BG: "#F7F6F3",
  WHITE: "#FFFFFF",
  TEXT: "#1A1A18",
  MUTED: "#BBBBBB",
  TRACK: "#E5E4E0",
  BORDER: "#ECEAE5",
  SCREEN_BG: "#FFFFFF",
  SORE: "#D85A30",
  SORE_BG: "#FFF1EE",
  TIRED: "#FFB800",
  TIRED_BG: "#FFF8E8",
  READY: "#4A90D9",
  READY_BG: "#EEF4FB",
  FRESH: "#0F6E56",
  FRESH_BG: "#E8F5EE",
  HIGH: "#D85A30",
  HIGH_BG: "#FFF1EE",
  MEDIUM: "#C08000",
  MEDIUM_BG: "#FFF8E8",
  LOW: "#0F6E56",
  LOW_BG: "#E8F5EE",
} as const;

export const MUSCLE_STATUS_CONFIG = {
  fresh: { label: i18n.t("coach.workout.statuses.fresh"), bg: WC_COLORS.FRESH_BG, color: WC_COLORS.FRESH, barColor: WC_COLORS.FRESH },
  ready: { label: i18n.t("coach.workout.statuses.ready"), bg: WC_COLORS.READY_BG, color: WC_COLORS.READY, barColor: WC_COLORS.READY },
  tired: { label: i18n.t("coach.workout.statuses.tired"), bg: WC_COLORS.TIRED_BG, color: WC_COLORS.AMBER_TEXT, barColor: WC_COLORS.TIRED },
  sore: { label: i18n.t("coach.workout.statuses.sore"), bg: WC_COLORS.SORE_BG, color: WC_COLORS.SORE, barColor: WC_COLORS.SORE },
} as const;

export const READINESS_FACTOR_COLORS = {
  good: { bg: WC_COLORS.GREEN_LIGHT, color: WC_COLORS.GREEN },
  warning: { bg: WC_COLORS.AMBER_LIGHT, color: WC_COLORS.AMBER_TEXT },
  bad: { bg: WC_COLORS.SORE_BG, color: WC_COLORS.SORE },
  info: { bg: WC_COLORS.AMBER_LIGHT, color: WC_COLORS.AMBER_TEXT },
} as const;

export const DEFAULT_COACHING_TIPS: CoachingTip[] = [
  {
    icon: "⚡",
    iconBg: "#3A2F15",
    title: i18n.t("coach.workout.defaultTips.mindMuscleTitle"),
    description: i18n.t("coach.workout.defaultTips.mindMuscleDescription"),
  },
  {
    icon: "🔁",
    iconBg: "#173A3C",
    title: i18n.t("coach.workout.defaultTips.frequencyTitle"),
    description: i18n.t("coach.workout.defaultTips.frequencyDescription"),
  },
  {
    icon: "💧",
    iconBg: "#1B2E47",
    title: i18n.t("coach.workout.defaultTips.hydrationTitle"),
    description: i18n.t("coach.workout.defaultTips.hydrationDescription"),
  },
];

export const MOCK_WORKOUT_DATA: WorkoutData = {
  lastWorkoutDate: i18n.t("coach.workout.defaultTips.yesterday"),
  totalWeeklySets: 69,
  targetWeeklySets: 85,
  recentWorkouts: [
    { date: "Yesterday", type: "Legs", musclesTrained: ["Legs", "Glutes"], durationMin: 55 },
    { date: "2 days ago", type: "Pull", musclesTrained: ["Back", "Biceps"], durationMin: 50 },
    { date: "4 days ago", type: "Push", musclesTrained: ["Chest", "Shoulders", "Triceps"], durationMin: 52 },
  ],
  muscleGroups: [
    { name: "Chest", status: "fresh", recoveryPercent: 90, lastTrainedLabel: "4 days ago" },
    { name: "Shoulders", status: "fresh", recoveryPercent: 85, lastTrainedLabel: "4 days ago" },
    { name: "Triceps", status: "ready", recoveryPercent: 68, lastTrainedLabel: "3 days ago" },
    { name: "Back", status: "tired", recoveryPercent: 38, lastTrainedLabel: "2 days ago" },
    { name: "Legs", status: "sore", recoveryPercent: 18, lastTrainedLabel: "Yesterday" },
    { name: "Biceps", status: "ready", recoveryPercent: 72, lastTrainedLabel: "3 days ago" },
  ],
  weeklyVolume: [
    { muscle: "Chest", sets: 16, targetSets: 20, color: "#4ADE80" },
    { muscle: "Back", sets: 11, targetSets: 20, color: "#60A5FA" },
    { muscle: "Legs", sets: 5, targetSets: 20, color: "#F87171" },
    { muscle: "Shoulders", sets: 15, targetSets: 20, color: "#FBBF24" },
    { muscle: "Arms", sets: 12, targetSets: 20, color: "#A78BFA" },
    { muscle: "Core", sets: 10, targetSets: 15, color: "#2DD4BF" },
  ],
};
