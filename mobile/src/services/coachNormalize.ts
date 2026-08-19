import type { AICoachResponse, AlertItem, CoachAlertItem, DietTipCategory, DietTipItem, MacroStatus, NutritionData } from "../types/coach";
import type {
  DynamicCoachingTip,
  DynamicCoachingTipCategory,
  DynamicCoachingTipIcon,
  DynamicCoachingTipPriority,
  WorkoutCoachInsight,
  WorkoutData,
} from "../types/workoutCoach";
import type { OnboardingData } from "../types/onboarding";
import i18n from "../i18n";
import { getGoalFocusMuscles } from "../utils/onboardingFocusMuscles";
import { getTargetWeeklySets } from "../utils/weeklyMuscleTargets";

const COACHING_TIP_ICONS = new Set<DynamicCoachingTipIcon>([
  "lightning",
  "repeat",
  "droplet",
  "moon",
  "target",
  "fire",
  "clock",
  "shield",
  "chart",
  "dumbbell",
]);
const COACHING_TIP_CATEGORIES = new Set<DynamicCoachingTipCategory>([
  "recovery",
  "volume",
  "technique",
  "nutrition",
  "mindset",
  "programming",
]);
const COACHING_TIP_PRIORITIES = new Set<DynamicCoachingTipPriority>(["high", "medium", "low"]);
const DIET_TIP_CATEGORIES = new Set<DietTipCategory>(["gut", "protein", "digestion", "timing", "fat"]);

export function buildFallbackCoachingTips(data: WorkoutData, readinessScore = 70): DynamicCoachingTip[] {
  const tips: DynamicCoachingTip[] = [];
  const soreMuscles = data.muscleGroups.filter((m) => m.status === "sore").map((m) => m.name);

  if (soreMuscles.length) {
    const soreList = soreMuscles.join(", ");
    tips.push({
      icon: "moon",
      title: i18n.t("coach.workout.fallback.restTitle", { muscle: soreMuscles[0] }),
      body: i18n.t("coach.workout.fallback.restBody", {
        muscles: soreList,
        verb: soreMuscles.length === 1 ? "is" : "are",
        pronoun: soreMuscles.length === 1 ? "it" : "them",
      }),
      category: "recovery",
      priority: "high",
    });
  }

  const undertrained = data.weeklyVolume.filter((m) => m.sets < m.targetSets * 0.5);
  if (undertrained.length) {
    const muscleName = undertrained[0].muscle;
    const current = undertrained[0].sets;
    const target = undertrained[0].targetSets;
    tips.push({
      icon: "target",
      title: i18n.t("coach.workout.fallback.gapTitle", { muscle: muscleName }),
      body: i18n.t("coach.workout.fallback.gapBody", { current, muscle: muscleName, target, lowerMuscle: muscleName.toLowerCase() }),
      category: "volume",
      priority: "high",
    });
  }

  if (readinessScore < 50 && tips.filter((t) => t.category === "recovery").length < 2) {
    tips.push({
      icon: "moon",
      title: i18n.t("coach.workout.fallback.recoveryTitle"),
      body: i18n.t("coach.workout.fallback.recoveryBody", { score: readinessScore }),
      category: "recovery",
      priority: "high",
    });
  }

  if (readinessScore > 75) {
    const fresh = data.muscleGroups.filter((m) => m.status === "fresh").map((m) => m.name);
    if (fresh.length) {
      tips.push({
        icon: "fire",
        title: i18n.t("coach.workout.fallback.pushTitle", { muscle: fresh[0] }),
        body: i18n.t("coach.workout.fallback.pushBody", { muscle: fresh[0] }),
        category: "programming",
        priority: "medium",
      });
    }
  }

  tips.push({
    icon: "dumbbell",
    title: i18n.t("coach.workout.fallback.eccentricTitle"),
    body: i18n.t("coach.workout.fallback.eccentricBody"),
    category: "technique",
    priority: "medium",
  });
  tips.push({
    icon: "droplet",
    title: i18n.t("coach.workout.fallback.hydrateTitle"),
    body: i18n.t("coach.workout.fallback.hydrateBody"),
    category: "nutrition",
    priority: "low",
  });

  if (!tips.length) {
    tips.push({
      icon: "target",
      title: i18n.t("coach.workout.fallback.logTitle"),
      body: i18n.t("coach.workout.fallback.logBody"),
      category: "programming",
      priority: "high",
    });
  }

  return tips.slice(0, 4);
}

