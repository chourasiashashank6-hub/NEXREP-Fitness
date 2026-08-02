import { ACTIVITY_MULTIPLIERS } from "../constants/onboarding";
import { NutritionTargets, OnboardingData } from "../types/onboarding";

const FAT_LOSS_DEFICITS = { slow: 275, moderate: 550, aggressive: 825 } as const;
const MUSCLE_GAIN_SURPLUSES = { slow: 150, moderate: 275, aggressive: 550 } as const;
const MACRO_RATIOS = {
  fat_loss: [0.35, 0.38, 0.27],
  muscle_gain: [0.3, 0.48, 0.22],
  strength: [0.32, 0.4, 0.28],
  recomp: [0.4, 0.3, 0.3],
  maintain: [0.28, 0.45, 0.27],
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function getExerciseShare(user: OnboardingData): number {
  let share = 0.2;

  const activityAdj: Record<string, number> = {
    sedentary: -0.05,
    lightly_active: -0.02,
    moderately_active: 0,
    very_active: 0.03,
    extremely_active: 0.05,
  };
  share += activityAdj[user.activity.level || ""] ?? 0;

  const workoutsPerWeek = Number(user.activity.workouts_per_week ?? 0);
  if (workoutsPerWeek <= 1) share -= 0.05;
  else if (workoutsPerWeek <= 3) share -= 0.02;
  else if (workoutsPerWeek >= 6) share += 0.03;

  const goalAdj: Record<string, number> = {
    fat_loss: 0,
    muscle_gain: 0.05,
    strength: 0.05,
    recomp: 0.02,
    maintain: -0.02,
  };
  share += goalAdj[user.goal.type || ""] ?? 0;

  const paceAdj: Record<string, number> = {
    slow: -0.03,
    moderate: 0,
    aggressive: 0.05,
  };
  share += paceAdj[user.goal.pace || ""] ?? 0;

  const diffAdj: Record<string, number> = {
    beginner: -0.03,
    intermediate: 0,
    advanced: 0.03,
  };
  share += diffAdj[user.goal.difficulty || ""] ?? 0;

  const bodyFat = Number(user.personal.body_fat_percentage);
  if (Number.isFinite(bodyFat)) {
    if (bodyFat > 25) share -= 0.05;
    else if (bodyFat < 12) share += 0.05;
    else if (bodyFat < 18) share += 0.03;
  }

  const workoutTypes = Array.isArray(user.activity.workout_types) ? user.activity.workout_types : [];
  if (workoutTypes.includes("strength_training")) share += 0.02;
  if (workoutTypes.includes("walking") && workoutTypes.length === 1) share -= 0.02;

  return clamp(share, 0.15, 0.3);
}

export const calculateNutritionTargets = (data: OnboardingData): NutritionTargets => {
  const weightKg = data.personal.unit_system === "metric" ? (data.personal.weight_kg ?? 0) : (data.personal.weight_lb ?? 0) / 2.20462;
  const heightCm = data.personal.unit_system === "metric" ? (data.personal.height_cm ?? 0) : (data.personal.height_in ?? 0) * 2.54;
  const age = data.personal.age ?? 25;
  const sexConst = data.personal.sex === "male" ? 5 : data.personal.sex === "female" ? -161 : -78;

  let formulaUsed: "mifflin_st_jeor" | "katch_mcardle" = "mifflin_st_jeor";
  let bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + sexConst;
  if (data.personal.body_fat_percentage !== null) {
    const lbm = weightKg * (1 - data.personal.body_fat_percentage / 100);
    bmr = 370 + 21.6 * lbm;
    formulaUsed = "katch_mcardle";
  }

  const storedMultiplier = data.activity.tdee_multiplier;
  const mult =
    storedMultiplier != null && Number.isFinite(Number(storedMultiplier))
      ? Number(storedMultiplier)
      : ACTIVITY_MULTIPLIERS[data.activity.level || "moderately_active"] || 1.55;
  const tdee = bmr * mult;

  let delta = 0;
  if (data.goal.type === "fat_loss") delta = -(FAT_LOSS_DEFICITS[data.goal.pace || "moderate"]);
  else if (data.goal.type === "muscle_gain") delta = MUSCLE_GAIN_SURPLUSES[data.goal.pace || "moderate"];
  else if (data.goal.type === "recomp") delta = -250;
  else if (data.goal.type === "strength") delta = 200;

  const rawTarget = tdee + delta;
  const floor = Math.round(bmr * 1.1);
  const wasClamped = rawTarget < floor;
  const target = Math.round(wasClamped ? floor : rawTarget);

  const rawGoal = (data.goal.type || "maintain") as keyof typeof MACRO_RATIOS;
  const goalKey = rawGoal in MACRO_RATIOS ? rawGoal : "maintain";
  const [pRatio, cRatio, fRatio] = MACRO_RATIOS[goalKey];
  const proteinKcal = Math.round(target * pRatio);
  const carbsKcal = Math.round(target * cRatio);
  const fatKcal = Math.round(target * fRatio);

  const weeklyChangeKg = Math.abs(delta) * 7 / 7700;
  const exerciseShare = getExerciseShare(data);
  const dietShare = 1 - exerciseShare;
  const absDelta = Math.abs(delta);
  const exerciseAbs = Math.round(absDelta * exerciseShare);
  const dietAbs = Math.max(0, absDelta - exerciseAbs);
  const direction = delta < 0 ? -1 : delta > 0 ? 1 : 0;
  const exerciseDelta = direction * exerciseAbs;
  const dietDelta = direction * dietAbs;
  let weeks: number | null = null;
  if (data.goal.target_weight_kg && weightKg > 0 && weeklyChangeKg > 0) {
    weeks = Math.round(Math.abs(weightKg - data.goal.target_weight_kg) / weeklyChangeKg);
  }
  let completionDate: string | null = null;
  if (weeks) {
    const d = new Date();
    d.setDate(d.getDate() + weeks * 7);
    completionDate = d.toISOString().slice(0, 10);
  }

  return {
    calculated_at: new Date().toISOString(),
    formula_version: "v1.3",
    bmr: { formula_used: formulaUsed, value_kcal: Math.round(bmr) },
    tdee: { activity_multiplier: mult, value_kcal: Math.round(tdee) },
    target_kcal: target,
    macros: {
      protein_g: Math.round(proteinKcal / 4),
      protein_kcal: proteinKcal,
      protein_pct: Math.round(pRatio * 100),
      carbs_g: Math.round(carbsKcal / 4),
      carbs_kcal: carbsKcal,
      carbs_pct: Math.round(cRatio * 100),
      fat_g: Math.round(fatKcal / 9),
      fat_kcal: fatKcal,
      fat_pct: Math.round(fRatio * 100),
      fiber_g: Math.round((target / 1000) * 14),
      water_l: data.app_setup.water_intake_goal_liters ?? (mult >= 1.725 ? 3.2 : mult >= 1.55 ? 3.0 : 2.5),
    },
    timeline: {
      weeks_to_goal: weeks,
      estimated_completion_date: completionDate,
      weekly_change_kg: Number(weeklyChangeKg.toFixed(2)),
      daily_delta_kcal: delta,
      exercise_share: Number(exerciseShare.toFixed(2)),
      diet_share: Number(dietShare.toFixed(2)),
      exercise_delta_kcal: exerciseDelta,
      diet_delta_kcal: dietDelta,
      pace_label: weeks ? `~${weeklyChangeKg.toFixed(2)} kg/week` : "Performance / maintenance",
    },
    safety: {
      floor_kcal: floor,
      is_safe: !wasClamped,
      was_clamped: wasClamped,
      warning: wasClamped
        ? "Your target was below the safe minimum. It has been adjusted up to protect your metabolism and muscle mass."
        : null,
    },
    coach_message: `Your daily target is ${target} kcal. Hit ${Math.round(proteinKcal / 4)}g protein consistently and reassess every 14 days.`,
  };
};
