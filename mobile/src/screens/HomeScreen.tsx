import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Polyline } from "react-native-svg";
import type { CalorieDayPayload } from "../api/caloriesLog";
import { getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { resolveApiBaseUrl } from "../api/client";
import { fetchOnboardingMe } from "../api/onboarding";
import { getProfile } from "../api/user";
import { getWorkoutHistory } from "../api/workout";
import { useAuthStore } from "../store/authStore";
import { computeUserCaloriePlan } from "../utils/calorieEngine";

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
  timeline?: Record<string, unknown>;
}

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const formatDateShort = (dateStr: string | undefined): string => {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const WeightSparkline = ({ entries }: { entries: WeightEntry[] }) => {
  if (entries.length < 2) return null;

  const width = 320;
  const height = 60;
  const padding = 8;

  const weights = entries.map((e) => e.weight_kg);
  const minW = Math.min(...weights) - 0.5;
  const maxW = Math.max(...weights) + 0.5;

  const x = (i: number) => padding + (i / (entries.length - 1)) * (width - padding * 2);
  const y = (w: number) => height - padding - ((w - minW) / (maxW - minW)) * (height - padding * 2);

  const points = entries.map((e, i) => `${x(i)},${y(e.weight_kg)}`).join(" ");

  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke="#22D3EE" strokeWidth={2} strokeLinejoin="round" />
      <Circle cx={x(entries.length - 1)} cy={y(weights[weights.length - 1])} r={4} fill="#22D3EE" />
    </Svg>
  );
};

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

const BG_MAIN = "#080c12";
const BG_CARD = "#0f1620";
const BG_SURFACE = "rgba(255,255,255,0.03)";
const ACCENT_GREEN = "#00e5a0";
const ACCENT_BLUE = "#00aaff";
const ACCENT_RED = "#f87171";
const ACCENT_PURPLE = "#a78bfa";
const TEXT_PRIMARY = "#ffffff";
const TEXT_MUTED = "rgba(255,255,255,0.35)";
const BORDER = "rgba(255,255,255,0.07)";

const ffDisplay = "System";
const ffBody = "System";
const ffMedium = "System";
const ffSemi = "System";

function computeGreetingForNow(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "GOOD MORNING";
  if (hour >= 12 && hour < 17) return "GOOD AFTERNOON";
  if (hour >= 17 && hour < 21) return "GOOD EVENING";
  return "GOOD NIGHT";
}

function formatHeaderDate(now: Date): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  if (weekday && month && day && year) {
    return `${weekday}, ${month} ${day} · ${year}`;
  }
  return formatter.format(now);
}

