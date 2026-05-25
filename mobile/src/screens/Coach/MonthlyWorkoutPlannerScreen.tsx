import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  fetchWorkoutPlanCurrent,
  fetchWorkoutPlanDay,
  generateWorkoutPlan,
  regenerateWorkoutMonthPlan,
  regenerateWorkoutPlanDay,
  swapWorkoutExercise,
} from "../../api/workoutPlanner";
import { fetchOnboardingMe } from "../../api/onboarding";
import { PlannerMonthCalendar } from "../../components/Coach/PlannerMonthCalendar";
import { EXERCISE_SWAP_REASONS, SwapBottomSheet } from "../../components/SwapBottomSheet";
import { ScreenContainer } from "../../components/ScreenContainer";
import { formatApiDetail, notifyUser } from "../../utils/notify";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { useAppTheme } from "../../theme";
import type { FocusMuscle, WorkoutDayPlan, WorkoutPlanCurrent } from "../../types/planner";
import { fullDayLabel, getNextMonthResetLabel, isPastPlanDay, monthYearLabel } from "../../utils/localDate";

const MUSCLE_PILL_OPTIONS = ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core", "Balanced"] as const;

function planFocusMuscles(plan: WorkoutPlanCurrent | null): FocusMuscle[] {
  if (plan?.focus_muscles?.length) return plan.focus_muscles;
  if (plan?.focus_muscle) return [plan.focus_muscle];
  return [];
}

function muscleSelectionHint(muscles: FocusMuscle[]): string {
  if (muscles.length === 0) return "Balanced — all muscle groups will be trained equally";
  if (muscles.length === 1) return `Extra volume for ${muscles[0]} in every session`;
  return `Extra volume for ${muscles.join(", ")} across your plan`;
}

const MAX_WORKOUT_REGENS_PER_MONTH = 2;
const MAX_MONTH_PLAN_REGENS_PER_MONTH = 2;

type RegenBadgeProps = {
  remaining: number;
  exempt: boolean;
  resetLabel: string;
};

function RegenUsageBadge({ remaining, exempt, resetLabel }: RegenBadgeProps) {
  if (exempt) return null;

  const badgeText =
    remaining <= 0
      ? `Resets ${resetLabel}`
      : `${remaining <= 1 ? "⚠ " : ""}${remaining} left this month`;

  const badgeColor = remaining <= 0 ? "#888888" : remaining === 1 ? "#FFC107" : "#2ECC9A";
  const badgeBg =
    remaining <= 0
      ? "rgba(136,136,136,0.15)"
      : remaining === 1
        ? "rgba(255,193,7,0.15)"
        : "rgba(46,204,154,0.15)";

  return (
    <View style={[styles.regenBadge, { backgroundColor: badgeBg }]}>
      <Text style={[styles.regenBadgeText, { color: badgeColor }]}>{badgeText}</Text>
    </View>
  );
}

type RegenButtonProps = {
  label: string;
  loadingLabel: string;
  isLoading: boolean;
  disabled: boolean;
  remaining: number;
  exempt: boolean;
  resetLabel: string;
  compact?: boolean;
  onPress: () => void;
};

function RegenerateActionButton({
  label,
  loadingLabel,
  isLoading,
  disabled,
  remaining,
  exempt,
  resetLabel,
  compact,
  onPress,
}: RegenButtonProps) {
  const showLimitLabel = !exempt && remaining <= 0 && !isLoading;

  return (
    <Pressable
      style={[
        compact ? styles.regenerateMonthPlanBtn : styles.regenerateWorkoutBtn,
        (disabled || isLoading) && styles.regenerateWorkoutBtnDisabled,
      ]}
      onPress={onPress}
      disabled={isLoading}
    >
      <View style={styles.regenButtonInner}>
        <View style={styles.regenButtonLeft}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#2ECC9A" />
          ) : (
            <Ionicons name="refresh" size={compact ? 16 : 18} color={disabled ? "#64748b" : "#2ECC9A"} />
          )}
          <Text
            style={[
              compact ? styles.regenerateMonthPlanBtnText : styles.regenerateWorkoutBtnText,
              disabled && styles.regenerateWorkoutBtnTextDisabled,
            ]}
          >
            {isLoading ? loadingLabel : showLimitLabel ? "Regenerate limit reached" : label}
          </Text>
        </View>
        <RegenUsageBadge remaining={remaining} exempt={exempt} resetLabel={resetLabel} />
      </View>
    </Pressable>
  );
}

