import type { AICoachResponse, AlertItem, CoachAlertItem, MacroStatus, NutritionData } from "../types/coach";
import type {
  DynamicCoachingTip,
  DynamicCoachingTipCategory,
  DynamicCoachingTipIcon,
  DynamicCoachingTipPriority,
  WorkoutCoachInsight,
  WorkoutData,
} from "../types/workoutCoach";

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

export function buildFallbackCoachingTips(data: WorkoutData, readinessScore = 70): DynamicCoachingTip[] {
  const tips: DynamicCoachingTip[] = [];
  const soreMuscles = data.muscleGroups.filter((m) => m.status === "sore").map((m) => m.name);

  if (soreMuscles.length) {
    const soreList = soreMuscles.join(", ");
    tips.push({
      icon: "moon",
      title: `Rest ${soreMuscles[0]} today`,
      body: `${soreList} ${soreMuscles.length === 1 ? "is" : "are"} still recovering. Avoid training ${soreMuscles.length === 1 ? "it" : "them"} today and prioritize sleep for faster repair.`,
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
      title: `Close the ${muscleName} gap`,
      body: `You have only ${current} sets for ${muscleName} this week vs a ${target}-set target. Add a ${muscleName.toLowerCase()}-focused session before the week ends.`,
      category: "volume",
      priority: "high",
    });
  }

  if (readinessScore < 50 && tips.filter((t) => t.category === "recovery").length < 2) {
    tips.push({
      icon: "moon",
      title: "Prioritize recovery today",
      body: `Your readiness score is ${readinessScore}/100. Keep today's session light and aim for 7-8 hours of sleep tonight.`,
      category: "recovery",
      priority: "high",
    });
  }

  if (readinessScore > 75) {
    const fresh = data.muscleGroups.filter((m) => m.status === "fresh").map((m) => m.name);
    if (fresh.length) {
      tips.push({
        icon: "fire",
        title: `Push ${fresh[0]} volume`,
        body: `${fresh[0]} is fresh and ready — use this session to add quality sets while form stays crisp.`,
        category: "programming",
        priority: "medium",
      });
    }
  }

  tips.push({
    icon: "dumbbell",
    title: "Slow the eccentric",
    body: "For any exercise today, slow the lowering phase to 3 seconds. This increases time under tension without adding weight.",
    category: "technique",
    priority: "medium",
  });
  tips.push({
    icon: "droplet",
    title: "Hydrate before training",
    body: "Drink 500ml of water 30 minutes before your session. Even slight dehydration reduces strength output measurably.",
    category: "nutrition",
    priority: "low",
  });

  if (!tips.length) {
    tips.push({
      icon: "target",
      title: "Log workouts for insights",
      body: "Start logging your workouts to get personalized coaching tips based on your actual training data.",
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
  insight: "Log more meals to get personalized insights.",
  bodyImpact: "Not enough data yet to assess body impact.",
  mealPlan: [],
  macroVerdict: {
    protein: { status: "low", tip: "Add a protein source to your next meal." },
    carbs: { status: "on_track", tip: "Carb intake looks reasonable." },
    fat: { status: "on_track", tip: "Fat intake is within range." },
  },
  hydrationPlan: {
    currentMl: 0,
    targetMl: 2500,
    remainingMl: 2500,
    nextAction: "Start drinking water.",
  },
  dailyScore: 0,
  scoreLabel: "Needs Work",
  alerts: [],
};

function macroStatus(consumed: number, target: number): MacroStatus {
  if (target <= 0) return "on_track";
  const ratio = consumed / target;
  if (ratio < 0.7) return "low";
  if (ratio > 1.15) return "high";
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
      meal: String(m.meal || "Meal"),
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
      title: String(x.title || "Alert"),
      subtitle: String(x.subtitle || ""),
    };
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

export function normalizeWorkoutCoachResponse(raw: unknown, data?: WorkoutData | null): WorkoutCoachInsight {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const groups = data?.muscleGroups ?? [];
  const fresh = groups.filter((m) => m.status === "fresh").map((m) => m.name);
  const sore = groups.filter((m) => m.status === "sore").map((m) => m.name);
  const avg = groups.length ? groups.reduce((a, m) => a + m.recoveryPercent, 0) / groups.length : 68;
  const completed = data?.totalWeeklySets ?? 0;
  const target = data?.targetWeeklySets ?? 84;
  const pct = target > 0 ? Math.round((completed / target) * 100) : 0;

  const planRaw = p.todaysPlan && typeof p.todaysPlan === "object" ? (p.todaysPlan as Record<string, unknown>) : {};
  const exercisesRaw = Array.isArray(planRaw.exercises) ? planRaw.exercises : [];
  let exercises = exercisesRaw.slice(0, 6).map((ex) => {
    const e = ex && typeof ex === "object" ? (ex as Record<string, unknown>) : {};
    return {
      name: String(e.name || "Exercise"),
      sets: Number(e.sets) || 3,
      reps: String(e.reps || "10-12"),
      muscle: String(e.muscle || "General"),
      note: String(e.note || ""),
    };
  });
  if (exercises.length < 4) {
    exercises = [
      { name: "Barbell Bench Press", sets: 4, reps: "8-12", muscle: "Chest", note: "Control the descent and drive through your feet." },
      { name: "Overhead Press", sets: 3, reps: "10", muscle: "Shoulders", note: "Brace your core and press straight overhead." },
      { name: "Incline Dumbbell Press", sets: 3, reps: "10-12", muscle: "Chest", note: "Squeeze at the top for one second." },
      { name: "Lateral Raises", sets: 3, reps: "15", muscle: "Shoulders", note: "Lead with your elbows, not your hands." },
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
      { label: fresh[0] ? `${fresh[0]} fresh` : "Recovery OK", type: "good" as const },
      { label: sore[0] ? `${sore[0]} sore` : "Low soreness", type: sore[0] ? ("bad" as const) : ("good" as const) },
      { label: `Weekly volume ${pct}%`, type: pct < 50 ? ("warning" as const) : ("info" as const) },
      { label: "Check sleep quality", type: "info" as const },
    ];
    readinessFactors.push(fill[readinessFactors.length]);
  }

  let tipsRaw = Array.isArray(p.recoveryTips) ? p.recoveryTips : [];
  let recoveryTips = tipsRaw.slice(0, 3).map((t) => {
    const x = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
    const icon = String(x.icon || "rest");
    return {
      icon: (["sleep", "water", "stretch", "food", "rest"].includes(icon) ? icon : "rest") as "sleep" | "water" | "stretch" | "food" | "rest",
      title: String(x.title || "Recovery"),
      description: String(x.description || ""),
    };
  });
  if (recoveryTips.length < 3) {
    const defaults = [
      { icon: "sleep" as const, title: "Sleep 7-8 hours", description: "Recovery improves with consistent sleep tonight." },
      { icon: "water" as const, title: "Hydrate well", description: "Drink water through the day to reduce soreness." },
      { icon: "stretch" as const, title: "Mobility work", description: "Add 10 minutes of stretching for tight muscle groups." },
    ];
    recoveryTips = [...recoveryTips, ...defaults.slice(recoveryTips.length)].slice(0, 3);
  }

  const wp = p.weeklyProgress && typeof p.weeklyProgress === "object" ? (p.weeklyProgress as Record<string, unknown>) : {};
  const score = Math.max(0, Math.min(100, Number(p.readinessScore) || Math.round(avg)));
  const workoutData = data ?? {
    recentWorkouts: [],
    weeklyVolume: [],
    muscleGroups: [],
    lastWorkoutDate: "No workout yet",
    totalWeeklySets: 0,
    targetWeeklySets: 84,
  };
  const coachingTips = parseCoachingTips(p.coachingTips, workoutData, score);

  return {
    insightText: String(
      p.insightText ||
        `${fresh.length ? `${fresh.join(" and ")} are ready. ` : ""}${sore.length ? `Avoid heavy ${sore.join(" and ")} work. ` : ""}Train with control and intent.`,
    ),
    todaysPlan: {
      splitName: String(planRaw.splitName || "Training Day"),
      focusMuscles: Array.isArray(planRaw.focusMuscles) ? planRaw.focusMuscles.map(String) : fresh,
      avoidMuscles: Array.isArray(planRaw.avoidMuscles) ? planRaw.avoidMuscles.map(String) : sore,
      exercises,
      estimatedDuration: String(planRaw.estimatedDuration || "45-55 min"),
    },
    readinessScore: score,
    readinessLabel: String(p.readinessLabel || (score >= 76 ? "Ready to push" : score >= 51 ? "Train moderately" : "Light activity only")),
    readinessDescription: String(p.readinessDescription || "Recovery and weekly volume inform today's training intensity."),
    readinessFactors,
    weeklyProgress: {
      completedSets: Number(wp.completedSets) || completed,
      targetSets: Number(wp.targetSets) || target,
      percentComplete: Number(wp.percentComplete) || pct,
      insight: String(wp.insight || `Weekly volume is at ${pct}% of target.`),
    },
    recoveryTips,
    coachingTips,
    source: typeof p.source === "string" ? p.source : undefined,
  };
}
