export interface NutritionData {
  goal: "maintain" | "loss" | "gain";
  tdee: number;
  caloriesConsumed: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  waterMl: number;
  burnedKcal: number;
  mealsLogged: number;
  proteinTargetG?: number;
  carbsTargetG?: number;
  fatTargetG?: number;
  waterTargetMl?: number;
}

export type MacroStatus = "low" | "on_track" | "high";

export interface MacroVerdictItem {
  status: MacroStatus;
  tip: string;
}

export interface MealPlanItem {
  meal: string;
  items: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface HydrationPlan {
  currentMl: number;
  targetMl: number;
  remainingMl: number;
  nextAction: string;
}

export interface CoachAlertItem {
  type: string;
  icon: string;
  title: string;
  subtitle: string;
}

/** @deprecated use CoachAlertItem — kept for AlertPill compatibility */
export interface AlertItem {
  type: "warning" | "critical" | "success" | "info";
  icon: string;
  title: string;
  subtitle: string;
}

export interface AICoachResponse {
  insight: string;
  bodyImpact: string;
  mealPlan: MealPlanItem[];
  macroVerdict: {
    protein: MacroVerdictItem;
    carbs: MacroVerdictItem;
    fat: MacroVerdictItem;
  };
  hydrationPlan: HydrationPlan;
  dailyScore: number;
  scoreLabel: string;
  alerts: CoachAlertItem[];
  source?: string;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  tag: "water" | "food" | "log" | "move" | "rest";
  priority: "high" | "medium" | "low";
  done: boolean;
}

export const DEFAULT_TASKS: Task[] = [
  {
    id: "1",
    name: "Log breakfast and lunch",
    description: "Mark all meals in the tracker to keep calories accurate.",
    tag: "log",
    priority: "high",
    done: false,
  },
  {
    id: "2",
    name: "Drink 3 more glasses of water",
    description: "One now, one at 3 pm, one before dinner.",
    tag: "water",
    priority: "high",
    done: false,
  },
  {
    id: "3",
    name: "Add a high-protein snack",
    description: "Target 30+ g — Greek yogurt, paneer, or protein shake.",
    tag: "food",
    priority: "high",
    done: false,
  },
  {
    id: "4",
    name: "Eat a fiber-rich food before 8 pm",
    description: "Lentils, raw salad, or fruit to close the fiber gap.",
    tag: "food",
    priority: "medium",
    done: false,
  },
  {
    id: "5",
    name: "Log a 15-min walk",
    description: "A short walk after dinner counts toward your burn goal.",
    tag: "move",
    priority: "medium",
    done: false,
  },
  {
    id: "6",
    name: "Log dinner before 9 pm",
    description: "Closing the day log helps AI recalibrate for tomorrow.",
    tag: "log",
    priority: "low",
    done: false,
  },
];

export const TAG_STYLES = {
  water: { bg: "#E6F1FB", color: "#185FA5" },
  food: { bg: "#EAF3DE", color: "#3B6D11" },
  log: { bg: "#EEEDFE", color: "#534AB7" },
  move: { bg: "#FCEBEB", color: "#A32D2D" },
  rest: { bg: "#FAEEDA", color: "#854F0B" },
} as const;

export const PRIORITY_COLORS = {
  high: "#E24B4A",
  medium: "#EF9F27",
  low: "#97C459",
} as const;

export const ALERT_STYLES = {
  warning: { bg: "#FAEEDA", titleColor: "#854F0B", subColor: "#BA7517" },
  critical: { bg: "#FCEBEB", titleColor: "#A32D2D", subColor: "#993C1D" },
  success: { bg: "#EAF3DE", titleColor: "#3B6D11", subColor: "#639922" },
  info: { bg: "#E6F1FB", titleColor: "#185FA5", subColor: "#378ADD" },
} as const;

export const MOCK_NUTRITION: NutritionData = {
  goal: "maintain",
  tdee: 1800,
  caloriesConsumed: 1480,
  proteinG: 68,
  carbsG: 190,
  fatG: 42,
  fiberG: 9,
  waterMl: 1200,
  burnedKcal: 340,
  mealsLogged: 2,
};
