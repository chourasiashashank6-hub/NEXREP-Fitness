const activityMultiplier = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const goalPaceMap = {
  "Fat Loss": {
    slow: { weeklyKg: 0.25, dailyKcal: -275 },
    moderate: { weeklyKg: 0.5, dailyKcal: -550 },
    fast: { weeklyKg: 0.75, dailyKcal: -825 },
  },
  "Muscle Gain": {
    slow: { weeklyKg: 0.125, dailyKcal: 137 },
    moderate: { weeklyKg: 0.25, dailyKcal: 275 },
    fast: { weeklyKg: 0.5, dailyKcal: 550 },
  },
  Strength: {
    slow: { weeklyKg: 0.125, dailyKcal: 110 },
    moderate: { weeklyKg: 0.2, dailyKcal: 220 },
    fast: { weeklyKg: 0.375, dailyKcal: 412 },
  },
};

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeGoalTag(goalTag) {
  if (goalTag === "Fat Loss" || goalTag === "Muscle Gain" || goalTag === "Strength") return goalTag;
  return "Fat Loss";
}

function normalizeGoalPace(goalPace) {
  if (goalPace === "slow" || goalPace === "moderate" || goalPace === "fast") return goalPace;
  return "moderate";
}

function normalizeActivityLevel(level) {
  if (
    level === "sedentary" ||
    level === "light" ||
    level === "moderate" ||
    level === "active" ||
    level === "very_active"
  ) {
    return level;
  }
  return "moderate";
}

export function computeUserCaloriePlan(user) {
  const normalizedUser = {
    ...user,
    age: safeNumber(user.age, 25),
    height_cm: safeNumber(user.height_cm, 170),
    current_weight_kg: safeNumber(user.current_weight_kg, 70),
    target_weight_kg: safeNumber(user.target_weight_kg, safeNumber(user.current_weight_kg, 70)),
    goal_tag: normalizeGoalTag(user.goal_tag),
    goal_pace: normalizeGoalPace(user.goal_pace),
    activity_level: normalizeActivityLevel(user.activity_level),
  };

  let bmr;
  if (normalizedUser.gender === "male") {
    bmr =
      10 * normalizedUser.current_weight_kg +
      6.25 * normalizedUser.height_cm -
      5 * normalizedUser.age +
      5;
  } else {
    bmr =
      10 * normalizedUser.current_weight_kg +
      6.25 * normalizedUser.height_cm -
      5 * normalizedUser.age -
      161;
  }

  const storedMultiplier = user.tdee_multiplier ?? user.activity_multiplier;
  const multiplier =
    storedMultiplier != null && Number.isFinite(Number(storedMultiplier))
      ? Number(storedMultiplier)
      : activityMultiplier[normalizedUser.activity_level];
  const tdee = Math.round(bmr * multiplier);

  const paceConfig = goalPaceMap[normalizedUser.goal_tag][normalizedUser.goal_pace];
  const dailyAdjustment = paceConfig.dailyKcal;
  const dailyCalorieTarget = Math.round(tdee + dailyAdjustment);

  const weightDeltaKg = Math.abs(normalizedUser.current_weight_kg - normalizedUser.target_weight_kg);
  const weeksToGoal = paceConfig.weeklyKg > 0 ? Math.ceil(weightDeltaKg / paceConfig.weeklyKg) : 0;

  return {
    bmr: Math.round(bmr),
    tdee,
    dailyAdjustment,
    dailyCalorieTarget,
    weeklyTargetKg: paceConfig.weeklyKg,
    weeksToGoal,
  };
}