function parseCoachingTips(raw: unknown, data: WorkoutData, readinessScore: number): DynamicCoachingTip[] {
  const rawList = Array.isArray(raw) ? raw : [];
  const tips: DynamicCoachingTip[] = [];

  for (const item of rawList.slice(0, 4)) {
    const x = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    if (!x.title) continue;
    const iconRaw = String(x.icon || "lightning");
    const icon = (COACHING_TIP_ICONS.has(iconRaw as DynamicCoachingTipIcon)
      ? iconRaw
      : "lightning") as DynamicCoachingTipIcon;
    const categoryRaw = String(x.category || "programming");
    const category = (COACHING_TIP_CATEGORIES.has(categoryRaw as DynamicCoachingTipCategory)
      ? categoryRaw
      : "programming") as DynamicCoachingTipCategory;
    const priorityRaw = String(x.priority || "medium");
    const priority = (COACHING_TIP_PRIORITIES.has(priorityRaw as DynamicCoachingTipPriority)
      ? priorityRaw
      : "medium") as DynamicCoachingTipPriority;
    const body = String(x.body || x.description || "").trim();
    if (!body) continue;
    tips.push({
      icon,
      title: String(x.title).slice(0, 80),
      body,
      category,
      priority,
    });
  }

  if (tips.length < 4) {
    const fallback = buildFallbackCoachingTips(data, readinessScore);
    const seen = new Set(tips.map((t) => t.title.toLowerCase()));
    for (const item of fallback) {
      if (tips.length >= 4) break;
      if (seen.has(item.title.toLowerCase())) continue;
      tips.push(item);
      seen.add(item.title.toLowerCase());
    }
  }

  while (tips.length < 4) {
    const filler = buildFallbackCoachingTips(data, readinessScore);
    tips.push(filler[tips.length % filler.length]);
  }

  return tips.slice(0, 4);
}

export const CALORIE_COACH_DEFAULTS: AICoachResponse = {
  insight: i18n.t("coach.calorie.defaults.insight"),
  bodyImpact: i18n.t("coach.calorie.defaults.bodyImpact"),
  mealPlan: [],
  macroVerdict: {
    protein: { status: "low", tip: i18n.t("coach.calorie.defaults.proteinTip") },
    carbs: { status: "on_track", tip: i18n.t("coach.calorie.defaults.carbsTip") },
    fat: { status: "on_track", tip: i18n.t("coach.calorie.defaults.fatTip") },
  },
  hydrationPlan: {
    currentMl: 0,
    targetMl: 2500,
    remainingMl: 2500,
    nextAction: i18n.t("coach.calorie.defaults.waterAction"),
  },
  dailyScore: 0,
  scoreLabel: i18n.t("coach.calorie.defaults.scoreLabel"),
  alerts: [],
};

const MACRO_ON_TRACK_RATIO = 0.8;
const MACRO_HIGH_RATIO = 1.15;

function macroStatus(consumed: number, target: number): MacroStatus {
  if (target <= 0) return "on_track";
  const ratio = consumed / target;
  if (ratio < MACRO_ON_TRACK_RATIO) return "low";
  if (ratio > MACRO_HIGH_RATIO) return "high";
  return "on_track";
}

