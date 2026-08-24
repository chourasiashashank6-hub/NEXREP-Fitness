import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SCREEN_SAFE_AREA_EDGES } from "../utils/safeAreaEdges";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import type { CalorieDayPayload } from "../api/caloriesLog";
import { getCalorieStreak, getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { resolveApiBaseUrl } from "../api/client";
import { getStrengthProgress, type StrengthProgress } from "../api/strength";
import { getWorkoutHistory } from "../api/workout";
import { DailyQuoteCard } from "../components/DailyQuoteCard";
import { MilestoneBoxes } from "../components/MilestoneBoxes";
import { TodaysGoalRing } from "../components/TodaysGoalRing";
import { useAuthStore } from "../store/authStore";
import { useOnboardingContext } from "../hooks/OnboardingContext";
import { fetchWorkoutPlanCurrent } from "../api/workoutPlanner";
import { navigationRef } from "../navigation/navigationRef";
import { computeUserCaloriePlan } from "../utils/calorieEngine";
import { resolveDailyBurnTarget } from "../utils/dailyBurnTarget";
import {
  computePlannedBurnActivities,
  computePlannedBurnTargets,
  toPreworkoutProfile,
  type PlannedBurnActivity,
} from "../utils/plannedBurnTargets";
import { isPreWorkoutEnabled } from "../utils/preWorkoutPreference";
import { fillMealSlots, buildLoggedMealMilestones } from "../utils/mealSlotSchedule";
import { buildTodaySessionMilestoneItems } from "../utils/sessionMilestoneSlots";
import {
  computeCombinedStreak,
  getLast7DaysMeta,
  getStreakMeta,
  type DayMeta,
} from "../utils/streakEngine";
import { isHomeRestDayActive, isWorkoutRestDay } from "../utils/workoutRestDay";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { setGamePlanCache } from "../store/gamePlanCache";
import { useActivityDataRefreshStore } from "../store/activityDataRefreshStore";
import { sanitizeWorkoutPlanCurrent } from "../utils/sanitizePlannerDay";
import { resolveBurnTargetWeightKg } from "../utils/resolveBurnTargetWeightKg";
import {
  deriveTodaysGoalPendingItems,
  formatTodaysGoalPendingLabel,
  plannedBurnBreakdownFromActivities,
} from "../utils/todaysGoalRing";
import { summarizeTodayBurnActuals } from "../utils/todayBurnActuals";
import type { WorkoutPlanCurrent } from "../types/planner";

interface LatestWeightData {
  weight_kg: number;
  weight_lb: number;
  log_date: string | null;
  days_since_log: number | null;
  has_logs: boolean;
}

interface WeightEntry {
  weight_kg: number;
  log_date: string;
}

interface GoalProgressData {
  weeks_to_goal?: number | null;
  weekly_change_kg?: number | null;
  daily_delta_kcal?: number | null;
  exercise_share?: number | null;
  diet_share?: number | null;
  exercise_delta_kcal?: number | null;
  diet_delta_kcal?: number | null;
  total_change_kg?: number | null;
  weight_change_label?: string | null;
  needs_weigh_in?: boolean;
  journey_started_at?: string | null;
  timeline?: Record<string, unknown>;
}

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FEF1EE";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const BG = "#F7F6F3";
const CARD = "#FFFFFF";
const TEXT_PRIMARY = "#1A1A18";
const TEXT_MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const STREAK_LOOKBACK_DAYS = 60;
const FOCUS_STALE_MS = 45_000;

type BurnProfile = {
  name: string;
  gender: "male" | "female";
  age: number;
  height_cm: number;
  current_weight_kg: number;
  target_weight_kg: number;
  goal_tag: "Fat Loss" | "Muscle Gain" | "Strength";
  goal_pace: "slow" | "moderate" | "fast";
  activity_level: "sedentary" | "light" | "moderate" | "active" | "very_active";
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const formatNum = (v: number) => Math.round(v || 0).toLocaleString();
type EnergyMode = "deficit" | "surplus" | "maintenance";

const parseServerDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(raw) && !/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

function toBurnProfile(onboarding: any): BurnProfile | null {
  if (!onboarding || typeof onboarding !== "object") return null;
  const personal = onboarding.personal || {};
  const goal = onboarding.goal || {};
  const activity = onboarding.activity || {};
  const name = typeof personal.name === "string" ? personal.name.trim() : "";
  const age = Number(personal.age);
  const heightCm = Number(personal.height_cm);
  const weightKg = Number(personal.weight_kg);
  const targetKg = Number(goal.target_weight_kg || personal.weight_kg);
  if (!name || !Number.isFinite(age) || !Number.isFinite(heightCm) || !Number.isFinite(weightKg)) return null;

  const goalTypeMap: Record<string, BurnProfile["goal_tag"]> = {
    fat_loss: "Fat Loss",
    muscle_gain: "Muscle Gain",
    strength: "Strength",
  };
  const paceMap: Record<string, BurnProfile["goal_pace"]> = {
    slow: "slow",
    moderate: "moderate",
    aggressive: "fast",
    fast: "fast",
  };
  const activityMap: Record<string, BurnProfile["activity_level"]> = {
    sedentary: "sedentary",
    lightly_active: "light",
    moderate: "moderate",
    moderately_active: "moderate",
    very_active: "active",
    extremely_active: "very_active",
    active: "active",
  };

  const gender = personal.sex === "male" ? "male" : "female";
  const goalTag = goalTypeMap[String(goal.type || "").toLowerCase()] || "Fat Loss";
  const goalPace = paceMap[String(goal.pace || "").toLowerCase()] || "moderate";
  const activityLevel = activityMap[String(activity.level || "").toLowerCase()] || "moderate";

  return {
    name,
    gender,
    age,
    height_cm: heightCm,
    current_weight_kg: weightKg,
    target_weight_kg: Number.isFinite(targetKg) ? targetKg : weightKg,
    goal_tag: goalTag,
    goal_pace: goalPace,
    activity_level: activityLevel,
  };
}

function streakTileStyle(meta: DayMeta) {
  if (meta.isToday) {
    return { backgroundColor: CARD, borderColor: GREEN, color: GREEN, borderWidth: 2 as const };
  }
  if (meta.foodLogged && meta.workoutDone) {
    return { backgroundColor: GREEN, borderColor: GREEN, color: CARD, borderWidth: 0 as const };
  }
  if (meta.foodLogged) {
    return { backgroundColor: GREEN_LIGHT, borderColor: GREEN_LIGHT, color: GREEN, borderWidth: 0 as const };
  }
  if (meta.workoutDone) {
    return { backgroundColor: "#FFF1EE", borderColor: "#FFF1EE", color: ORANGE, borderWidth: 0 as const };
  }
  return { backgroundColor: "#ECEAE5", borderColor: "#ECEAE5", color: "#bbb", borderWidth: 0 as const };
}

function StreakDayColumn({ meta }: { meta: DayMeta }) {
  const tile = streakTileStyle(meta);
  return (
    <View style={styles.streakDayCol}>
      <View style={styles.streakDots}>
        <View style={[styles.streakDot, { backgroundColor: meta.foodLogged ? GREEN : TRACK }]} />
        <View style={[styles.streakDot, { backgroundColor: meta.workoutDone ? ORANGE : TRACK }]} />
      </View>
      <View
        style={[
          styles.streakDateTile,
          {
            backgroundColor: tile.backgroundColor,
            borderColor: tile.borderColor,
            borderWidth: tile.borderWidth,
          },
        ]}
      >
        <Text style={[styles.streakDateNum, { color: tile.color }]}>{meta.dayNum}</Text>
      </View>
      <Text style={[styles.streakDayLabel, meta.isToday && styles.streakDayLabelToday]}>
        {meta.isToday ? i18n.t("streak.days.today") : meta.dayLabel}
      </Text>
    </View>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  const widthPct = `${Math.round(clamp01(percent) * 100)}%` as `${number}%`;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: widthPct, backgroundColor: color }]} />
    </View>
  );
}

