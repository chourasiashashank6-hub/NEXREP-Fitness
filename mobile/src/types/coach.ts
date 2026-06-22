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

import i18n from "../i18n";

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

export type DietTipCategory = "gut" | "protein" | "digestion" | "timing" | "fat";

export interface DietTipItem {
  emoji: string;
  title: string;
  body: string;
  tag: string;
  category: DietTipCategory;
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
  dietTips?: DietTipItem[];
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
    name: i18n.t("coach.actionPlan.defaults.logBreakfast"),
    description: i18n.t("coach.actionPlan.defaults.logBreakfastDesc"),
    tag: "log",
    priority: "high",
    done: false,
  },
  {
    id: "2",
    name: i18n.t("coach.actionPlan.defaults.drinkWater"),
    description: i18n.t("coach.actionPlan.defaults.drinkWaterDesc"),
    tag: "water",
    priority: "high",
    done: false,
  },
  {
    id: "3",
    name: i18n.t("coach.actionPlan.defaults.proteinSnack"),
    description: i18n.t("coach.actionPlan.defaults.proteinSnackDesc"),
    tag: "food",
    priority: "high",
    done: false,
  },
  {
    id: "4",
    name: i18n.t("coach.actionPlan.defaults.fiberFood"),
    description: i18n.t("coach.actionPlan.defaults.fiberFoodDesc"),
    tag: "food",
    priority: "medium",
    done: false,
  },
  {
    id: "5",
    name: i18n.t("coach.actionPlan.defaults.walk"),
    description: i18n.t("coach.actionPlan.defaults.walkDesc"),
    tag: "move",
    priority: "medium",
    done: false,
  },
  {
    id: "6",
    name: i18n.t("coach.actionPlan.defaults.logDinner"),
    description: i18n.t("coach.actionPlan.defaults.logDinnerDesc"),
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