export function normalizeCalorieCoachResponse(raw: unknown, nutrition?: NutritionData | null): AICoachResponse {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base = { ...CALORIE_COACH_DEFAULTS };

  const tdee = nutrition?.tdee ?? Number(p.daily_goal) ?? 2000;
  const consumed = nutrition?.caloriesConsumed ?? Number(p.consumed_calories) ?? 0;
  const proteinG = nutrition?.proteinG ?? 0;
  const carbsG = nutrition?.carbsG ?? 0;
  const fatG = nutrition?.fatG ?? 0;
  const proteinTarget = nutrition?.proteinTargetG ?? Math.round(tdee * 0.3 / 4);
  const carbsTarget = nutrition?.carbsTargetG ?? Math.round(tdee * 0.5 / 4);
  const fatTarget = nutrition?.fatTargetG ?? Math.round(tdee * 0.2 / 9);
  const waterMl = nutrition?.waterMl ?? 0;
  const waterTarget = nutrition?.waterTargetMl ?? 2500;
  const remaining = Math.round(tdee - consumed);

  const mv = p.macroVerdict && typeof p.macroVerdict === "object" ? (p.macroVerdict as Record<string, unknown>) : {};
  const pickMacro = (key: "protein" | "carbs" | "fat", c: number, t: number) => {
    const block = mv[key] && typeof mv[key] === "object" ? (mv[key] as Record<string, unknown>) : {};
    const status = (["low", "on_track", "high"].includes(String(block.status)) ? block.status : macroStatus(c, t)) as MacroStatus;
    return {
      status,
      tip: String(block.tip || base.macroVerdict[key].tip),
    };
  };

  const hp = p.hydrationPlan && typeof p.hydrationPlan === "object" ? (p.hydrationPlan as Record<string, unknown>) : {};
  const mealPlanRaw = Array.isArray(p.mealPlan) ? p.mealPlan : [];
  const mealPlan = mealPlanRaw.slice(0, 3).map((item) => {
    const m = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      meal: String(m.meal || i18n.t("coach.calorie.defaults.meal")),
      items: String(m.items || ""),
      calories: Number(m.calories) || 0,
      protein: Number(m.protein) || 0,
      carbs: Number(m.carbs) || 0,
      fat: Number(m.fat) || 0,
    };
  });

  const alertsRaw = Array.isArray(p.alerts) ? p.alerts : [];
  const alerts: CoachAlertItem[] = alertsRaw.slice(0, 4).map((a) => {
    const x = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    return {
      type: String(x.type || "info"),
      icon: String(x.icon || ""),
      title: String(x.title || i18n.t("coach.calorie.defaults.alert")),
      subtitle: String(x.subtitle || ""),
    };
  });
  const dietTipsRaw = Array.isArray(p.dietTips) ? p.dietTips : [];
  const dietTips: DietTipItem[] = dietTipsRaw.slice(0, 5).flatMap((item) => {
    const x = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const title = String(x.title || "").trim();
    const body = String(x.body || "").trim();
    if (!title || !body) return [];
    const categoryRaw = String(x.category || "gut");
    return [
      {
        emoji: String(x.emoji || "🌿"),
        title,
        body,
        tag: String(x.tag || i18n.t("coach.calorie.defaults.gut")),
        category: DIET_TIP_CATEGORIES.has(categoryRaw as DietTipCategory) ? (categoryRaw as DietTipCategory) : "gut",
      },
    ];
  });

  const dailyScore = Math.max(0, Math.min(100, Number(p.dailyScore) || base.dailyScore));

  return {
    insight: String(p.insight || base.insight),
    bodyImpact: String(p.bodyImpact || base.bodyImpact),
    mealPlan,
    macroVerdict: {
      protein: pickMacro("protein", proteinG, proteinTarget),
      carbs: pickMacro("carbs", carbsG, carbsTarget),
      fat: pickMacro("fat", fatG, fatTarget),
    },
    hydrationPlan: {
      currentMl: Number(hp.currentMl) || waterMl,
      targetMl: Number(hp.targetMl) || waterTarget,
      remainingMl: Number(hp.remainingMl) || Math.max(0, waterTarget - waterMl),
      nextAction: String(hp.nextAction || base.hydrationPlan.nextAction),
    },
    dailyScore,
    scoreLabel: String(p.scoreLabel || base.scoreLabel),
    alerts,
    dietTips: dietTips.length ? dietTips : undefined,
    source: typeof p.source === "string" ? p.source : undefined,
  };
}

const ALERT_ICON_MAP: Record<string, string> = {
  calorie: "🔥",
  hydration: "💧",
  meal: "🍽️",
  nutrition: "🥗",
};