export const HomeScreen = () => {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const { refresh: refreshOnboarding, data: onboardingData } = useOnboardingContext();
  const { hasFeatureAccess } = useFeatureAccess();
  const hasMealPlannerAccess = hasFeatureAccess("meal_plan_generation");
  const hasWorkoutPlannerAccess = hasFeatureAccess("workout_plan_generation");
  const [calorieDay, setCalorieDay] = useState<CalorieDayPayload | null>(null);
  const [burnProfile, setBurnProfile] = useState<BurnProfile | null>(null);
  const [mealsPerDay, setMealsPerDay] = useState(3);
  const [todayWorkoutPlan, setTodayWorkoutPlan] = useState<WorkoutPlanCurrent | null>(null);
  const [totalWorkoutBurn, setTotalWorkoutBurn] = useState(0);
  const [timelineTargets, setTimelineTargets] = useState<Record<string, unknown> | null>(null);
  const [latestWeight, setLatestWeight] = useState<LatestWeightData | null>(null);
  const [weightHistory, setWeightHistory] = useState<WeightEntry[]>([]);
  const [goalProgress, setGoalProgress] = useState<GoalProgressData | null>(null);
  const [strengthProgress, setStrengthProgress] = useState<StrengthProgress | null>(null);
  const [showWeighInModal, setShowWeighInModal] = useState(false);
  const [weighInValue, setWeighInValue] = useState("");
  const [isLoggingWeight, setIsLoggingWeight] = useState(false);
  const [workoutHistory, setWorkoutHistory] = useState<
    { date: string; caloriesBurned: number; exerciseName?: string; id?: number; notes?: string | null }[]
  >([]);
  const [streakCalorieLogs, setStreakCalorieLogs] = useState<{ date: string; total_calories: number }[]>([]);
  const [personalBestStreak, setPersonalBestStreak] = useState(0);
  const [burnChipsExpanded, setBurnChipsExpanded] = useState(true);
  const lastLoadAt = useRef(0);
  const activityRefreshVersion = useActivityDataRefreshStore((s) => s.version);

  const sectionAnim = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      80,
      sectionAnim.map((a) =>
        Animated.timing(a, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ),
    ).start();
  }, [sectionAnim]);

  const isSameLocalDay = (isoDate: string, day: Date): boolean => {
    const d = parseServerDate(isoDate);
    if (!d) return false;
    return (
      d.getFullYear() === day.getFullYear() &&
      d.getMonth() === day.getMonth() &&
      d.getDate() === day.getDate()
    );
  };

  const load = useCallback(async () => {
    if (!token) {
      setCalorieDay(null);
      setBurnProfile(null);
      setMealsPerDay(3);
      setTodayWorkoutPlan(null);
      setTotalWorkoutBurn(0);
      setTimelineTargets(null);
      setLatestWeight(null);
      setWeightHistory([]);
      setGoalProgress(null);
      setStrengthProgress(null);
      setWorkoutHistory([]);
      setStreakCalorieLogs([]);
      setPersonalBestStreak(0);
      return;
    }
    const apiBase = resolveApiBaseUrl();
    const authHeaders = { Authorization: `Bearer ${token}` };
    try {
      const [dayRes, onboardingRes, historyRes, weightLatestRes, weightHistoryRes, goalProgressRes, strengthProgressRes, workoutPlanRes] =
        await Promise.all([
          getDailyCalorieLog(todayLocal()).catch(() => null),
          // Shared with OnboardingContext (and every other screen using it) instead of an
          // independent fetchOnboardingMe() call — see OnboardingContext.refresh().
          refreshOnboarding().catch(() => null),
          getWorkoutHistory(24 * 7).catch(() => ({ items: [] })),
          fetch(`${apiBase}/api/weight/latest`, { headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${apiBase}/api/weight/history?days=60`, { headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${apiBase}/api/goal-progress?local_date=${todayLocal()}`, { headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          getStrengthProgress().catch(() => null),
          fetchWorkoutPlanCurrent().catch(() => null),
        ]);
      const today = new Date();
      const todayWorkoutBurn = (historyRes.items ?? []).reduce((sum, item) => {
        if (!item?.date || !isSameLocalDay(item.date, today)) return sum;
        return sum + (Number(item.caloriesBurned) || 0);
      }, 0);
      setCalorieDay(dayRes);
      setBurnProfile(toBurnProfile(onboardingRes?.onboarding));
      setMealsPerDay(Number(onboardingRes?.onboarding?.dietary?.meals_per_day ?? 3) || 3);
      const sanitizedWorkoutPlan = sanitizeWorkoutPlanCurrent(workoutPlanRes);
      setTodayWorkoutPlan(sanitizedWorkoutPlan);
      setTotalWorkoutBurn(Math.max(0, Math.round(todayWorkoutBurn)));
      setTimelineTargets((onboardingRes?.targets as Record<string, unknown>) ?? null);
      setLatestWeight(weightLatestRes);
      setWeightHistory(weightHistoryRes?.entries ?? []);
      setGoalProgress(goalProgressRes);
      setStrengthProgress(strengthProgressRes);

      const todayKey = todayLocal();
      const [streakWorkoutRes, streakRes] = await Promise.all([
        getWorkoutHistory(24 * STREAK_LOOKBACK_DAYS).catch(() => ({ items: [] })),
        // Single bulk call replacing what used to be one getDailyCalorieLog() request per day.
        getCalorieStreak(STREAK_LOOKBACK_DAYS, todayKey).catch(() => null),
      ]);

      const calorieLogsForStreak = (streakRes?.days ?? []).map((d) => ({
        date: d.date,
        total_calories: Number(d.total_calories ?? 0),
      }));

      const workoutItems = (streakWorkoutRes.items ?? []).map((item) => ({
        date: item.date,
        caloriesBurned: Number(item.caloriesBurned) || 0,
        exerciseName: String(item.exerciseName || ""),
        id: item.id,
        notes: item.notes,
      }));

      // Merge the 7-day history fetch so today's workouts always match the burn bar.
      for (const item of historyRes.items ?? []) {
        if (!item?.date) continue;
        workoutItems.push({
          date: item.date,
          caloriesBurned: Number(item.caloriesBurned) || 0,
          exerciseName: String(item.exerciseName || ""),
          id: item.id,
          notes: item.notes,
        });
      }

      setWorkoutHistory(workoutItems);
      setStreakCalorieLogs(calorieLogsForStreak);

      setPersonalBestStreak(Math.max(0, Number(streakRes?.personal_best_streak ?? 0)));

      const cachedWeightKg = resolveBurnTargetWeightKg({
        weightLatest: weightLatestRes,
        profileWeightKg: weightLatestRes?.has_logs ? undefined : weightLatestRes?.weight_kg,
        onboardingWeightKg: onboardingRes?.onboarding?.personal?.weight_kg,
      });
      setGamePlanCache({
        calorieDay: dayRes,
        todayWorkoutPlan: sanitizedWorkoutPlan,
        workoutHistory: (historyRes.items ?? []).map((item) => ({
          date: item.date,
          exerciseName: item.exerciseName,
          type: item.type,
          notes: item.notes,
          bodyPart: item.bodyPart,
        })),
        weightKg: cachedWeightKg,
      });

      lastLoadAt.current = Date.now();
    } catch {
      Alert.alert(t("home.alerts.error"), t("home.alerts.loadFailed"));
    }
  }, [token, t, refreshOnboarding]);

  const handleLogWeight = async () => {
    const kg = parseFloat(weighInValue);
    if (!kg || kg <= 0 || kg > 500) {
      Alert.alert(t("home.alerts.invalid"), t("home.alerts.invalidWeight"));
      return;
    }

    if (!token) return;

    setIsLoggingWeight(true);
    const apiBase = resolveApiBaseUrl();
    try {
      const res = await fetch(`${apiBase}/api/weight/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          weight_kg: kg,
          log_date: todayLocal(),
          unit_system: "metric",
        }),
      });

      if (!res.ok) throw new Error(t("home.alerts.saveFailed"));
      const data = await res.json();

      setLatestWeight({
        weight_kg: kg,
        weight_lb: data.weight_lb,
        log_date: todayLocal(),
        days_since_log: 0,
        has_logs: true,
      });

      setWeightHistory((prev) => {
        const withoutToday = prev.filter((e) => e.log_date !== todayLocal());
        return [...withoutToday, { weight_kg: kg, log_date: todayLocal() }];
      });

      if (data.change_label) {
        Alert.alert(t("home.alerts.logged"), data.change_label);
      }

      setShowWeighInModal(false);

      const newGoalProgress = await fetch(`${apiBase}/api/goal-progress?local_date=${todayLocal()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (newGoalProgress) setGoalProgress(newGoalProgress);
    } catch {
      Alert.alert(t("home.alerts.error"), t("home.alerts.saveWeightFailed"));
    } finally {
      setIsLoggingWeight(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (lastLoadAt.current > 0 && now - lastLoadAt.current < FOCUS_STALE_MS) {
        return;
      }
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (activityRefreshVersion === 0) return;
    lastLoadAt.current = 0;
    void load();
  }, [activityRefreshVersion, load]);

  const log = calorieDay?.log;
  const intake = Number(log?.total_calories || 0);
  const targetKcal = Number(log?.target_calories || 0);
  const caloriesBurnedSoFar = Math.max(0, Math.round(totalWorkoutBurn));
  const burnTargetWeightKg = resolveBurnTargetWeightKg({
    weightLatest: latestWeight,
    profileWeightKg: latestWeight?.has_logs ? undefined : latestWeight?.weight_kg,
    onboardingWeightKg: burnProfile?.current_weight_kg,
  });
  const burnPlan = burnProfile
    ? computeUserCaloriePlan({ ...burnProfile, current_weight_kg: burnTargetWeightKg })
    : null;
  const eatenToday = Number.isFinite(intake) ? Math.round(intake) : 0;
  // Authoritative kcal from calorie_log_targets via daily log API (same as Meal Planner).
  const dailyGoal = Math.max(1, Math.round(targetKcal || burnPlan?.dailyCalorieTarget || 1800));
  const remainingBurnTarget = Math.max(0, eatenToday - dailyGoal - caloriesBurnedSoFar);
  const netCalorieGap = eatenToday - dailyGoal - caloriesBurnedSoFar;
  const remainingIntakeToGoal = netCalorieGap < 0 ? Math.abs(netCalorieGap) : 0;
  const needsBurnFromExercise = netCalorieGap > 0;
  const summaryTargetLabel = needsBurnFromExercise ? t("home.stillToBurn") : t("home.remainingIntake");
  const summaryTargetValue = needsBurnFromExercise ? remainingBurnTarget : remainingIntakeToGoal;
  const summaryTargetPercent = dailyGoal > 0 ? clamp01(summaryTargetValue / dailyGoal) : 0;
  const timeline =
    (goalProgress?.timeline as Record<string, unknown> | undefined) ??
    (timelineTargets?.timeline as Record<string, unknown> | undefined) ??
    {};
  const weeksToGoalRaw = Number(goalProgress?.weeks_to_goal ?? timeline.weeks_to_goal);
  const weeksRemaining = Number.isFinite(weeksToGoalRaw) ? Math.max(0, Math.round(weeksToGoalRaw)) : 12;
  const initialWeeksRaw = Number(
    (timelineTargets?.timeline as Record<string, unknown> | undefined)?.weeks_to_goal ?? timeline.weeks_to_goal,
  );
  const totalGoalWeeks =
    Number.isFinite(initialWeeksRaw) && initialWeeksRaw > 0
      ? Math.round(initialWeeksRaw)
      : weeksRemaining > 0
        ? weeksRemaining
        : 26;
  const weeksToGoal = weeksRemaining;
  const weeklyChangeRaw = goalProgress?.weekly_change_kg ?? timeline.weekly_change_kg ?? timeline.weekly_delta_kg;
  const weeklyDelta = Number(weeklyChangeRaw);
  const paceLabel = Number.isFinite(weeklyDelta) ? t("home.pace", { value: Math.abs(weeklyDelta).toFixed(2) }) : t("home.defaultPace");
  const journeyStartedAt: string | null = goalProgress?.journey_started_at ?? null;
  const journeyStartedLabel: string | null = (() => {
    if (!journeyStartedAt) return null;
    try {
      const d = new Date(`${journeyStartedAt}T12:00:00Z`);
      return d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return null;
    }
  })();
  const dailyDelta = Number(goalProgress?.daily_delta_kcal ?? timeline.daily_delta_kcal);
  const deltaDisplay = Number.isFinite(dailyDelta) ? Math.round(Math.abs(dailyDelta)) : 200;
  const exerciseShare = Number(goalProgress?.exercise_share ?? timeline.exercise_share);
  const dietShare = Number(goalProgress?.diet_share ?? timeline.diet_share);
  const restDayActive = useMemo(
    () =>
      isHomeRestDayActive({
        hasWorkoutPlannerAccess,
        plan: todayWorkoutPlan,
      }),
    [hasWorkoutPlannerAccess, todayWorkoutPlan],
  );
  const exerciseDeltaDisplay = resolveDailyBurnTarget({
    exercise_delta_kcal: goalProgress?.exercise_delta_kcal,
    daily_delta_kcal: goalProgress?.daily_delta_kcal,
    timeline: timeline as Record<string, unknown>,
  });
  const minBurnTarget = exerciseDeltaDisplay;
  const preWorkoutEnabled = isPreWorkoutEnabled(onboardingData);
  const preworkoutProfile = useMemo(
    () => (preWorkoutEnabled ? toPreworkoutProfile(onboardingData, burnTargetWeightKg) : null),
    [onboardingData, burnTargetWeightKg, preWorkoutEnabled],
  );
  const plannedBurnTargets = useMemo(() => {
    const activities = computePlannedBurnActivities({
      restDayActive,
      hasWorkoutPlannerAccess,
      todayWorkoutPlan,
      preworkoutProfile,
      preWorkoutEnabled,
      weightKg: burnTargetWeightKg,
    });
    return computePlannedBurnTargets({
      minBurnTarget,
      activities,
    });
  }, [
    restDayActive,
    hasWorkoutPlannerAccess,
    todayWorkoutPlan,
    preworkoutProfile,
    preWorkoutEnabled,
    burnTargetWeightKg,
    minBurnTarget,
  ]);
  const bestResultsBurnTarget = plannedBurnTargets.bestResultsBurnTarget;
  const plannedBurnActivities = plannedBurnTargets.activities;
  const plannedBurnChipLabel = useCallback(
    (activity: PlannedBurnActivity) => {
      if (activity.kind === "cardioWarmup") return t("home.burnChipCardio");
      return activity.sessionLabel.trim() || t("home.burnChipWorkout");
    },
    [t],
  );
  const goalPendingLabel = useMemo(() => {
    const items = deriveTodaysGoalPendingItems({
      caloriesEatenToday: eatenToday,
      dailyCalorieTarget: dailyGoal,
      caloriesBurnedToday: caloriesBurnedSoFar,
      dailyBurnTarget: bestResultsBurnTarget,
      restDayActive,
      plannedBurn: plannedBurnBreakdownFromActivities(plannedBurnActivities),
      todayBurnActuals: summarizeTodayBurnActuals(workoutHistory, isSameLocalDay),
    });
    return formatTodaysGoalPendingLabel(items, {
      "warm-up": t("home.goalPendingWarmup"),
      workout: t("home.goalPendingWorkout"),
      intake: t("home.goalPendingIntake"),
    }, t("home.goalPendingPrefix"));
  }, [
    eatenToday,
    dailyGoal,
    caloriesBurnedSoFar,
    bestResultsBurnTarget,
    restDayActive,
    plannedBurnActivities,
    workoutHistory,
    t,
  ]);
  const dietDeltaDisplay = Math.max(0, deltaDisplay - exerciseDeltaDisplay);
  const exerciseSharePct = Number.isFinite(exerciseShare) ? clamp01(exerciseShare) : 0.2;
  const dietSharePct = Number.isFinite(dietShare) ? clamp01(dietShare) : 0.8;
  const defaultDeltaLabel =
    burnProfile?.goal_tag === "Muscle Gain"
      ? t("home.surplus")
      : burnProfile?.goal_tag === "Strength"
        ? t("home.maintenance")
        : t("home.deficit");
  const dailyDeltaLabel = !Number.isFinite(dailyDelta)
    ? defaultDeltaLabel
    : dailyDelta < 0
      ? t("home.deficit")
      : dailyDelta > 0
        ? t("home.surplus")
        : t("home.maintenance");
  const deltaKpiLabel = dailyDeltaLabel.toLowerCase();
  const deficitTrendIcon =
    Number.isFinite(dailyDelta) && dailyDelta > 0
      ? "trending-up"
      : Number.isFinite(dailyDelta) && dailyDelta < 0
        ? "trending-down"
        : "remove-outline";
  const goalWeeksProgress =
    totalGoalWeeks > 0 ? clamp01((totalGoalWeeks - weeksRemaining) / totalGoalWeeks) : 0;
  const workoutShareAchieved = Math.min(caloriesBurnedSoFar, exerciseDeltaDisplay);
  const exerciseTargetRemaining = Math.max(0, exerciseDeltaDisplay - workoutShareAchieved);
  const workoutShareProgress = exerciseDeltaDisplay > 0 ? clamp01(workoutShareAchieved / exerciseDeltaDisplay) : 1;
  const mode: EnergyMode = dailyGoal < (burnPlan?.tdee ?? 0) ? "deficit" : dailyGoal > (burnPlan?.tdee ?? 0) ? "surplus" : "maintenance";
  const remainingExercise = Math.max(0, exerciseDeltaDisplay - caloriesBurnedSoFar);
  const exerciseProgressPct = Math.round(clamp01(exerciseDeltaDisplay > 0 ? caloriesBurnedSoFar / exerciseDeltaDisplay : 1) * 100);
  const interpreter = (() => {
    if (mode === "deficit") {
      return {
        headline: remainingExercise > 0 ? t("home.burnRemaining", { calories: formatNum(remainingExercise) }) : t("home.exerciseGoalCompleted"),
        subtext: t("home.exerciseDeficit"),
        progressLabel: t("home.fatLossProgress"),
      };
    }
    if (mode === "surplus") {
      return {
        headline: exerciseProgressPct >= 100 ? t("home.workoutTargetAchieved") : t("home.trainingProgress", { percent: exerciseProgressPct }),
        subtext: t("home.trainingSupportsGrowth"),
        progressLabel: t("home.trainingStimulus"),
      };
    }
    return {
      headline: t("home.balancedDay"),
      subtext: t("home.energyBalance"),
      progressLabel: t("home.dailyBalance"),
    };
  })();

  const animatedStyle = (idx: number) => ({
    opacity: sectionAnim[idx],
    transform: [{ translateY: sectionAnim[idx].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  const needsWeighIn =
    goalProgress?.needs_weigh_in === true ||
    (latestWeight != null && (latestWeight.days_since_log === null || latestWeight.days_since_log >= 7));

  const tdeeValue = burnPlan?.tdee ?? 1690;
  const milestonePct = Math.round(goalWeeksProgress * 100);

  const mealMilestoneItems = useMemo(() => {
    const allMeals = calorieDay?.meals ?? [];
    const meals = hasMealPlannerAccess
      ? allMeals
      : allMeals.filter((m) => m.source_type !== "meal_planner");
    const sourceLabel = (sourceType?: "database" | "camera_ai" | "meal_planner") => {
      if (!sourceType) return undefined;
      if (sourceType === "meal_planner") return t("home.mealSource.planner");
      if (sourceType === "camera_ai") return t("home.mealSource.scan");
      return t("home.mealSource.manual");
    };
    const extraMealLabel = (mealType: string) => {
      if (mealType === "Snack") return t("calorieLog.mealLabels.snacks");
      if (mealType === "Breakfast") return t("calorieLog.mealLabels.breakfast");
      if (mealType === "Lunch") return t("calorieLog.mealLabels.lunch");
      if (mealType === "Dinner") return t("calorieLog.mealLabels.dinner");
      if (mealType === "Pre_Workout") return t("calorieLog.mealLabels.preWorkout");
      if (mealType === "Post_Workout") return t("calorieLog.mealLabels.postWorkout");
      return mealType.replace(/_/g, " ");
    };
    const mapSlots = (slots: ReturnType<typeof fillMealSlots>) =>
      slots.map((item) => ({
        key: item.key,
        label: item.isExtra ? extraMealLabel(item.mealType ?? item.label) : item.label,
        filled: item.filled,
        sourceLabel: item.filled ? sourceLabel(item.sourceType) : undefined,
      }));

    if (!hasMealPlannerAccess) {
      return mapSlots(buildLoggedMealMilestones(meals));
    }
    return mapSlots(fillMealSlots(mealsPerDay, meals));
  }, [hasMealPlannerAccess, mealsPerDay, calorieDay?.meals, t]);

  const sessionMilestoneItems = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const items = buildTodaySessionMilestoneItems({
      hasWorkoutPlannerAccess,
      todayWorkoutPlan,
      workoutHistory,
      todayKey,
    });
    if (!hasWorkoutPlannerAccess) {
      return items.map((item) => ({
        ...item,
        sourceLabel: t("home.mealSource.manual"),
      }));
    }
    return items.map((item) =>
      item.isExtra
        ? { ...item, sourceLabel: t("workoutLog.extraExerciseBadge") }
        : item,
    );
  }, [hasWorkoutPlannerAccess, todayWorkoutPlan, workoutHistory, t]);

  // Only show rest-day empty state when Elite + generated plan + today rest —
  // not merely because there are 0 scheduled exercises (e.g. no plan yet).
  const sessionsRestMessage = restDayActive ? t("home.restDayNoSession") : null;

  const openWeighInModal = () => {
    setWeighInValue(String(latestWeight?.weight_kg || ""));
    setShowWeighInModal(true);
  };

  const streakMeta = useMemo(() => {
    const streak = computeCombinedStreak(streakCalorieLogs, workoutHistory);
    return getStreakMeta(streak);
  }, [streakCalorieLogs, workoutHistory]);

  const last7Days = useMemo(
    () => getLast7DaysMeta(streakCalorieLogs, workoutHistory),
    [streakCalorieLogs, workoutHistory],
  );

  const displayBestStreak = Math.max(personalBestStreak, streakMeta.streak);
  const isStrengthGoal = burnProfile?.goal_tag === "Strength";
  const strengthLiftCount = strengthProgress?.lifts.length ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={SCREEN_SAFE_AREA_EDGES}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={animatedStyle(0)}>
          <View style={styles.greetingRow}>
            <View style={styles.greetingLeft}>
              <View>
                <Text style={styles.greetingName}>
                  <Text style={styles.brandTextNex}>Nex</Text>
                  <Text style={styles.brandTextRep}>Rep</Text>
                </Text>
                <Text style={styles.brandTagline}>{t("home.brandTagline")}</Text>
              </View>
            </View>
          </View>

          <View style={styles.streakCard}>
            <View style={styles.streakTopRow}>
              <View style={styles.streakBadgeLeft}>
                <View style={styles.streakEmojiTile}>
                  <Text style={styles.streakEmoji}>{streakMeta.emoji}</Text>
                </View>
                <View style={styles.streakBadgeText}>
                  <Text style={styles.streakCountLine}>
                    {t("home.streakLine", { count: streakMeta.streak, plural: streakMeta.streak === 1 ? "" : "s" })}
                  </Text>
                  <Text style={styles.streakMotivation}>{streakMeta.label}</Text>
                </View>
              </View>
              <View style={styles.streakBestCol}>
                <Text style={styles.streakBestLabel}>{t("home.best")}</Text>
                <Text style={styles.streakBestValue}>
                  {displayBestStreak} 🏆
                </Text>
              </View>
            </View>

            <View style={styles.streakDivider} />

            <View style={styles.streakWeekRow}>
              {last7Days.map((day) => (
                <StreakDayColumn key={day.date} meta={day} />
              ))}
            </View>

            <View style={styles.streakLegendRow}>
              <View style={styles.streakLegendItem}>
                <View style={[styles.streakLegendDot, { backgroundColor: GREEN }]} />
                <Text style={styles.streakLegendText}>{t("home.foodLogged")}</Text>
              </View>
              <Text style={styles.streakLegendSep}>·</Text>
              <View style={styles.streakLegendItem}>
                <View style={[styles.streakLegendDot, { backgroundColor: ORANGE }]} />
                <Text style={styles.streakLegendText}>{t("home.workoutDone")}</Text>
              </View>
              <Text style={styles.streakLegendSep}>·</Text>
              <View style={styles.streakLegendItem}>
                <View style={[styles.streakLegendDot, { backgroundColor: TRACK }]} />
                <Text style={styles.streakLegendText}>{t("home.missed")}</Text>
              </View>
            </View>

            <Pressable
              style={styles.gamePlanBtn}
              onPress={() => {
                if (navigationRef.isReady()) navigationRef.navigate("DailyGamePlan");
              }}
              accessibilityRole="button"
              accessibilityLabel={t("home.gamePlan.openButton")}
            >
              <Ionicons name="sparkles" size={16} color={PURPLE} />
              <Text style={styles.gamePlanBtnText}>{t("home.gamePlan.openButton")}</Text>
            </Pressable>
          </View>
        </Animated.View>

        {needsWeighIn ? (
          <Animated.View style={animatedStyle(1)}>
            <TouchableOpacity style={styles.weighInPrompt} onPress={openWeighInModal} activeOpacity={0.85}>
              <Text style={styles.weighInEmoji}>⚖️</Text>
              <Text style={styles.weighInPromptText}>{t("home.weighInPrompt")}</Text>
              <Text style={styles.weighInPromptAction}>{t("home.logAction")}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        <Animated.View style={[styles.section, animatedStyle(2)]}>
            <View style={styles.goalCard}>
              <View style={styles.heroRow}>
                <TodaysGoalRing
                  caloriesEatenToday={eatenToday}
                  dailyCalorieTarget={dailyGoal}
                  caloriesBurnedToday={caloriesBurnedSoFar}
                  dailyBurnTarget={bestResultsBurnTarget}
                  restDayActive={restDayActive}
                  size={168}
                />
                <View style={styles.kpiColumn}>
                  <View style={styles.metricsCard}>
                    <View style={styles.metricsRow}>
                      <View style={styles.metricsRowLeft}>
                        <Ionicons name="restaurant-outline" size={15} color={TEXT_MUTED} />
                        <Text style={styles.metricsRowLabel}>{t("home.toEat")}</Text>
                      </View>
                      <Text style={styles.metricsRowValue}>{formatNum(dailyGoal)}</Text>
                    </View>

                    <View style={styles.metricsRow}>
                      <View style={styles.metricsRowLeft}>
                        <Ionicons name={deficitTrendIcon} size={15} color={TEXT_MUTED} />
                        <Text style={styles.metricsRowLabel}>{deltaKpiLabel}</Text>
                      </View>
                      <Text style={styles.metricsRowValue}>{formatNum(deltaDisplay)}</Text>
                    </View>

                    <View style={styles.metricsDivider} />

                    {restDayActive ? (
                      <View style={styles.metricsRowBurn}>
                        <View style={styles.metricsRowLeft}>
                          <Ionicons name="moon-outline" size={15} color={TEXT_MUTED} />
                          <Text style={styles.metricsRowLabel}>{t("home.restDayNoBurn")}</Text>
                        </View>
                      </View>
                    ) : (
                      <>
                        <Pressable
                          style={styles.metricsRowBurn}
                          onPress={
                            plannedBurnActivities.length > 0
                              ? () => setBurnChipsExpanded((prev) => !prev)
                              : undefined
                          }
                          accessibilityRole="button"
                          accessibilityState={{ expanded: burnChipsExpanded }}
                        >
                          <View style={styles.metricsRowLeft}>
                            <Ionicons name="flame" size={16} color={ORANGE} />
                            <Text style={styles.metricsBurnLabel}>{t("home.toBurn")}</Text>
                          </View>
                          <View style={styles.metricsBurnRight}>
                            <Text style={styles.metricsBurnValue}>{formatNum(bestResultsBurnTarget)}</Text>
                            <Text style={styles.metricsBurnMin}>
                              {t("home.burnMinSuffix", { min: formatNum(minBurnTarget) })}
                            </Text>
                            {plannedBurnActivities.length > 0 ? (
                              <Ionicons
                                name="chevron-down"
                                size={14}
                                color={TEXT_MUTED}
                                style={{
                                  transform: [{ rotate: burnChipsExpanded ? "0deg" : "-90deg" }],
                                }}
                              />
                            ) : null}
                          </View>
                        </Pressable>
                        {burnChipsExpanded && plannedBurnActivities.length > 0 ? (
                          <View style={styles.burnChipRow}>
                            {plannedBurnActivities.map((activity) => (
                              <View key={activity.id} style={styles.burnChip}>
                                <Ionicons
                                  name={activity.kind === "cardioWarmup" ? "walk" : "barbell"}
                                  size={12}
                                  color={TEXT_MUTED}
                                />
                                <Text style={styles.burnChipText} numberOfLines={1}>
                                  {`${plannedBurnChipLabel(activity)} +${activity.kcal}`}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                </View>
              </View>
              {goalPendingLabel ? (
                <>
                  <View style={styles.goalPendingDivider} />
                  <Text style={styles.goalPendingText}>{goalPendingLabel}</Text>
                </>
              ) : null}
            </View>
          </Animated.View>

        <Animated.View style={[styles.section, animatedStyle(3)]}>
            <View style={styles.tdeeCard}>
              <View style={styles.tdeeLeft}>
                <View style={styles.tdeeTitleRow}>
                  <Text style={styles.tdeeEmoji}>⚡</Text>
                  <Text style={styles.tdeeTitle}>{t("home.tdee")}</Text>
                </View>
                <View style={styles.tdeePill}>
                  <Text style={styles.tdeePillText}>{t("home.tdeeFull")}</Text>
                </View>
                <Text style={styles.tdeeDesc}>{t("home.tdeeDescription")}</Text>
              </View>
              <View style={styles.tdeeRight}>
                <Text style={styles.tdeeValue}>{formatNum(tdeeValue)}</Text>
                <Text style={styles.tdeeUnit}>{t("home.kcalPerDay")}</Text>
              </View>
            </View>

            <MilestoneBoxes
              title={t("home.mealsLoggedToday")}
              items={mealMilestoneItems}
              accent="green"
              emptyMessage={mealMilestoneItems.length === 0 ? t("calorieLog.emptyMeals") : null}
            />
            <MilestoneBoxes
              title={t("home.sessionsDoneToday")}
              items={sessionMilestoneItems}
              accent="orange"
              emptyMessage={
                sessionsRestMessage ??
                (sessionMilestoneItems.length === 0 ? t("home.emptySessions") : null)
              }
            />
          </Animated.View>

        <Animated.View style={[styles.section, animatedStyle(4)]}>
          {isStrengthGoal ? (
            <View style={styles.barCard}>
              <View style={styles.barHeader}>
                <Text style={styles.barTitle}>{t("home.strengthGoal")}</Text>
                <Text style={styles.milestonePct}>{strengthProgress?.overall_percent ?? 0}%</Text>
              </View>
              {strengthProgress?.has_target_lifts ? (
                <>
                  <ProgressBar percent={(strengthProgress.overall_percent ?? 0) / 100} color={GREEN} />
                  <Text style={styles.goalFooter}>
                    {t("home.strengthFooter", { weeks: strengthProgress.weeks_left ?? weeksToGoal, count: strengthLiftCount, plural: strengthLiftCount === 1 ? "" : "s" })}
                  </Text>
                </>
              ) : (
                <View style={styles.strengthEmptyBox}>
                  <Text style={styles.strengthEmptyTitle}>{t("home.strengthEmptyTitle")}</Text>
                  <Text style={styles.strengthEmptyText}>
                    {t("home.strengthEmptyBody")}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.barCard}>
              <View style={styles.barHeader}>
                <Text style={styles.barTitle}>{t("home.weekGoal", { weeks: totalGoalWeeks })}</Text>
                <Text style={styles.milestonePct}>{milestonePct}%</Text>
              </View>
              <ProgressBar percent={goalWeeksProgress} color={GREEN} />
              <Text style={styles.goalFooter}>
                {t("home.goalFooter", { weeks: weeksToGoal, pace: paceLabel })}
              </Text>
              {journeyStartedLabel != null ? (
                <Text style={styles.goalStartedLabel}>Started: {journeyStartedLabel}</Text>
              ) : null}
            </View>
          )}
        </Animated.View>

        <View style={styles.quoteWrap}>
          <DailyQuoteCard goal={burnProfile?.goal_tag} />
        </View>
      </ScrollView>

      <Modal
        visible={showWeighInModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWeighInModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.weighInModal}>
            <Text style={styles.weighInModalTitle}>{t("home.logWeightTitle")}</Text>
            <Text style={styles.weighInModalSubtitle}>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </Text>

            <View style={styles.weightInputRow}>
              <TextInput
                style={styles.weightInput}
                value={weighInValue}
                onChangeText={setWeighInValue}
                keyboardType="decimal-pad"
                placeholder="70.5"
                placeholderTextColor="#475569"
                autoFocus
              />
              <Text style={styles.weightUnit}>kg</Text>
            </View>

            <View style={styles.quickAdjustRow}>
              {[-1, -0.5, 0.5, 1].map((delta) => (
                <TouchableOpacity
                  key={delta}
                  style={styles.quickAdjustBtn}
                  onPress={() => {
                    const current = parseFloat(weighInValue) || 0;
                    setWeighInValue(String(Math.round((current + delta) * 10) / 10));
                  }}
                >
                  <Text style={styles.quickAdjustText}>{delta > 0 ? `+${delta}` : delta}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {latestWeight?.has_logs ? (
              <Text style={styles.weighInLastRef}>{t("home.lastLogged", { weight: latestWeight.weight_kg })}</Text>
            ) : null}

            <View style={styles.weighInActions}>
              <TouchableOpacity style={styles.weighInCancel} onPress={() => setShowWeighInModal(false)}>
                <Text style={styles.weighInCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.weighInSave, isLoggingWeight && styles.weighInSaveDisabled]}
                onPress={() => void handleLogWeight()}
                disabled={isLoggingWeight}
              >
                {isLoggingWeight ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.weighInSaveText}>{t("common.save")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 16, paddingBottom: 34, paddingTop: 12 },
  section: { marginBottom: 4 },
  quoteWrap: { marginTop: 16 },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  streakCard: {
    backgroundColor: BG,
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
  },
  streakTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  streakBadgeLeft: { flexDirection: "row", alignItems: "center", flex: 1, paddingRight: 12 },
  streakEmojiTile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FFF1EE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  streakEmoji: { fontSize: 22 },
  streakBadgeText: { flex: 1 },
  streakCountLine: { fontSize: 16, fontWeight: "700", color: ORANGE },
  streakMotivation: { fontSize: 11, color: "#C07050", marginTop: 2 },
  streakBestCol: { alignItems: "flex-end" },
  gamePlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: PURPLE_LIGHT,
    width: "100%",
  },
  gamePlanBtnText: { fontSize: 14, fontWeight: "700", color: PURPLE },
  streakBestLabel: { fontSize: 10, color: TEXT_MUTED, marginBottom: 2 },
  streakBestValue: { fontSize: 14, fontWeight: "700", color: TEXT_PRIMARY },
  streakDivider: { height: 1, backgroundColor: "#ECEAE5", marginVertical: 14 },
  streakWeekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  streakDayCol: { alignItems: "center", flex: 1 },
  streakDots: { gap: 3, marginBottom: 6 },
  streakDot: { width: 8, height: 8, borderRadius: 4 },
  streakDateTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  streakDateNum: { fontSize: 13, fontWeight: "700" },
  streakDayLabel: { fontSize: 10, color: TEXT_MUTED, marginTop: 4 },
  streakDayLabelToday: { color: GREEN, fontWeight: "600" },
  streakLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  streakLegendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  streakLegendDot: { width: 8, height: 8, borderRadius: 4 },
  streakLegendText: { fontSize: 10, color: TEXT_MUTED },
  streakLegendSep: { fontSize: 10, color: TEXT_MUTED },
  greetingLeft: { flex: 1, paddingRight: 12 },
  greetingName: { fontSize: 34, fontWeight: "900", color: TEXT_PRIMARY, lineHeight: 36 },
  brandTextNex: { color: TEXT_PRIMARY },
  brandTextRep: { color: "#167F79" },
  brandTagline: { color: "#9A9A9A", fontSize: 11, fontWeight: "900", letterSpacing: 1.6, marginTop: 1 },
  weighInPrompt: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFBF5",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  weighInEmoji: { fontSize: 20 },
  weighInPromptText: { flex: 1, fontSize: 13, color: TEXT_PRIMARY, lineHeight: 18 },
  weighInPromptAction: { fontSize: 13, fontWeight: "700", color: GREEN },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  goalCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 11.2,
    paddingBottom: 11.2,
    borderWidth: 0.5,
    borderColor: TRACK,
    marginBottom: 16,
  },
  goalPendingDivider: {
    height: 0.5,
    backgroundColor: TRACK,
    marginTop: 10,
    marginBottom: 8,
  },
  goalPendingText: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
  },
  kpiColumn: { flex: 1 },
  metricsCard: {
    flex: 1,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  metricsRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    paddingRight: 8,
  },
  metricsRowLabel: {
    fontSize: 13,
    color: TEXT_MUTED,
    textTransform: "lowercase",
  },
  metricsRowValue: {
    fontSize: 16,
    fontWeight: "500",
    color: TEXT_PRIMARY,
  },
  metricsDivider: {
    height: 0.5,
    backgroundColor: TRACK,
    marginVertical: 6,
  },
  metricsRowBurn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  metricsBurnLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: TEXT_PRIMARY,
    textTransform: "lowercase",
  },
  metricsBurnRight: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  metricsBurnValue: {
    fontSize: 20,
    fontWeight: "500",
    color: TEXT_PRIMARY,
  },
  metricsBurnMin: {
    fontSize: 11,
    color: TEXT_MUTED,
  },
  burnChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  burnChip: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: BG,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  burnChipText: {
    flex: 1,
    fontSize: 11,
    color: TEXT_PRIMARY,
  },
  tdeeCard: {
    backgroundColor: GREEN,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  tdeeLeft: { flex: 1, paddingRight: 12 },
  tdeeTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  tdeeEmoji: { fontSize: 18 },
  tdeeTitle: { fontSize: 18, fontWeight: "700", color: CARD },
  tdeePill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
  },
  tdeePillText: { fontSize: 10, color: CARD, fontWeight: "600" },
  tdeeDesc: { fontSize: 11, color: "rgba(255,255,255,0.75)", lineHeight: 16 },
  tdeeRight: { alignItems: "flex-end" },
  tdeeValue: { fontSize: 32, fontWeight: "800", color: CARD, lineHeight: 36 },
  tdeeUnit: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  barCard: {
    backgroundColor: BG,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: TRACK,
  },
  barHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  barTitle: { fontSize: 14, fontWeight: "600", color: TEXT_PRIMARY },
  barMeta: { fontSize: 12, color: TEXT_MUTED },
  burnedOrange: { color: ORANGE, fontWeight: "700" },
  milestonePct: { fontSize: 14, fontWeight: "700", color: GREEN },
  progressTrack: {
    width: "100%",
    height: 8,
    borderRadius: 100,
    backgroundColor: TRACK,
    overflow: "hidden",
  },
  progressFill: { height: 8, borderRadius: 100 },
  goalFooter: { fontSize: 11, color: TEXT_MUTED, marginTop: 10 },
  goalStartedLabel: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  strengthEmptyBox: { backgroundColor: CARD, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: TRACK },
  strengthEmptyTitle: { color: TEXT_PRIMARY, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  strengthEmptyText: { color: TEXT_MUTED, fontSize: 11, lineHeight: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  weighInModal: {
    backgroundColor: "#141b2d",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  weighInModalTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  weighInModalSubtitle: { color: "#64748B", fontSize: 13, marginBottom: 20 },
  weightInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  weightInput: {
    fontSize: 48,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    minWidth: 120,
    borderBottomWidth: 2,
    borderBottomColor: "#22D3EE",
    paddingBottom: 4,
  },
  weightUnit: { color: "#64748B", fontSize: 20, marginTop: 16 },
  quickAdjustRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  quickAdjustBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  quickAdjustText: { color: "#94A3B8", fontSize: 14, fontWeight: "600" },
  weighInLastRef: { color: "#475569", fontSize: 12, textAlign: "center", marginBottom: 20 },
  weighInActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  weighInCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
  },
  weighInCancelText: { color: "#94A3B8", fontSize: 15, fontWeight: "600" },
  weighInSave: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#22D3EE",
    alignItems: "center",
  },
  weighInSaveDisabled: { opacity: 0.6 },
  weighInSaveText: { color: "#000", fontSize: 15, fontWeight: "700" },
});
