import type { CoachingTip, WorkoutData } from "../types/workoutCoach";

export const WC_COLORS = {
  surface: "#161A22",
  cardBg: "#1B2230",
  cardBorder: "#2A3447",
  textPrimary: "#F3F4F6",
  textSecondary: "#C1C8D6",
  textTertiary: "#9AA5B5",
  border: "#2A3447",
  green: "#4ADE80",
  greenLight: "#1F3A2A",
  greenDark: "#A7F3D0",
  blue: "#60A5FA",
  blueLight: "#1B2E47",
  blueDark: "#BBD7FF",
  amber: "#FBBF24",
  amberLight: "#3A2F15",
  amberDark: "#FDE68A",
  red: "#F87171",
  redLight: "#3A1F24",
  redDark: "#FECACA",
  purple: "#A78BFA",
  purpleLight: "#2C2347",
  purpleDark: "#DDD6FE",
  teal: "#2DD4BF",
  tealLight: "#173A3C",
} as const;

export const MUSCLE_STATUS_CONFIG = {
  fresh: { label: "Fresh", bg: "#1F3A2A", color: "#A7F3D0", barColor: "#4ADE80" },
  ready: { label: "Ready", bg: "#1B2E47", color: "#BBD7FF", barColor: "#60A5FA" },
  tired: { label: "Tired", bg: "#3A2F15", color: "#FDE68A", barColor: "#FBBF24" },
  sore: { label: "Sore", bg: "#3A1F24", color: "#FECACA", barColor: "#F87171" },
} as const;

export const READINESS_FACTOR_COLORS = {
  good: { bg: "#1F3A2A", color: "#A7F3D0" },
  warning: { bg: "#3A2F15", color: "#FDE68A" },
  bad: { bg: "#3A1F24", color: "#FECACA" },
  info: { bg: "#1B2E47", color: "#BBD7FF" },
} as const;

export const DEFAULT_COACHING_TIPS: CoachingTip[] = [
  {
    icon: "⚡",
    iconBg: "#3A2F15",
    title: "Mind-muscle connection",
    description: "Slow the eccentric to 3 seconds for better muscle stimulus and safer reps.",
  },
  {
    icon: "🔁",
    iconBg: "#173A3C",
    title: "Hit each muscle 2x weekly",
    description: "Two quality sessions per muscle group weekly generally beats once-a-week splits.",
  },
  {
    icon: "💧",
    iconBg: "#1B2E47",
    title: "Hydration supports output",
    description: "Even mild dehydration can reduce strength and endurance. Hydrate before sessions.",
  },
];

export const MOCK_WORKOUT_DATA: WorkoutData = {
  lastWorkoutDate: "Yesterday",
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