const ALERT_TYPE_MAP: Record<string, AlertItem["type"]> = {
  calorie: "info",
  hydration: "success",
  meal: "warning",
  nutrition: "warning",
  critical: "critical",
  warning: "warning",
  success: "success",
  info: "info",
};

export function coachAlertsToPills(alerts: CoachAlertItem[]): AlertItem[] {
  if (!alerts.length) return [];
  return alerts.map((a) => ({
    type: ALERT_TYPE_MAP[a.type] ?? "info",
    icon: ALERT_ICON_MAP[a.type] || a.icon || "•",
    title: a.title,
    subtitle: a.subtitle,
  }));
}

export function normalizeWorkoutCoachResponse(raw: unknown, data?: WorkoutData | null, onboardingData?: OnboardingData | null): WorkoutCoachInsight {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const groups = data?.muscleGroups ?? [];
  const fresh = groups.filter((m) => m.status === "fresh").map((m) => m.name);
  const sore = groups.filter((m) => m.status === "sore").map((m) => m.name);
  const avg = groups.length ? groups.reduce((a, m) => a + m.recoveryPercent, 0) / groups.length : 68;
  const completed = data?.totalWeeklySets ?? 0;
  const fallbackFocusMuscles = onboardingData?.goal ? getGoalFocusMuscles(onboardingData.goal) : undefined;
  const fallbackTarget = onboardingData
    ? getTargetWeeklySets(onboardingData.activity?.workouts_per_week, fallbackFocusMuscles)
    : 84;
  const target = data?.targetWeeklySets ?? fallbackTarget;
  const pct = target > 0 ? Math.round((completed / target) * 100) : 0;

  const planRaw = p.todaysPlan && typeof p.todaysPlan === "object" ? (p.todaysPlan as Record<string, unknown>) : {};
  const exercisesRaw = Array.isArray(planRaw.exercises) ? planRaw.exercises : [];
  let exercises = exercisesRaw.slice(0, 6).map((ex) => {
    const e = ex && typeof ex === "object" ? (ex as Record<string, unknown>) : {};
    return {
      name: String(e.name || i18n.t("coach.workout.fallback.exercise")),
      sets: Number(e.sets) || 3,
      reps: String(e.reps || "10-12"),
      muscle: String(e.muscle || i18n.t("coach.workout.fallback.general")),
      note: String(e.note || ""),
    };
  });
  if (exercises.length < 4) {
    exercises = [
      { name: i18n.t("coach.workout.fallback.bench"), sets: 4, reps: "8-12", muscle: "Chest", note: i18n.t("coach.workout.fallback.benchNote") },
      { name: i18n.t("coach.workout.fallback.overheadPress"), sets: 3, reps: "10", muscle: "Shoulders", note: i18n.t("coach.workout.fallback.overheadPressNote") },
      { name: i18n.t("coach.workout.fallback.inclinePress"), sets: 3, reps: "10-12", muscle: "Chest", note: i18n.t("coach.workout.fallback.inclinePressNote") },
      { name: i18n.t("coach.workout.fallback.lateralRaises"), sets: 3, reps: "15", muscle: "Shoulders", note: i18n.t("coach.workout.fallback.lateralRaisesNote") },
    ];
  }

  let factorsRaw = Array.isArray(p.readinessFactors) ? p.readinessFactors : [];
  let readinessFactors = factorsRaw.slice(0, 4).map((f) => {
    const x = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
    const type = String(x.type || "info");
    return {
      label: String(x.label || ""),
      type: (["good", "warning", "bad", "info"].includes(type) ? type : "info") as "good" | "warning" | "bad" | "info",
    };
  });
  while (readinessFactors.length < 4) {
    const fill = [
      { label: fresh[0] ? i18n.t("coach.workout.fallback.freshLabel", { muscle: fresh[0] }) : i18n.t("coach.workout.fallback.recoveryOk"), type: "good" as const },
      { label: sore[0] ? i18n.t("coach.workout.fallback.soreLabel", { muscle: sore[0] }) : i18n.t("coach.workout.fallback.lowSoreness"), type: sore[0] ? ("bad" as const) : ("good" as const) },
      { label: i18n.t("coach.workout.fallback.weeklyVolumeFactor", { percent: pct }), type: pct < 50 ? ("warning" as const) : ("info" as const) },
      { label: i18n.t("coach.workout.fallback.sleepQuality"), type: "info" as const },
    ];
    readinessFactors.push(fill[readinessFactors.length]);
  }

  let tipsRaw = Array.isArray(p.recoveryTips) ? p.recoveryTips : [];
  let recoveryTips = tipsRaw.slice(0, 3).map((t) => {
    const x = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
    const icon = String(x.icon || "rest");
    return {
      icon: (["sleep", "water", "stretch", "food", "rest"].includes(icon) ? icon : "rest") as "sleep" | "water" | "stretch" | "food" | "rest",
      title: String(x.title || i18n.t("coach.workout.fallback.recovery")),
      description: String(x.description || ""),
    };
  });
  if (recoveryTips.length < 3) {
    const defaults = [
      { icon: "sleep" as const, title: i18n.t("coach.workout.fallback.sleepTitle"), description: i18n.t("coach.workout.fallback.sleepDescription") },
      { icon: "water" as const, title: i18n.t("coach.workout.fallback.waterTitle"), description: i18n.t("coach.workout.fallback.waterDescription") },
      { icon: "stretch" as const, title: i18n.t("coach.workout.fallback.mobilityTitle"), description: i18n.t("coach.workout.fallback.mobilityDescription") },
    ];
    recoveryTips = [...recoveryTips, ...defaults.slice(recoveryTips.length)].slice(0, 3);
  }

  const wp = p.weeklyProgress && typeof p.weeklyProgress === "object" ? (p.weeklyProgress as Record<string, unknown>) : {};
  const score = Math.max(0, Math.min(100, Number(p.readinessScore) || Math.round(avg)));
  const workoutData = data ?? {
    recentWorkouts: [],
    weeklyVolume: [],
    muscleGroups: [],
    lastWorkoutDate: i18n.t("coach.workout.fallback.noWorkoutYet"),
    totalWeeklySets: 0,
    targetWeeklySets: fallbackTarget,
  };
  const coachingTips = parseCoachingTips(p.coachingTips, workoutData, score);

  return {
    insightText: String(
      p.insightText ||
        i18n.t("coach.workout.fallback.defaultInsight", {
          readyText: fresh.length ? i18n.t("coach.workout.fallback.readyText", { muscles: fresh.join(" and ") }) : "",
          avoidText: sore.length ? i18n.t("coach.workout.fallback.avoidText", { muscles: sore.join(" and ") }) : "",
        }),
    ),
    todaysPlan: {
      splitName: String(planRaw.splitName || i18n.t("coach.workout.fallback.trainingDay")),
      focusMuscles: Array.isArray(planRaw.focusMuscles) ? planRaw.focusMuscles.map(String) : fresh,
      avoidMuscles: Array.isArray(planRaw.avoidMuscles) ? planRaw.avoidMuscles.map(String) : sore,
      exercises,
      estimatedDuration: String(planRaw.estimatedDuration || "45-55 min"),
    },
    readinessScore: score,
    readinessLabel: String(p.readinessLabel || (score >= 76 ? i18n.t("coach.workout.fallback.readyToPush") : score >= 51 ? i18n.t("coach.workout.fallback.trainModerately") : i18n.t("coach.workout.fallback.lightActivity"))),
    readinessDescription: String(p.readinessDescription || i18n.t("coach.workout.fallback.readinessDescription")),
    readinessFactors,
    weeklyProgress: {
      completedSets: Number(wp.completedSets) || completed,
      targetSets: Number(wp.targetSets) || target,
      percentComplete: Number(wp.percentComplete) || pct,
      insight: String(wp.insight || i18n.t("coach.workout.fallback.weeklyVolume", { percent: pct })),
    },
    recoveryTips,
    coachingTips,
    source: typeof p.source === "string" ? p.source : undefined,
  };
}