function isWorkoutRestDay(day: Pick<WorkoutDayPlan, "is_rest_day" | "split_name"> | null | undefined): boolean {
  if (!day) return true;
  if (day.is_rest_day) return true;
  const split = (day.split_name ?? "").trim().toLowerCase();
  return split.includes("rest") || split === "off";
}

function apiErrorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const detail = e.response?.data?.detail;
    const msg = formatApiDetail(detail);
    if (msg) return msg;
    if (e.code === "ECONNABORTED") {
      return "Regeneration is taking longer than expected. Wait a moment and try again.";
    }
    if (e.message) return e.message;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

type RegenStatsSource = {
  day_regens_used?: number;
  day_regens_limit?: number;
  day_regens_remaining?: number;
  month_plan_regens_used?: number;
  month_plan_regens_limit?: number;
  month_plan_regens_remaining?: number;
  planner_limits_exempt?: boolean;
};

function syncWorkoutRegenStats(
  source: RegenStatsSource | null | undefined,
  setUsed: (n: number) => void,
  setLimit: (n: number) => void,
  setRemaining: (n: number) => void,
  setExempt?: (v: boolean) => void,
) {
  if (source?.day_regens_used !== undefined) setUsed(source.day_regens_used);
  if (source?.day_regens_limit !== undefined) setLimit(source.day_regens_limit ?? MAX_WORKOUT_REGENS_PER_MONTH);
  if (source?.day_regens_remaining !== undefined) setRemaining(source.day_regens_remaining);
  if (setExempt && source?.planner_limits_exempt !== undefined) setExempt(source.planner_limits_exempt);
}

function syncMonthPlanRegenStats(
  source: RegenStatsSource | null | undefined,
  setUsed: (n: number) => void,
  setLimit: (n: number) => void,
  setRemaining: (n: number) => void,
) {
  if (source?.month_plan_regens_used !== undefined) setUsed(source.month_plan_regens_used);
  if (source?.month_plan_regens_limit !== undefined) setLimit(source.month_plan_regens_limit ?? MAX_MONTH_PLAN_REGENS_PER_MONTH);
  if (source?.month_plan_regens_remaining !== undefined) setRemaining(source.month_plan_regens_remaining);
}

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const LOADING_MSGS = [
  "Building your weekly split",
  "Balancing push, pull, and legs",
  "Adding progressive overload",
  "Polishing exercise cues",
];

export default function MonthlyWorkoutPlannerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { colors, radius } = useAppTheme();
  const now = new Date();

  const [plan, setPlan] = useState<WorkoutPlanCurrent | null>(null);
  const [selectedDay, setSelectedDay] = useState(now.getDate());
  const [dayDetail, setDayDetail] = useState<WorkoutDayPlan | null>(null);
  const [selectedMuscles, setSelectedMuscles] = useState<FocusMuscle[]>([]);
  const [preview, setPreview] = useState({ goal: "muscle_gain", difficulty: "intermediate", wpw: 4 });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [swappingExerciseIndex, setSwappingExerciseIndex] = useState<number | null>(null);
  const [showExerciseSwapSheet, setShowExerciseSwapSheet] = useState(false);
  const [swapExerciseTarget, setSwapExerciseTarget] = useState<{ day: number; index: number; name: string; muscle: string } | null>(null);
  const [exerciseSwapsUsed, setExerciseSwapsUsed] = useState(0);
  const [dayRegensUsed, setDayRegensUsed] = useState(0);
  const [dayRegensLimit, setDayRegensLimit] = useState(MAX_WORKOUT_REGENS_PER_MONTH);
  const [dayRegensRemaining, setDayRegensRemaining] = useState(MAX_WORKOUT_REGENS_PER_MONTH);
  const [plannerLimitsExempt, setPlannerLimitsExempt] = useState(false);
  const [isRegeneratingWorkout, setIsRegeneratingWorkout] = useState(false);
  const [monthPlanRegensUsed, setMonthPlanRegensUsed] = useState(0);
  const [monthPlanRegensLimit, setMonthPlanRegensLimit] = useState(MAX_MONTH_PLAN_REGENS_PER_MONTH);
  const [monthPlanRegensRemaining, setMonthPlanRegensRemaining] = useState(MAX_MONTH_PLAN_REGENS_PER_MONTH);
  const [isRegeneratingMonthPlan, setIsRegeneratingMonthPlan] = useState(false);
  const exerciseSwapsLimit = 5;
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadSeqRef = useRef(0);
  const initialLoadDoneRef = useRef(false);
  const generatingRef = useRef(false);
  const regeneratingWorkoutRef = useRef(false);
  const regeneratingMonthPlanRef = useRef(false);
  const [exerciseListVersion, setExerciseListVersion] = useState(0);

  const resetMonthLabel = getNextMonthResetLabel();
  const selectedWorkoutOverview = plan?.month_overview.find((d) => d.day === selectedDay);
  const canSwapExercises = Boolean(selectedWorkoutOverview && !selectedWorkoutOverview.is_future && plan);
  const exerciseSwapsRemaining = exerciseSwapsLimit - exerciseSwapsUsed;
  const selectedDayIsPast = plan
    ? (selectedWorkoutOverview?.is_past ??
      isPastPlanDay(plan.month, plan.year, selectedDay))
    : false;
  const showRegenerateWorkout = Boolean(
    plan &&
    dayDetail &&
    !dayDetail.locked &&
    !isWorkoutRestDay(dayDetail) &&
    !selectedDayIsPast &&
    (selectedWorkoutOverview?.is_today || selectedWorkoutOverview?.is_future),
  );
  const canPressRegenerateWorkout =
    showRegenerateWorkout && (plannerLimitsExempt || dayRegensRemaining > 0);
  const canPressRegenerateMonthPlan = Boolean(
    plan && (plannerLimitsExempt || monthPlanRegensRemaining > 0),
  );

  const applyPlan = useCallback((current: WorkoutPlanCurrent | null) => {
    setPlan(current);
    if (current) {
      syncWorkoutRegenStats(current, setDayRegensUsed, setDayRegensLimit, setDayRegensRemaining, setPlannerLimitsExempt);
      syncMonthPlanRegenStats(current, setMonthPlanRegensUsed, setMonthPlanRegensLimit, setMonthPlanRegensRemaining);
      setSelectedMuscles(planFocusMuscles(current));
      const todayDay =
        current.today?.day ??
        current.month_overview.find((d) => d.is_today)?.day ??
        current.month_overview[0]?.day;
      if (todayDay) setSelectedDay(todayDay);
    }
  }, []);

  const loadPlan = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++loadSeqRef.current;
    if (!opts?.silent && !initialLoadDoneRef.current) {
      setLoading(true);
    }
    try {
      const current = await fetchWorkoutPlanCurrent();
      if (seq !== loadSeqRef.current) return;
      applyPlan(current);
    } catch (e: unknown) {
      if (seq !== loadSeqRef.current) return;
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        applyPlan(null);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        initialLoadDoneRef.current = true;
        setLoading(false);
      }
    }
  }, [applyPlan]);

  const loadDay = useCallback(
    async (day: number) => {
      if (!plan || regeneratingWorkoutRef.current || regeneratingMonthPlanRef.current) return;
      const overview = plan.month_overview.find((d) => d.day === day);
      if (overview?.is_future) {
        setDayDetail({
          day,
          is_rest_day: false,
          split_name: overview.split_name,
          focus_muscles: [],
          exercises: [],
          estimated_duration_min: 0,
          locked: true,
          message: `This plan unlocks on ${fullDayLabel(plan.month, plan.year, day)}`,
        });
        return;
      }
      try {
        const d = await fetchWorkoutPlanDay(day);
        setDayDetail(d);
        if (typeof d.swaps_used_today === "number") setExerciseSwapsUsed(d.swaps_used_today);
        syncWorkoutRegenStats(d, setDayRegensUsed, setDayRegensLimit, setDayRegensRemaining, setPlannerLimitsExempt);
      } catch {
        setDayDetail(null);
      }
    },
    [plan],
  );

  useFocusEffect(
    useCallback(() => {
      if (generatingRef.current) return;
      void loadPlan({ silent: initialLoadDoneRef.current });
    }, [loadPlan]),
  );

  useEffect(() => {
    void (async () => {
      try {
        const ob = await fetchOnboardingMe();
        const goal = ob?.onboarding?.goal;
        const activity = ob?.onboarding?.activity;
        setPreview({
          goal: String(goal?.type ?? "muscle_gain"),
          difficulty: String(goal?.difficulty ?? "intermediate"),
          wpw: Number(activity?.workouts_per_week ?? 4),
        });
        if (goal?.focus_muscle) setSelectedMuscles([goal.focus_muscle as FocusMuscle]);
      } catch {
        /* defaults */
      }
    })();
  }, []);

  useEffect(() => {
    if (plan) void loadDay(selectedDay);
  }, [plan, selectedDay, loadDay]);

  const startGenerate = async () => {
    generatingRef.current = true;
    setGenerating(true);
    setGenStep(0);
    const seq = ++loadSeqRef.current;
    progressTimer.current = setInterval(() => setGenStep((s) => Math.min(s + 1, 4)), 5000);
    try {
      const created = await generateWorkoutPlan(selectedMuscles);
      if (seq !== loadSeqRef.current) return;
      if (!created?.plan_id || !created.month_overview?.length) {
        throw new Error("Server returned an incomplete plan. Please try again.");
      }
      applyPlan(created);
      const refreshed = await fetchWorkoutPlanCurrent();
      if (seq === loadSeqRef.current && refreshed) {
        applyPlan(refreshed);
      }
    } catch (e: unknown) {
      if (seq === loadSeqRef.current) {
        const msg =
          axios.isAxiosError(e) && typeof e.response?.data?.detail === "string"
            ? e.response.data.detail
            : e instanceof Error
              ? e.message
              : "Could not generate workout plan";
        Alert.alert("Generation failed", msg);
      }
    } finally {
      if (progressTimer.current) clearInterval(progressTimer.current);
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const handleExerciseSwapPress = (day: number, index: number, name: string, muscle: string) => {
    if (!canSwapExercises || exerciseSwapsRemaining <= 0) {
      notifyUser("Swap limit", exerciseSwapsRemaining <= 0 ? "5/5 swaps used today" : "Future days cannot be edited");
      return;
    }
    setSwapExerciseTarget({ day, index, name, muscle });
    setShowExerciseSwapSheet(true);
  };

  const handleExerciseSwapConfirm = async (reason?: string) => {
    if (!swapExerciseTarget || !plan) return;
    setShowExerciseSwapSheet(false);
    setSwappingExerciseIndex(swapExerciseTarget.index);
    try {
      const updated = await swapWorkoutExercise({
        plan_id: plan.plan_id,
        day: swapExerciseTarget.day,
        exercise_index: swapExerciseTarget.index,
        reason,
      });
      setDayDetail(updated);
      if (typeof updated.swaps_used_today === "number") setExerciseSwapsUsed(updated.swaps_used_today);
      notifyUser("Done", "Exercise replaced!");
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 429) {
        setExerciseSwapsUsed(exerciseSwapsLimit);
        notifyUser("Swap limit", detail || "You've used all your swaps for today.");
      } else {
        Alert.alert("Error", "Could not replace exercise. Try again.");
      }
    } finally {
      setSwappingExerciseIndex(null);
      setSwapExerciseTarget(null);
    }
  };

  const handleRegenerateWorkout = async () => {
    if (!plan || !dayDetail) {
      notifyUser("Error", "Workout plan is still loading. Try again in a moment.");
      return;
    }
    if (dayDetail.locked) {
      notifyUser("Not available", dayDetail.message ?? "This day's workout is not unlocked yet.");
      return;
    }
    if (isWorkoutRestDay(dayDetail)) return;

    if (!plannerLimitsExempt && dayRegensRemaining <= 0) {
      notifyUser(
        "Regenerate limit reached",
        `You've used all regenerations for ${monthYearLabel(plan.month, plan.year)}. Resets ${resetMonthLabel}.`,
      );
      return;
    }

    regeneratingWorkoutRef.current = true;
    setIsRegeneratingWorkout(true);
    try {
      const updated = await regenerateWorkoutPlanDay({ plan_id: plan.plan_id, day: dayDetail.day });
      const nextDetail: WorkoutDayPlan = {
        ...updated,
        exercises: [...(updated.exercises ?? [])],
      };
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setDayDetail(nextDetail);
      setExerciseListVersion((v) => v + 1);
      syncWorkoutRegenStats(updated, setDayRegensUsed, setDayRegensLimit, setDayRegensRemaining, setPlannerLimitsExempt);
      setPlan((prev) => (prev ? { ...prev, ...updated } : prev));
      const left = updated.day_regens_remaining ?? Math.max(0, dayRegensRemaining - 1);
      notifyUser(
        "Workout regenerated!",
        plannerLimitsExempt ? "Test account — unlimited regenerations." : `${left} left this month`,
      );
    } catch (e: unknown) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 429) {
        setDayRegensRemaining(0);
        setDayRegensUsed(dayRegensLimit);
        notifyUser(
          "Regenerate limit reached",
          apiErrorMessage(e, `You've used all regenerations for this month. Resets ${resetMonthLabel}.`),
        );
      } else {
        notifyUser("Regeneration failed", apiErrorMessage(e, "Could not regenerate workout. Please try again."));
      }
    } finally {
      regeneratingWorkoutRef.current = false;
      setIsRegeneratingWorkout(false);
    }
  };

  const handleRegenerateMonthPlan = async () => {
    if (!plan) return;
    if (!plannerLimitsExempt && monthPlanRegensRemaining <= 0) {
      notifyUser(
        "Month plan limit reached",
        `You've used all month plan regenerations. Resets ${resetMonthLabel}.`,
      );
      return;
    }

    regeneratingMonthPlanRef.current = true;
    setIsRegeneratingMonthPlan(true);
    try {
      const updated = await regenerateWorkoutMonthPlan(plan.plan_id);
      applyPlan(updated);
      if (selectedDay) {
        try {
          const d = await fetchWorkoutPlanDay(selectedDay);
          setDayDetail(d);
          setExerciseListVersion((v) => v + 1);
          syncWorkoutRegenStats(d, setDayRegensUsed, setDayRegensLimit, setDayRegensRemaining, setPlannerLimitsExempt);
        } catch {
          /* day may be locked */
        }
      }
      const left = updated.month_plan_regens_remaining ?? Math.max(0, monthPlanRegensRemaining - 1);
      notifyUser(
        "Month plan regenerated!",
        plannerLimitsExempt ? "Test account — unlimited regenerations." : `${left} left this month`,
      );
    } catch (e: unknown) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 429) {
        setMonthPlanRegensRemaining(0);
        setMonthPlanRegensUsed(monthPlanRegensLimit);
        notifyUser(
          "Month plan limit reached",
          apiErrorMessage(e, `Month plan limit reached. Resets ${resetMonthLabel}.`),
        );
      } else {
        notifyUser("Regeneration failed", apiErrorMessage(e, "Failed to regenerate plan. Please try again."));
      }
    } finally {
      regeneratingMonthPlanRef.current = false;
      setIsRegeneratingMonthPlan(false);
    }
  };

  const handleMuscleToggle = (muscle: string) => {
    if (muscle === "Balanced") {
      setSelectedMuscles([]);
      return;
    }
    const m = muscle as FocusMuscle;
    setSelectedMuscles((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const isMuscleSelected = (muscle: string): boolean => {
    if (muscle === "Balanced") return selectedMuscles.length === 0;
    return selectedMuscles.includes(muscle as FocusMuscle);
  };

  const calendarDays = useMemo(
    () =>
      (plan?.month_overview ?? []).map((d) => ({
        day: d.day,
        is_past: d.is_past,
        is_today: d.is_today,
        is_future: d.is_future,
        is_rest_day: d.is_rest_day,
        split_name: d.split_name,
      })),
    [plan],
  );

  const headerTitle = monthYearLabel(now.getMonth() + 1, now.getFullYear());
  const activeFocusMuscles = plan ? planFocusMuscles(plan) : selectedMuscles;
  const showFocusBadge = activeFocusMuscles.length > 0;
  if (loading) {
    return (
      <ScreenContainer>
        <ActivityIndicator color="#22d3ee" style={{ marginTop: 40 }} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={[styles.backBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.md }]}>
          <Text style={{ color: colors.text }}>←</Text>
        </Pressable>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Monthly Workout Planner</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{headerTitle}</Text>
        </View>
      </View>

      {plan && !generating ? (
        <View style={[styles.focusBadge, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md }]}>
          {showFocusBadge ? (
            <Text style={{ color: "#22d3ee", fontWeight: "700" }}>
              🎯 Focusing on: {activeFocusMuscles.join(", ")} this month
            </Text>
          ) : null}
          <RegenerateActionButton
            label="Regenerate Month Plan"
            loadingLabel="Regenerating plan…"
            isLoading={isRegeneratingMonthPlan}
            disabled={!canPressRegenerateMonthPlan}
            remaining={monthPlanRegensRemaining}
            exempt={plannerLimitsExempt}
            resetLabel={resetMonthLabel}
            compact
            onPress={() => void handleRegenerateMonthPlan()}
          />
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {!plan && !generating ? (
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>Generate your workout plan for {headerTitle}</Text>
            <Text style={[styles.label, { color: colors.muted }]}>Muscle Focus (optional):</Text>
            <View style={styles.pills}>
              {MUSCLE_PILL_OPTIONS.map((muscle) => (
                <Pressable
                  key={muscle}
                  style={[styles.musclePill, isMuscleSelected(muscle) && styles.musclePillSelected]}
                  onPress={() => handleMuscleToggle(muscle)}
                >
                  <Text style={[styles.musclePillText, isMuscleSelected(muscle) && styles.musclePillTextSelected]}>{muscle}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.muscleSelectionHint}>{muscleSelectionHint(selectedMuscles)}</Text>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ Goal: {preview.goal.replace("_", " ")}</Text>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ Level: {preview.difficulty}</Text>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ {preview.wpw} training days/week</Text>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ Progressive overload across the month</Text>
            <Pressable style={styles.genBtn} onPress={() => void startGenerate()}>
              <Text style={styles.genBtnText}>🤖 Generate My Workout Plan</Text>
            </Pressable>
          </View>
        ) : null}

        {generating ? (
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>🏋️ Building your training plan...</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(100, (genStep / 4) * 100)}%` }]} />
            </View>
            <Text style={{ color: colors.muted, marginTop: 8 }}>Week {Math.min(4, Math.max(1, genStep))} of 4</Text>
            <Text style={{ color: colors.muted, marginTop: 12 }}>{LOADING_MSGS[genStep % LOADING_MSGS.length]}</Text>
            <ActivityIndicator color="#22d3ee" style={{ marginTop: 16 }} />
          </View>
        ) : null}

        {plan && !generating ? (
          <>
            <PlannerMonthCalendar
              month={plan.month}
              year={plan.year}
              days={calendarDays}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              mode="workout"
            />

            {dayDetail?.locked ? (
              <View style={[styles.locked, { borderColor: colors.border, borderRadius: radius.lg }]}>
                <Text style={{ fontSize: 32 }}>🔒</Text>
                <Text style={{ color: colors.muted, marginTop: 8 }}>{dayDetail.message}</Text>
              </View>
            ) : dayDetail ? (
              <>
                <View style={[styles.dayHeader, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
                  <Text style={[styles.dayTitle, { color: colors.text }]}>📅 Day {dayDetail.day} — {fullDayLabel(plan.month, plan.year, dayDetail.day)}</Text>
                  <Text style={[styles.split, { color: "#22d3ee" }]}>{dayDetail.split_name.toUpperCase()}</Text>
                  {!isWorkoutRestDay(dayDetail) ? (
                    <>
                      <Text style={{ color: colors.muted, marginTop: 6 }}>Focus: {dayDetail.focus_muscles.join(", ")}</Text>
                      <Text style={{ color: colors.muted }}>Est. Duration: {dayDetail.estimated_duration_min} min</Text>
                      {activeFocusMuscles.length > 0 &&
                      dayDetail.focus_muscles.some((m) =>
                        activeFocusMuscles.some((f) => m.toLowerCase().includes(f.toLowerCase())),
                      ) ? (
                        <Text style={{ color: "#fbbf24", marginTop: 6 }}>🎯 Extra {activeFocusMuscles.join(", ")} Volume</Text>
                      ) : null}

                      {showRegenerateWorkout ? (
                        <RegenerateActionButton
                          label="Regenerate Workout"
                          loadingLabel="Regenerating workout…"
                          isLoading={isRegeneratingWorkout}
                          disabled={!canPressRegenerateWorkout}
                          remaining={dayRegensRemaining}
                          exempt={plannerLimitsExempt}
                          resetLabel={resetMonthLabel}
                          onPress={() => void handleRegenerateWorkout()}
                        />
                      ) : null}
                    </>
                  ) : null}
                </View>

                {isWorkoutRestDay(dayDetail) ? (
                  <View style={[styles.restBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
                    <Text style={{ fontSize: 40, textAlign: "center" }}>😴</Text>
                    <Text style={[styles.restTitle, { color: colors.text }]}>REST DAY</Text>
                    <Text style={{ color: colors.muted, marginTop: 10, lineHeight: 22 }}>
                      Your muscles grow during rest. Use today to:{"\n"}• Get 7-8 hours of sleep{"\n"}• Drink 3L of water{"\n"}• Do 10 minutes of light stretching
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.exerciseList, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
                    {canSwapExercises && exerciseSwapsRemaining <= 0 ? (
                      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>5/5 exercise swaps used today</Text>
                    ) : null}
                    {dayDetail.exercises.map((ex, i) => (
                      <View key={`${exerciseListVersion}-${ex.name}-${i}`} style={styles.exercise}>
                        {swappingExerciseIndex === i ? (
                          <View style={styles.swapLoadingRow}>
                            <ActivityIndicator color="#4ADE80" size="small" />
                            <Text style={{ color: "#4ADE80", marginLeft: 8 }}>Finding a replacement...</Text>
                          </View>
                        ) : (
                          <>
                            <View style={styles.exerciseHeaderRow}>
                              <Text style={[styles.exName, { color: colors.text, flex: 1 }]}>
                                {i + 1}. {ex.name}
                              </Text>
                              {canSwapExercises && exerciseSwapsRemaining > 0 ? (
                                <Pressable
                                  style={styles.exerciseSwapButton}
                                  onPress={() => handleExerciseSwapPress(dayDetail.day, i, ex.name, ex.muscle)}
                                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                  <Ionicons name="swap-horizontal" size={16} color="#4ADE80" />
                                </Pressable>
                              ) : null}
                            </View>
                            <Text style={{ color: colors.muted, marginTop: 4 }}>
                              {ex.sets} × {ex.reps} · {ex.muscle} · Rest: {ex.rest_seconds}s
                            </Text>
                            <Text style={{ color: "#94a3b8", marginTop: 4 }}>↳ {ex.note}</Text>
                          </>
                        )}
                      </View>
                    ))}
                  </View>
                )}

              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      </View>

      <SwapBottomSheet
        visible={showExerciseSwapSheet}
        title={swapExerciseTarget ? `Replace ${swapExerciseTarget.name}?` : "Replace exercise?"}
        subtitle={swapExerciseTarget ? `Target muscle: ${swapExerciseTarget.muscle}` : undefined}
        reasons={EXERCISE_SWAP_REASONS}
        confirmLabel="Replace Exercise"
        onConfirm={(reason) => void handleExerciseSwapConfirm(reason)}
        onCancel={() => {
          setShowExerciseSwapSheet(false);
          setSwapExerciseTarget(null);
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  title: { fontSize: 20, fontWeight: "800" },
  sub: { fontSize: 13 },
  focusBadge: { borderWidth: 1, padding: 10, marginBottom: 10 },
  panel: { borderWidth: 1, padding: 16, marginBottom: 14 },
  panelTitle: { fontSize: 17, fontWeight: "700", marginBottom: 12 },
  label: { fontSize: 13, marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { borderWidth: 1, borderColor: "#334155", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  pillOn: { borderColor: "#22d3ee", backgroundColor: "rgba(34,211,238,0.12)" },
  pillText: { color: "#9AA8C4", fontSize: 13 },
  pillTextOn: { color: "#22d3ee", fontWeight: "700" },
  bullet: { fontSize: 13, marginBottom: 4 },
  genBtn: { marginTop: 16, backgroundColor: "#22d3ee", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  genBtnText: { color: "#0f172a", fontWeight: "800", fontSize: 15 },
  progressTrack: { height: 8, backgroundColor: "#1e293b", borderRadius: 4, overflow: "hidden", marginTop: 12 },
  progressFill: { height: 8, backgroundColor: "#22d3ee" },
  locked: { borderWidth: 1, padding: 32, alignItems: "center", marginVertical: 16 },
  dayHeader: { borderWidth: 1, padding: 14, marginBottom: 10 },
  dayTitle: { fontSize: 15, fontWeight: "700" },
  split: { fontSize: 18, fontWeight: "800", marginTop: 8, letterSpacing: 1 },
  restBox: { borderWidth: 1, padding: 24, marginBottom: 12 },
  restTitle: { fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: 8 },
  exerciseList: { borderWidth: 1, padding: 14, marginBottom: 12 },
  exercise: { marginBottom: 16 },
  exerciseHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  exerciseSwapButton: { padding: 6, borderRadius: 8, backgroundColor: "rgba(74, 222, 128, 0.12)" },
  swapLoadingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  exName: { fontSize: 15, fontWeight: "700" },
  musclePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.2)",
    backgroundColor: "transparent",
  },
  musclePillSelected: {
    borderColor: "#22D3EE",
    backgroundColor: "rgba(34, 211, 238, 0.15)",
  },
  musclePillText: { color: "#94A3B8", fontSize: 13, fontWeight: "500" },
  musclePillTextSelected: { color: "#22D3EE", fontWeight: "700" },
  muscleSelectionHint: { color: "#64748B", fontSize: 12, marginTop: 6, marginBottom: 4 },
  regenerateWorkoutBtn: {
    marginTop: 14,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2ECC9A",
    backgroundColor: "#1E2D2F",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  regenerateMonthPlanBtn: {
    marginTop: 10,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2ECC9A",
    backgroundColor: "#1E2D2F",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  regenerateWorkoutBtnDisabled: {
    opacity: 0.45,
    borderColor: "#475569",
  },
  regenButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  regenButtonLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  regenerateWorkoutBtnText: {
    color: "#2ECC9A",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  regenerateMonthPlanBtnText: {
    color: "#2ECC9A",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  regenerateWorkoutBtnTextDisabled: {
    color: "#64748b",
  },
  regenBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexShrink: 0,
  },
  regenBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
});