function formatDisplayName(rawName: string | null | undefined): string {
  const safe = String(rawName || "").trim();
  if (!safe) return "Athlete";
  const parts = safe.split(/\s+/).filter(Boolean);
  const first = parts[0] || "Athlete";
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1][0]}.` : "";
  return lastInitial ? `${first} ${lastInitial}` : first;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const formatNum = (v: number) => Math.round(v || 0).toLocaleString();
type EnergyMode = "deficit" | "surplus" | "maintenance";

const parseServerDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  // Backend can emit naive ISO strings; normalize to UTC so local-day checks are correct.
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

export const HomeScreen = () => {
  const token = useAuthStore((s) => s.token);
  const [headerGreeting, setHeaderGreeting] = useState(() => computeGreetingForNow(new Date()));
  const [headerDateLabel, setHeaderDateLabel] = useState(() => formatHeaderDate(new Date()));
  const [headerName, setHeaderName] = useState("Athlete");
  const [calorieDay, setCalorieDay] = useState<CalorieDayPayload | null>(null);
  const [burnProfile, setBurnProfile] = useState<BurnProfile | null>(null);
  const [totalWorkoutBurn, setTotalWorkoutBurn] = useState(0);
  const [timelineTargets, setTimelineTargets] = useState<Record<string, unknown> | null>(null);
  const [latestWeight, setLatestWeight] = useState<LatestWeightData | null>(null);
  const [weightHistory, setWeightHistory] = useState<WeightEntry[]>([]);
  const [goalProgress, setGoalProgress] = useState<GoalProgressData | null>(null);
  const [showWeighInModal, setShowWeighInModal] = useState(false);
  const [weighInValue, setWeighInValue] = useState("");
  const [isLoggingWeight, setIsLoggingWeight] = useState(false);

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
    const now = new Date();
    setHeaderGreeting(computeGreetingForNow(now));
    setHeaderDateLabel(formatHeaderDate(now));
    if (!token) {
      setCalorieDay(null);
      setBurnProfile(null);
      setTotalWorkoutBurn(0);
      setTimelineTargets(null);
      setLatestWeight(null);
      setWeightHistory([]);
      setGoalProgress(null);
      setHeaderName("Athlete");
      return;
    }
    const apiBase = resolveApiBaseUrl();
    const authHeaders = { Authorization: `Bearer ${token}` };
    try {
      const [dayRes, onboardingRes, historyRes, profileRes, weightLatestRes, weightHistoryRes, goalProgressRes] =
        await Promise.all([
          getDailyCalorieLog(todayLocal()).catch(() => null),
          fetchOnboardingMe().catch(() => null),
          getWorkoutHistory(24 * 7).catch(() => ({ items: [] })),
          getProfile().catch(() => null),
          fetch(`${apiBase}/api/weight/latest`, { headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${apiBase}/api/weight/history?days=60`, { headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${apiBase}/api/goal-progress?local_date=${todayLocal()}`, { headers: authHeaders })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
      const today = new Date();
      const todayWorkoutBurn = (historyRes.items ?? []).reduce((sum, item) => {
        if (!item?.date || !isSameLocalDay(item.date, today)) return sum;
        return sum + (Number(item.caloriesBurned) || 0);
      }, 0);
      setCalorieDay(dayRes);
      setBurnProfile(toBurnProfile(onboardingRes?.onboarding));
      setTotalWorkoutBurn(Math.max(0, Math.round(todayWorkoutBurn)));
      setTimelineTargets((onboardingRes?.targets as Record<string, unknown>) ?? null);
      setLatestWeight(weightLatestRes);
      setWeightHistory(weightHistoryRes?.entries ?? []);
      setGoalProgress(goalProgressRes);
      const profileName = typeof profileRes?.name === "string" ? profileRes.name : "";
      const onboardingName = typeof onboardingRes?.onboarding?.personal?.name === "string" ? onboardingRes.onboarding.personal.name : "";
      setHeaderName(formatDisplayName(profileName || onboardingName));
    } catch {
      Alert.alert("Error", "Could not load home dashboard.");
    }
  }, [token]);

  const handleLogWeight = async () => {
    const kg = parseFloat(weighInValue);
    if (!kg || kg <= 0 || kg > 500) {
      Alert.alert("Invalid", "Please enter a valid weight between 1 and 500 kg");
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

      if (!res.ok) throw new Error("Failed to save");
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
        Alert.alert("Logged!", data.change_label);
      }

      setShowWeighInModal(false);

      const newGoalProgress = await fetch(`${apiBase}/api/goal-progress?local_date=${todayLocal()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (newGoalProgress) setGoalProgress(newGoalProgress);
    } catch {
      Alert.alert("Error", "Could not save weight. Try again.");
    } finally {
      setIsLoggingWeight(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const log = calorieDay?.log;
  const intake = Number(log?.total_calories || 0);
  const targetKcal = Number(log?.target_calories || 0);
  const caloriesBurnedSoFar = Math.max(0, Math.round(totalWorkoutBurn));
  const effectiveWeightKg = latestWeight?.weight_kg ?? burnProfile?.current_weight_kg;
  const burnPlan = burnProfile
    ? computeUserCaloriePlan({ ...burnProfile, current_weight_kg: effectiveWeightKg ?? burnProfile.current_weight_kg })
    : null;
  const eatenToday = Number.isFinite(intake) ? Math.round(intake) : 0;
  const dailyGoal = (burnPlan?.dailyCalorieTarget ?? targetKcal) || 1800;
  const remainingBurnTarget = Math.max(0, eatenToday - dailyGoal - caloriesBurnedSoFar);
  const netCalorieGap = eatenToday - dailyGoal - caloriesBurnedSoFar;
  const remainingIntakeToGoal = netCalorieGap < 0 ? Math.abs(netCalorieGap) : 0;
  const needsBurnFromExercise = netCalorieGap > 0;
  const summaryTargetLabel = needsBurnFromExercise ? "Still to burn" : "Remaining Intake";
  const summaryTargetValue = needsBurnFromExercise ? remainingBurnTarget : remainingIntakeToGoal;
  const summaryTargetPercent = dailyGoal > 0 ? clamp01(summaryTargetValue / dailyGoal) : 0;
  const intakePercent = dailyGoal > 0 ? clamp01(eatenToday / dailyGoal) : 0;
  const timeline =
    (goalProgress?.timeline as Record<string, unknown> | undefined) ??
    (timelineTargets?.timeline as Record<string, unknown> | undefined) ??
    {};
  const weeksToGoalRaw = Number(goalProgress?.weeks_to_goal ?? timeline.weeks_to_goal);
  const weeksToGoal = Number.isFinite(weeksToGoalRaw) ? Math.max(0, Math.round(weeksToGoalRaw)) : 12;
  const weeklyChangeRaw = goalProgress?.weekly_change_kg ?? timeline.weekly_change_kg ?? timeline.weekly_delta_kg;
  const weeklyDelta = Number(weeklyChangeRaw);
  const paceLabel = Number.isFinite(weeklyDelta) ? `~${Math.abs(weeklyDelta).toFixed(2)} kg / week` : "~0.18 kg / week";
  const dailyDelta = Number(goalProgress?.daily_delta_kcal ?? timeline.daily_delta_kcal);
  const deltaDisplay = Number.isFinite(dailyDelta) ? Math.round(Math.abs(dailyDelta)) : 200;
  const exerciseDelta = Number(goalProgress?.exercise_delta_kcal ?? timeline.exercise_delta_kcal);
  const exerciseShare = Number(goalProgress?.exercise_share ?? timeline.exercise_share);
  const dietShare = Number(goalProgress?.diet_share ?? timeline.diet_share);
  const exerciseDeltaDisplay = Number.isFinite(exerciseDelta) ? Math.round(Math.abs(exerciseDelta)) : Math.round(deltaDisplay * 0.2);
  const dietDeltaDisplay = Math.max(0, deltaDisplay - exerciseDeltaDisplay);
  const exerciseSharePct = Number.isFinite(exerciseShare) ? clamp01(exerciseShare) : 0.2;
  const dietSharePct = Number.isFinite(dietShare) ? clamp01(dietShare) : 0.8;
  const dailyDeltaLabel = !Number.isFinite(dailyDelta)
    ? "Deficit"
    : dailyDelta < 0
      ? "Deficit"
      : dailyDelta > 0
        ? "Surplus"
        : "Maintenance";
  const goalWeeksProgress = clamp01((12 - Math.max(0, weeksToGoal)) / 12);
  const workoutShareAchieved = Math.min(caloriesBurnedSoFar, exerciseDeltaDisplay);
  const exerciseTargetRemaining = Math.max(0, exerciseDeltaDisplay - workoutShareAchieved);
  const workoutShareProgress = exerciseDeltaDisplay > 0 ? clamp01(workoutShareAchieved / exerciseDeltaDisplay) : 1;
  const mode: EnergyMode = dailyGoal < (burnPlan?.tdee ?? 0) ? "deficit" : dailyGoal > (burnPlan?.tdee ?? 0) ? "surplus" : "maintenance";
  const remainingCalories = Math.round(dailyGoal - eatenToday);
  const remainingExercise = Math.max(0, exerciseDeltaDisplay - caloriesBurnedSoFar);
  const exerciseProgressPct = Math.round(clamp01(exerciseDeltaDisplay > 0 ? caloriesBurnedSoFar / exerciseDeltaDisplay : 1) * 100);
  const interpreter = (() => {
    if (mode === "deficit") {
      return {
        headline: remainingExercise > 0 ? `${formatNum(remainingExercise)} kcal remaining to burn` : "Exercise goal completed",
        subtext: "Exercise contributes to your calorie deficit",
        progressLabel: "Fat loss progress",
      };
    }
    if (mode === "surplus") {
      return {
        headline: exerciseProgressPct >= 100 ? "Workout target achieved" : `Training progress: ${exerciseProgressPct}%`,
        subtext: "Training supports muscle growth",
        progressLabel: "Training stimulus",
      };
    }
    return {
      headline: "Balanced day",
      subtext: "Maintaining energy balance",
      progressLabel: "Daily balance",
    };
  })();

  const ringSize = 80;
  const ringStroke = 7;
  const animatedStyle = (idx: number) => ({
    opacity: sectionAnim[idx],
    transform: [{ translateY: sectionAnim[idx].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.headerWrap, animatedStyle(0)]}>
          <View style={styles.brandRow}>
            <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.brandTextGradient}>
              <Text style={styles.brandText}>NexRep</Text>
            </LinearGradient>
          </View>
          <Text style={styles.greeting}>{headerGreeting}</Text>
          <Text style={styles.userName}>{headerName}</Text>
          <View style={styles.datePill}>
            <View style={styles.dateDot} />
            <Text style={styles.dateText}>{headerDateLabel}</Text>
          </View>
        </Animated.View>

        {latestWeight && (latestWeight.days_since_log === null || latestWeight.days_since_log >= 7) ? (
          <TouchableOpacity
            style={styles.weighInCard}
            onPress={() => {
              setWeighInValue(String(latestWeight.weight_kg || ""));
              setShowWeighInModal(true);
            }}
            activeOpacity={0.85}
          >
            <View style={styles.weighInLeft}>
              <Text style={styles.weighInIcon}>⚖️</Text>
              <View>
                <Text style={styles.weighInTitle}>
                  {latestWeight.days_since_log === null
                    ? "Log your starting weight"
                    : `Weigh-in due — ${latestWeight.days_since_log} days ago`}
                </Text>
                <Text style={styles.weighInSubtitle}>
                  {latestWeight.days_since_log === null
                    ? "Needed to track your progress accurately"
                    : `Last: ${latestWeight.weight_kg}kg on ${formatDate(latestWeight.log_date)}`}
                </Text>
              </View>
            </View>
            <View style={styles.weighInBadge}>
              <Text style={styles.weighInBadgeText}>Log now</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        <Animated.View style={animatedStyle(1)}>
          <Text style={styles.sectionLabel}>Goal Overview</Text>
          <View style={styles.card}>
            <LinearGradient colors={["#7c3aed", ACCENT_PURPLE, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.accentTop} />
            <View style={styles.cardBody}>
              <Text style={styles.cardMicro}>GOAL TIMELINE</Text>
              <Text style={styles.cardTitle}>Weeks to goal milestone</Text>
              <View style={styles.goalTopRow}>
                <View>
                  <View style={styles.goalWeeksLine}>
                    <Text style={styles.goalWeeks}>{weeksToGoal}</Text>
                    <Text style={styles.goalWeeksUnit}>weeks</Text>
                  </View>
                  <Text style={styles.goalSub}>{paceLabel}</Text>
                </View>
                <View style={styles.goalRight}>
                  <Text style={styles.goalKcal}>{formatNum(deltaDisplay)} kcal</Text>
                  <Text style={styles.goalPerDay}>/day</Text>
                  <Text style={styles.goalSub}>{dailyDeltaLabel}</Text>
                </View>
              </View>
              <View style={styles.progressHead}>
                <Text style={styles.cardMicro}>MILESTONE PROGRESS</Text>
                <Text style={styles.progressPct}>{Math.round(goalWeeksProgress * 100)}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={["#7c3aed", ACCENT_PURPLE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${Math.round(goalWeeksProgress * 100)}%` }]} />
              </View>
              <View style={styles.goalSplitSection}>
                <Text style={styles.cardMicro}>PLAN VS LOGGED WORKOUTS</Text>
                <Text style={[styles.goalSplitLine, { color: TEXT_MUTED }]}>
                  Diet portion: {formatNum(dietDeltaDisplay)} kcal ({Math.round(dietSharePct * 100)}%) · Workout portion: {formatNum(exerciseDeltaDisplay)} kcal (
                  {Math.round(exerciseSharePct * 100)}%)
                </Text>
                <Text style={[styles.goalSplitLine, { color: TEXT_MUTED, marginTop: 6 }]}>
                  Logged today (MET, same as Workout tab): {formatNum(caloriesBurnedSoFar)} kcal · Toward workout portion: {formatNum(exerciseTargetRemaining)} kcal
                  left
                </Text>
              </View>
            </View>
          </View>

          {weightHistory.length >= 2 ? (
            <View style={styles.weightChartCard}>
              <View style={styles.weightChartHeader}>
                <Text style={styles.weightChartTitle}>Weight Trend</Text>
                <Text style={styles.weightChartSub}>
                  {latestWeight?.weight_kg}kg current
                  {goalProgress?.total_change_kg != null && goalProgress.total_change_kg !== 0
                    ? ` · ${goalProgress.weight_change_label}`
                    : ""}
                </Text>
              </View>
              <WeightSparkline entries={weightHistory.slice(-8)} />
              <View style={styles.weightChartXAxis}>
                <Text style={styles.weightChartDate}>
                  {formatDateShort(weightHistory[Math.max(0, weightHistory.length - 8)]?.log_date)}
                </Text>
                <Text style={styles.weightChartDate}>
                  {formatDateShort(weightHistory[weightHistory.length - 1]?.log_date)}
                </Text>
              </View>
            </View>
          ) : null}
        </Animated.View>

        <Animated.View style={animatedStyle(2)}>
          <Text style={styles.sectionLabel}>Today's Burn</Text>
          <View style={styles.card}>
            <LinearGradient colors={["#ef4444", ACCENT_RED, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.accentTop} />
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardMicro}>CALORIES TO BURN TODAY</Text>
                <View style={styles.burnBadge}><Text style={styles.burnBadgeText}>Burn needed</Text></View>
              </View>
              <View style={styles.userChip}>
                <Text style={styles.userChipText}>{`${headerName.replace(".", "")} · ${Math.round(effectiveWeightKg || 71)} kg · ${burnProfile?.goal_tag || "Strength"} · Age ${burnProfile?.age || 25}`}</Text>
              </View>
              <View style={styles.centerRow}>
                <View style={styles.ringWrap}>
                  <View style={[styles.ringTrack, { width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderWidth: ringStroke }]} />
                  <View
                    style={[
                      styles.ringFillFallback,
                      {
                        width: ringSize,
                        height: ringSize,
                        borderRadius: ringSize / 2,
                        borderWidth: ringStroke,
                        opacity: 0.35 + workoutShareProgress * 0.65,
                      },
                    ]}
                  />
                  <View style={styles.ringCenter}>
                    <Text style={styles.ringPct}>{exerciseProgressPct}%</Text>
                    <Text style={styles.ringLabel}>progress</Text>
                  </View>
                </View>
                <View style={styles.centerCopy}>
                  <Text style={styles.kcalBig}>{mode === "deficit" ? formatNum(remainingExercise) : `${exerciseProgressPct}%`}</Text>
                  <Text style={styles.kcalLine}>{interpreter.headline}</Text>
                  <Text style={styles.aiLine}>{interpreter.subtext}</Text>
                </View>
              </View>
              <View style={styles.statsGrid}>
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>Body weight</Text>
                  <Text style={styles.statValue}>{Math.round(effectiveWeightKg || 71)}</Text>
                  <Text style={styles.statUnit}>kg</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>TDEE</Text>
                  <Text style={styles.statValue}>{formatNum(burnPlan?.tdee || 1690)}</Text>
                  <Text style={styles.statUnit}>kcal/day</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>Daily goal</Text>
                  <Text style={styles.statValue}>{formatNum(dailyGoal)}</Text>
                  <Text style={styles.statUnit}>kcal target</Text>
                </View>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLeft}>FOOD INTAKE VS TARGET</Text>
                <Text style={styles.infoRight}>{`${formatNum(eatenToday)} / ${formatNum(dailyGoal)} kcal`}</Text>
              </View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${Math.round(intakePercent * 100)}%` }]} />
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLeft}>{interpreter.progressLabel.toUpperCase()}</Text>
                <Text style={[styles.infoRight, { color: ACCENT_GREEN }]}>{`${formatNum(workoutShareAchieved)} / ${formatNum(exerciseDeltaDisplay)} kcal`}</Text>
              </View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${exerciseProgressPct}%` }]} />
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLeft}>REMAINING CALORIES</Text>
                <Text style={[styles.infoRight, { color: remainingCalories < 0 ? ACCENT_RED : ACCENT_GREEN }]}>{`${formatNum(remainingCalories)} kcal`}</Text>
              </View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${Math.round(intakePercent * 100)}%` }]} />
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View style={animatedStyle(3)}>
          <Text style={styles.sectionLabel}>Calculation Breakdown</Text>
          <View style={styles.card}>
            <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.accentTop} />
            <View style={styles.cardBody}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakLabel}>Calories eaten today</Text>
                <Text style={styles.breakValueMuted}>{`${formatNum(eatenToday)} kcal`}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakLabel}>Minus daily calorie goal</Text>
                <Text style={styles.breakValueRed}>{`−${formatNum(dailyGoal)} kcal`}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakLabel}>Diet share ({Math.round(dietSharePct * 100)}%)</Text>
                <Text style={styles.breakValueMuted}>{`${formatNum(dietDeltaDisplay)} kcal`}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakLabel}>Workout share ({Math.round(exerciseSharePct * 100)}%)</Text>
                <Text style={styles.breakValueRed}>{`${formatNum(exerciseDeltaDisplay)} kcal`}</Text>
              </View>
              <View style={[styles.breakdownRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.breakLabel}>Minus already burned</Text>
                <Text style={styles.breakValueGreen}>{`−${formatNum(caloriesBurnedSoFar)} kcal`}</Text>
              </View>
              <View style={styles.stillRow}>
                <Text style={styles.stillLabel}>{summaryTargetLabel}</Text>
                <Text style={[styles.stillValue, { color: needsBurnFromExercise ? ACCENT_RED : ACCENT_GREEN }]}>{`${formatNum(summaryTargetValue)} kcal`}</Text>
              </View>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      <Modal
        visible={showWeighInModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWeighInModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.weighInModal}>
            <Text style={styles.weighInModalTitle}>Log Today&apos;s Weight</Text>
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
              <Text style={styles.weighInLastRef}>Last logged: {latestWeight.weight_kg}kg</Text>
            ) : null}

            <View style={styles.weighInActions}>
              <TouchableOpacity style={styles.weighInCancel} onPress={() => setShowWeighInModal(false)}>
                <Text style={styles.weighInCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.weighInSave, isLoggingWeight && styles.weighInSaveDisabled]}
                onPress={() => void handleLogWeight()}
                disabled={isLoggingWeight}
              >
                {isLoggingWeight ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.weighInSaveText}>Save</Text>
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
  safe: { flex: 1, backgroundColor: BG_MAIN },
  scroll: { flex: 1, backgroundColor: BG_MAIN },
  content: { paddingHorizontal: 16, paddingBottom: 34, paddingTop: 20 },
  headerWrap: { alignItems: "center", width: "100%", paddingBottom: 6 },
  brandRow: { alignItems: "center", justifyContent: "center" },
  brandTextGradient: { borderRadius: 6, paddingHorizontal: 2 },
  brandText: { fontFamily: ffDisplay, fontSize: 34, lineHeight: 34, letterSpacing: 2, color: TEXT_PRIMARY, opacity: 0.98 },
  greeting: { marginTop: 10, fontFamily: ffMedium, fontSize: 11, letterSpacing: 2.4, color: ACCENT_GREEN },
  userName: { fontFamily: ffDisplay, fontSize: 42, letterSpacing: 1.5, color: TEXT_PRIMARY, marginTop: 6 },
  datePill: { marginTop: 12, paddingVertical: 5, paddingHorizontal: 14, borderRadius: 100, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER, flexDirection: "row", alignItems: "center", gap: 8 },
  dateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: ACCENT_GREEN },
  dateText: { fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED },
  sectionLabel: { marginTop: 20, marginBottom: 10, fontFamily: ffMedium, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" },
  card: { backgroundColor: BG_CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: "hidden", marginBottom: 12 },
  accentTop: { height: 3, width: "100%" },
  cardBody: { padding: 16 },
  cardMicro: { fontFamily: ffMedium, fontSize: 9, letterSpacing: 2, color: TEXT_MUTED, textTransform: "uppercase" },
  cardTitle: { marginTop: 4, fontFamily: ffSemi, fontSize: 13, color: TEXT_PRIMARY },
  goalTopRow: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  goalWeeksLine: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  goalWeeks: { fontFamily: ffDisplay, fontSize: 48, color: TEXT_PRIMARY, lineHeight: 48 },
  goalWeeksUnit: { fontFamily: ffSemi, fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 8 },
  goalSub: { fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED, marginTop: 2 },
  goalRight: { alignItems: "flex-end" },
  goalKcal: { fontFamily: ffDisplay, fontSize: 28, color: ACCENT_GREEN, lineHeight: 28 },
  goalPerDay: { fontFamily: ffBody, fontSize: 11, color: "rgba(0,229,160,0.6)" },
  progressHead: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressPct: { fontFamily: ffSemi, fontSize: 12, color: "rgba(255,255,255,0.5)" },
  progressTrack: { marginTop: 8, width: "100%", height: 4, borderRadius: 100, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 100 },
  goalSplitSection: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  goalSplitLine: { fontFamily: ffBody, fontSize: 11, lineHeight: 17 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  burnBadge: { backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  burnBadgeText: { fontFamily: ffSemi, fontSize: 11, color: ACCENT_RED },
  userChip: { marginTop: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  userChipText: { fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED },
  centerRow: { marginTop: 14, flexDirection: "row", gap: 16, alignItems: "center" },
  ringWrap: { width: 80, height: 80, alignItems: "center", justifyContent: "center", position: "relative" },
  ringTrack: { borderColor: "rgba(255,255,255,0.07)", position: "absolute" },
  ringFillFallback: { borderColor: "#1a3a5c", position: "absolute" },
  ringCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  ringPct: { fontFamily: ffSemi, fontSize: 14, color: TEXT_PRIMARY },
  ringLabel: { fontFamily: ffBody, fontSize: 9, color: TEXT_MUTED },
  centerCopy: { flex: 1 },
  kcalBig: { fontFamily: ffDisplay, fontSize: 44, color: ACCENT_RED, lineHeight: 44 },
  kcalLine: { fontFamily: ffSemi, fontSize: 12, color: TEXT_PRIMARY },
  aiLine: { marginTop: 4, fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED, lineHeight: 16 },
  statsGrid: { marginTop: 14, flexDirection: "row", gap: 8 },
  statCell: { flex: 1, backgroundColor: BG_SURFACE, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8 },
  statLabel: { fontFamily: ffMedium, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: TEXT_MUTED },
  statValue: { marginTop: 4, fontFamily: ffDisplay, fontSize: 24, color: TEXT_PRIMARY, lineHeight: 24 },
  statUnit: { marginTop: 2, fontFamily: ffBody, fontSize: 10, color: TEXT_MUTED },
  infoRow: { marginTop: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: BORDER, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  infoLeft: { fontFamily: ffMedium, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: TEXT_MUTED },
  infoRight: { fontFamily: ffMedium, fontSize: 11, color: TEXT_PRIMARY },
  breakdownRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  breakLabel: { fontFamily: ffBody, fontSize: 13, color: TEXT_PRIMARY },
  breakValueMuted: { fontFamily: ffMedium, fontSize: 13, color: TEXT_MUTED },
  breakValueRed: { fontFamily: ffMedium, fontSize: 13, color: ACCENT_RED },
  breakValueGreen: { fontFamily: ffMedium, fontSize: 13, color: ACCENT_GREEN },
  stillRow: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stillLabel: { fontFamily: ffDisplay, fontSize: 22, letterSpacing: 1, color: TEXT_PRIMARY },
  stillValue: { fontFamily: ffDisplay, fontSize: 28, color: ACCENT_RED },
  weighInCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(34, 211, 238, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(34, 211, 238, 0.2)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  weighInLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  weighInIcon: { fontSize: 22 },
  weighInTitle: { color: "#E2E8F0", fontSize: 13, fontWeight: "600" },
  weighInSubtitle: { color: "#64748B", fontSize: 11, marginTop: 2 },
  weighInBadge: {
    backgroundColor: "#22D3EE",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  weighInBadgeText: { color: "#000", fontSize: 12, fontWeight: "700" },
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
  weightChartCard: {
    backgroundColor: "#0F1A2A",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  weightChartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  weightChartTitle: { color: "#E2E8F0", fontSize: 14, fontWeight: "600" },
  weightChartSub: { color: "#64748B", fontSize: 11 },
  weightChartXAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  weightChartDate: { color: "#475569", fontSize: 10 },
});
