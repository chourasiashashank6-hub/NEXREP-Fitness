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
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
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
import { auth } from "../../services/authService";
import { useAuthStore } from "../../store/authStore";
import { formatApiDetail, notifyUser } from "../../utils/notify";
import {
  getNotificationPermissionState,
  requestNotificationPermissions,
  rescheduleWorkoutPlanNotifications,
} from "../../services/notificationService";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import type { FocusMuscle, WorkoutDayPlan, WorkoutPlanCurrent } from "../../types/planner";
import { fullDayLabel, getNextMonthResetLabel, isPastPlanDay, monthYearLabel } from "../../utils/localDate";

const PURPLE_MID = '#7B68CC';
const PURPLE_LIGHT = '#F0EEF9';
const GREEN = '#0F6E56';
const GREEN_LIGHT = '#E8F5EE';
const BLUE = '#4A90D9';
const BLUE_LIGHT = '#EEF4FB';
const ORANGE = '#D85A30';
const ORANGE_LIGHT = '#FFF1EE';
const AMBER = '#FFB800';
const AMBER_LIGHT = '#FFF8E8';
const AMBER_TEXT = '#C08000';
const GOLD = '#FFD700';
const BG = '#F7F6F3';
const WHITE = '#FFFFFF';
const TEXT = '#1A1A18';
const MUTED = '#BBBBBB';
const TRACK = '#E5E4E0';
const BORDER = '#ECEAE5';
const SCREEN_BG = '#FFFFFF';

const MUSCLE_TAG: Record<string, { bg: string; text: string }> = {
  Chest:     { bg: GREEN_LIGHT,  text: GREEN   },
  Back:      { bg: ORANGE_LIGHT, text: ORANGE  },
  Shoulders: { bg: GREEN_LIGHT,  text: GREEN   },
  Triceps:   { bg: BLUE_LIGHT,   text: BLUE    },
  Biceps:    { bg: BLUE_LIGHT,   text: BLUE    },
  Legs:      { bg: AMBER_LIGHT,  text: AMBER_TEXT },
  Core:      { bg: PURPLE_LIGHT, text: PURPLE_MID },
};
const defaultMuscleTag = { bg: BG, text: MUTED };

const MUSCLE_PILL_OPTIONS = ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core", "Balanced"] as const;

function musclePillLabel(muscle: string): string {
  const key = muscle.toLowerCase();
  return i18n.t(`coach.workoutPlannerScreen.muscles.${key}`, { defaultValue: muscle });
}

function planFocusMuscles(plan: WorkoutPlanCurrent | null): FocusMuscle[] {
  if (plan?.focus_muscles?.length) return plan.focus_muscles;
  if (plan?.focus_muscle) return [plan.focus_muscle];
  return [];
}

function muscleSelectionHint(muscles: FocusMuscle[]): string {
  if (muscles.length === 0) return i18n.t("coach.workoutPlannerScreen.balancedHint");
  if (muscles.length === 1) return i18n.t("coach.workoutPlannerScreen.singleMuscleHint", { muscle: muscles[0] });
  return i18n.t("coach.workoutPlannerScreen.multiMuscleHint", { muscles: muscles.join(", ") });
}

const MAX_WORKOUT_REGENS_PER_MONTH = 2;
const MAX_MONTH_PLAN_REGENS_PER_MONTH = 2;
const PLANNER_DAYS_UNLOCK_EMAILS = new Set(["shashank1@gmail.com"]);
const PLANNER_DAYS_UNLOCK_USER_IDS = new Set(["2"]);

type RegenBadgeProps = {
  remaining: number;
  exempt: boolean;
  resetLabel: string;
};

function RegenUsageBadge({ remaining, exempt, resetLabel }: RegenBadgeProps) {
  if (exempt) return null;

  const badgeText =
    remaining <= 0
      ? i18n.t("coach.workoutPlannerScreen.resets", { date: resetLabel })
      : i18n.t("coach.workoutPlannerScreen.leftThisMonth", { prefix: remaining <= 1 ? "⚠ " : "", count: remaining });

  const badgeColor = remaining <= 0 ? MUTED : remaining === 1 ? AMBER_TEXT : ORANGE;
  const badgeBg =
    remaining <= 0
      ? TRACK
      : remaining === 1
        ? AMBER_LIGHT
        : ORANGE_LIGHT;

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
            <ActivityIndicator size="small" color={WHITE} />
          ) : (
            <Ionicons name="refresh" size={compact ? 16 : 18} color={disabled ? MUTED : WHITE} />
          )}
          <Text
            style={[
              compact ? styles.regenerateMonthPlanBtnText : styles.regenerateWorkoutBtnText,
              disabled && styles.regenerateWorkoutBtnTextDisabled,
            ]}
          >
            {isLoading ? loadingLabel : showLimitLabel ? i18n.t("coach.workoutPlannerScreen.limitReached") : label}
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
      return i18n.t("coach.workoutPlannerScreen.timeout");
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
  planner_days_unlocked?: boolean;
};

function syncWorkoutRegenStats(
  source: RegenStatsSource | null | undefined,
  setUsed: (n: number) => void,
  setLimit: (n: number) => void,
  setRemaining: (n: number) => void,
  setExempt?: (v: boolean) => void,
  setDaysUnlocked?: (v: boolean) => void,
) {
  if (source?.day_regens_used !== undefined) setUsed(source.day_regens_used);
  if (source?.day_regens_limit !== undefined) setLimit(source.day_regens_limit ?? MAX_WORKOUT_REGENS_PER_MONTH);
  if (source?.day_regens_remaining !== undefined) setRemaining(source.day_regens_remaining);
  if (setExempt && source?.planner_limits_exempt !== undefined) setExempt(source.planner_limits_exempt);
  if (setDaysUnlocked && source?.planner_days_unlocked !== undefined) setDaysUnlocked(source.planner_days_unlocked);
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
  i18n.t("coach.workoutPlannerScreen.loadingMessages.weeklySplit"),
  i18n.t("coach.workoutPlannerScreen.loadingMessages.balancing"),
  i18n.t("coach.workoutPlannerScreen.loadingMessages.overload"),
  i18n.t("coach.workoutPlannerScreen.loadingMessages.cues"),
];

export default function MonthlyWorkoutPlannerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
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
  const [plannerDaysUnlocked, setPlannerDaysUnlocked] = useState(false);
  const [isRegeneratingWorkout, setIsRegeneratingWorkout] = useState(false);
  const [monthPlanRegensUsed, setMonthPlanRegensUsed] = useState(0);
  const [monthPlanRegensLimit, setMonthPlanRegensLimit] = useState(MAX_MONTH_PLAN_REGENS_PER_MONTH);
  const [monthPlanRegensRemaining, setMonthPlanRegensRemaining] = useState(MAX_MONTH_PLAN_REGENS_PER_MONTH);
  const [isRegeneratingMonthPlan, setIsRegeneratingMonthPlan] = useState(false);
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const signedInEmail = String(auth.currentUser?.email || "")
    .trim()
    .toLowerCase();
  const plannerDaysUnlockedByIdentity =
    PLANNER_DAYS_UNLOCK_EMAILS.has(signedInEmail) ||
    (sessionUserId ? PLANNER_DAYS_UNLOCK_USER_IDS.has(sessionUserId) : false);
  const canViewFutureDays = plannerDaysUnlocked || plannerDaysUnlockedByIdentity;
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
  const canSwapExercises = Boolean(
    selectedWorkoutOverview && (canViewFutureDays || !selectedWorkoutOverview.is_future) && plan,
  );
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
    (selectedWorkoutOverview?.is_today || selectedWorkoutOverview?.is_future || canViewFutureDays),
  );
  const canPressRegenerateWorkout =
    showRegenerateWorkout && (plannerLimitsExempt || dayRegensRemaining > 0);
  const canPressRegenerateMonthPlan = Boolean(
    plan && (plannerLimitsExempt || monthPlanRegensRemaining > 0),
  );

  const applyPlan = useCallback((current: WorkoutPlanCurrent | null) => {
    setPlan(current);
    if (current) {
      syncWorkoutRegenStats(
        current,
        setDayRegensUsed,
        setDayRegensLimit,
        setDayRegensRemaining,
        setPlannerLimitsExempt,
        setPlannerDaysUnlocked,
      );
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
      if (overview?.is_future && !canViewFutureDays) {
        setDayDetail({
          day,
          is_rest_day: false,
          split_name: overview.split_name,
          focus_muscles: [],
          exercises: [],
          estimated_duration_min: 0,
          locked: true,
          message: t("coach.workoutPlannerScreen.unlocksOn", { date: fullDayLabel(plan.month, plan.year, day) }),
        });
        return;
      }
      try {
        const d = await fetchWorkoutPlanDay(day);
        setDayDetail(d);
        if (typeof d.swaps_used_today === "number") setExerciseSwapsUsed(d.swaps_used_today);
        syncWorkoutRegenStats(d, setDayRegensUsed, setDayRegensLimit, setDayRegensRemaining, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      } catch {
        setDayDetail(null);
      }
    },
    [canViewFutureDays, plan, t],
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
        const fromOnboarding = goal?.focus_muscles;
        if (Array.isArray(fromOnboarding) && fromOnboarding.length > 0) {
          setSelectedMuscles(fromOnboarding as FocusMuscle[]);
        } else if (goal?.focus_muscle) {
          setSelectedMuscles([goal.focus_muscle as FocusMuscle]);
        }
      } catch {
        /* defaults */
      }
    })();
  }, []);

  useEffect(() => {
    if (plan) void loadDay(selectedDay);
  }, [plan, selectedDay, loadDay]);

  useEffect(() => {
    if (!plan) return;
    void (async () => {
      const permission = await getNotificationPermissionState().catch(() => null);
      if (permission?.granted) {
        await rescheduleWorkoutPlanNotifications(plan).catch(() => undefined);
      }
    })();
  }, [plan]);

  const startGenerate = async () => {
    generatingRef.current = true;
    setGenerating(true);
    setGenStep(0);
    const seq = ++loadSeqRef.current;
    progressTimer.current = setInterval(() => setGenStep((s) => Math.min(s + 1, 4)), 5000);
    try {
      await requestNotificationPermissions("workout_schedule").catch(() => undefined);
      const created = await generateWorkoutPlan(selectedMuscles);
      if (seq !== loadSeqRef.current) return;
      if (!created?.plan_id || !created.month_overview?.length) {
        throw new Error(t("coach.workoutPlannerScreen.alerts.incompletePlan"));
      }
      applyPlan(created);
      await rescheduleWorkoutPlanNotifications(created).catch(() => undefined);
    } catch (e: unknown) {
      if (seq === loadSeqRef.current) {
        const msg =
          axios.isAxiosError(e) && typeof e.response?.data?.detail === "string"
            ? e.response.data.detail
            : e instanceof Error
              ? e.message
              : t("coach.workoutPlannerScreen.alerts.couldNotGenerate");
        Alert.alert(t("coach.workoutPlannerScreen.alerts.generationFailed"), msg);
      }
    } finally {
      if (progressTimer.current) clearInterval(progressTimer.current);
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const handleExerciseSwapPress = (day: number, index: number, name: string, muscle: string) => {
    if (!canSwapExercises || exerciseSwapsRemaining <= 0) {
      notifyUser(
        t("coach.workoutPlannerScreen.alerts.swapLimit"),
        exerciseSwapsRemaining <= 0 ? t("coach.workoutPlannerScreen.swapLimitUsed") : t("coach.workoutPlannerScreen.alerts.futureDaysLocked"),
      );
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
      notifyUser(t("coach.workoutPlannerScreen.alerts.done"), t("coach.workoutPlannerScreen.alerts.exerciseReplaced"));
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 429) {
        setExerciseSwapsUsed(exerciseSwapsLimit);
        notifyUser(t("coach.workoutPlannerScreen.alerts.swapLimit"), detail || t("coach.workoutPlannerScreen.alerts.swapsUsed"));
      } else {
        Alert.alert(t("coach.workoutPlannerScreen.alerts.error"), t("coach.workoutPlannerScreen.alerts.replaceFailed"));
      }
    } finally {
      setSwappingExerciseIndex(null);
      setSwapExerciseTarget(null);
    }
  };

  const handleRegenerateWorkout = async () => {
    if (!plan || !dayDetail) {
      notifyUser(t("coach.workoutPlannerScreen.alerts.error"), t("coach.workoutPlannerScreen.alerts.stillLoading"));
      return;
    }
    if (dayDetail.locked) {
      notifyUser(t("coach.workoutPlannerScreen.alerts.notAvailable"), dayDetail.message ?? t("coach.workoutPlannerScreen.alerts.notUnlocked"));
      return;
    }
    if (isWorkoutRestDay(dayDetail)) return;

    if (!plannerLimitsExempt && dayRegensRemaining <= 0) {
      notifyUser(
        t("coach.workoutPlannerScreen.alerts.regenerateLimitReached"),
        t("coach.workoutPlannerScreen.alerts.allRegensUsedForMonth", { month: monthYearLabel(plan.month, plan.year), resetDate: resetMonthLabel }),
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
      syncWorkoutRegenStats(updated, setDayRegensUsed, setDayRegensLimit, setDayRegensRemaining, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      const left = updated.day_regens_remaining ?? Math.max(0, dayRegensRemaining - 1);
      notifyUser(
        t("coach.workoutPlannerScreen.alerts.workoutRegenerated"),
        plannerLimitsExempt ? t("coach.workoutPlannerScreen.alerts.testUnlimited") : t("coach.workoutPlannerScreen.leftThisMonth", { prefix: "", count: left }),
      );
    } catch (e: unknown) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 429) {
        setDayRegensRemaining(0);
        setDayRegensUsed(dayRegensLimit);
        notifyUser(
          t("coach.workoutPlannerScreen.alerts.regenerateLimitReached"),
          apiErrorMessage(e, t("coach.workoutPlannerScreen.alerts.allRegensUsed", { resetDate: resetMonthLabel })),
        );
      } else {
        notifyUser(t("coach.workoutPlannerScreen.alerts.regenerationFailed"), apiErrorMessage(e, t("coach.workoutPlannerScreen.alerts.workoutRegenerateFailed")));
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
        t("coach.workoutPlannerScreen.alerts.monthPlanLimitReached"),
        t("coach.workoutPlannerScreen.alerts.allMonthRegensUsed", { resetDate: resetMonthLabel }),
      );
      return;
    }

    regeneratingMonthPlanRef.current = true;
    setIsRegeneratingMonthPlan(true);
    try {
      const updated = await regenerateWorkoutMonthPlan(plan.plan_id);
      applyPlan(updated);
      await rescheduleWorkoutPlanNotifications(updated).catch(() => undefined);
      if (selectedDay) {
        try {
          const d = await fetchWorkoutPlanDay(selectedDay);
          setDayDetail(d);
          setExerciseListVersion((v) => v + 1);
          syncWorkoutRegenStats(d, setDayRegensUsed, setDayRegensLimit, setDayRegensRemaining, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        } catch {
          /* day may be locked */
        }
      }
      const left = updated.month_plan_regens_remaining ?? Math.max(0, monthPlanRegensRemaining - 1);
      notifyUser(
        t("coach.workoutPlannerScreen.alerts.monthPlanRegenerated"),
        plannerLimitsExempt ? t("coach.workoutPlannerScreen.alerts.testUnlimited") : t("coach.workoutPlannerScreen.leftThisMonth", { prefix: "", count: left }),
      );
    } catch (e: unknown) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 429) {
        setMonthPlanRegensRemaining(0);
        setMonthPlanRegensUsed(monthPlanRegensLimit);
        notifyUser(
          t("coach.workoutPlannerScreen.alerts.monthPlanLimitReached"),
          apiErrorMessage(e, t("coach.workoutPlannerScreen.alerts.monthPlanLimitReset", { resetDate: resetMonthLabel })),
        );
      } else {
        notifyUser(t("coach.workoutPlannerScreen.alerts.regenerationFailed"), apiErrorMessage(e, t("coach.workoutPlannerScreen.alerts.monthPlanRegenerateFailed")));
      }
    } finally {
      regeneratingMonthPlanRef.current = false;
      setIsRegeneratingMonthPlan(false);
    }
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
      <ScreenContainer bg={SCREEN_BG} contentStyle={styles.loadingContent}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={ORANGE} />
          <Text style={styles.loadingText}>{t("coach.workoutPlannerScreen.loading")}</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer bg={SCREEN_BG}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title}>{t("coach.workoutPlannerScreen.title")}</Text>
          <Text style={styles.sub}>{headerTitle}</Text>
        </View>
        {plan && !generating ? (
          <View style={styles.headerActionRow}>
            {showRegenerateWorkout ? (
              <Pressable
                onPress={() => void handleRegenerateWorkout()}
                disabled={isRegeneratingWorkout}
                style={[styles.headerWorkoutPill, isRegeneratingWorkout && styles.headerMonthPillDisabled]}
              >
                {isRegeneratingWorkout ? (
                  <ActivityIndicator size="small" color={ORANGE} />
                ) : (
                  <Ionicons name="refresh" size={13} color={ORANGE} />
                )}
                <Text style={styles.headerMonthPillText}>{t("coach.workoutPlannerScreen.day")}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void handleRegenerateMonthPlan()}
              disabled={isRegeneratingMonthPlan}
              style={[styles.headerMonthPill, isRegeneratingMonthPlan && styles.headerMonthPillDisabled]}
            >
              {isRegeneratingMonthPlan ? (
                <ActivityIndicator size="small" color={ORANGE} />
              ) : (
                <Ionicons name="refresh" size={13} color={ORANGE} />
              )}
              <Text style={styles.headerMonthPillText}>{t("coach.workoutPlannerScreen.month")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.screenBody}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {!plan && !generating ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{t("coach.workoutPlannerScreen.generateTitle", { month: headerTitle })}</Text>
              <Text style={styles.label}>{t("coach.workoutPlannerScreen.muscleFocus")}</Text>
              <View style={styles.pills}>
                {MUSCLE_PILL_OPTIONS.map((muscle) => (
                  <View
                    key={muscle}
                    style={[styles.musclePill, isMuscleSelected(muscle) && styles.musclePillSelected]}
                  >
                    <Text style={[styles.musclePillText, isMuscleSelected(muscle) && styles.musclePillTextSelected]}>{musclePillLabel(muscle)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.muscleSelectionHint}>{muscleSelectionHint(selectedMuscles)}</Text>
              <Text style={styles.bullet}>{t("coach.workoutPlannerScreen.goal", { goal: preview.goal.replace("_", " ") })}</Text>
              <Text style={styles.bullet}>{t("coach.workoutPlannerScreen.level", { level: preview.difficulty })}</Text>
              <Text style={styles.bullet}>{t("coach.workoutPlannerScreen.trainingDays", { count: preview.wpw })}</Text>
              <Text style={styles.bullet}>{t("coach.workoutPlannerScreen.progressiveOverload")}</Text>
              <Pressable style={styles.genBtn} onPress={() => void startGenerate()}>
                <Text style={styles.genBtnText}>{t("coach.workoutPlannerScreen.generateButton")}</Text>
              </Pressable>
            </View>
          ) : null}

          {generating ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{t("coach.workoutPlannerScreen.building")}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (genStep / 4) * 100)}%` }]} />
              </View>
              <Text style={styles.progressMeta}>{t("coach.workoutPlannerScreen.weekProgress", { week: Math.min(4, Math.max(1, genStep)) })}</Text>
              <Text style={styles.progressStep}>{LOADING_MSGS[genStep % LOADING_MSGS.length]}</Text>
              <ActivityIndicator color={ORANGE} style={styles.progressSpinner} />
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
                allowFutureSelection={canViewFutureDays}
              />

              {dayDetail?.locked ? (
                <View style={styles.locked}>
                  <Ionicons name="lock-closed-outline" size={24} color={MUTED} />
                  <Text style={styles.lockedText}>{t("coach.workoutPlannerScreen.dayLocked")}</Text>
                  <Text style={styles.lockedMessage}>{dayDetail.message}</Text>
                </View>
              ) : dayDetail ? (
                <>
                  <View style={styles.dayHeader}>
                    <View style={styles.dayHeaderCircleOne} />
                    <View style={styles.dayHeaderCircleTwo} />
                    <Text style={styles.dayDateLabel}>
                      {t("coach.workoutPlannerScreen.dateDay", { date: fullDayLabel(plan.month, plan.year, dayDetail.day).replace(",", " ·"), day: dayDetail.day })}
                    </Text>
                    <Text style={styles.split}>{dayDetail.split_name.toUpperCase()}</Text>
                    {!isWorkoutRestDay(dayDetail) ? (
                      <>
                        <View style={styles.statChipsRow}>
                          <View style={styles.statChip}>
                            <Ionicons name="time-outline" size={13} color={WHITE} />
                            <Text style={styles.statChipText}>{t("coach.workoutPlannerScreen.minutes", { count: dayDetail.estimated_duration_min })}</Text>
                          </View>
                          <View style={styles.statChip}>
                            <Ionicons name="barbell-outline" size={13} color={WHITE} />
                            <Text style={styles.statChipText}>{t("coach.workoutPlannerScreen.exerciseCount", { count: dayDetail.exercises.length })}</Text>
                          </View>
                          <View style={styles.statChip}>
                            <Ionicons name="locate-outline" size={13} color={WHITE} />
                            <Text style={styles.statChipText}>
                              {dayDetail.split_name.toLowerCase().includes("push")
                                ? t("coach.workoutPlannerScreen.push")
                                : dayDetail.split_name.toLowerCase().includes("pull")
                                  ? t("coach.workoutPlannerScreen.pull")
                                  : dayDetail.split_name.toLowerCase().includes("leg")
                                    ? t("coach.workoutPlannerScreen.legs")
                                    : t("coach.workoutPlannerScreen.workout")}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.dayFocusPillsRow}>
                          {dayDetail.focus_muscles.map((muscle) => (
                            <View key={muscle} style={styles.dayFocusPill}>
                              <Text style={styles.dayFocusPillText}>{muscle}</Text>
                            </View>
                          ))}
                        </View>
                        {activeFocusMuscles.length > 0 &&
                        dayDetail.focus_muscles.some((m) =>
                          activeFocusMuscles.some((f) => m.toLowerCase().includes(f.toLowerCase())),
                        ) ? (
                          <View style={styles.extraVolumeNote}>
                            <Text style={styles.extraVolumeText}>{t("coach.workoutPlannerScreen.extraVolume", { muscles: activeFocusMuscles.join(", ") })}</Text>
                          </View>
                        ) : null}

                      </>
                    ) : null}
                  </View>

                  {isWorkoutRestDay(dayDetail) ? (
                    <View style={styles.restBox}>
                      <Text style={styles.restEmoji}>🌙</Text>
                      <Text style={styles.restTitle}>{t("coach.workoutPlannerScreen.restDay")}</Text>
                      <View style={styles.recoveryTipsRow}>
                        <View style={styles.recoveryTip}><Text style={styles.recoveryTipText}>{t("coach.workoutPlannerScreen.sleep")}</Text></View>
                        <View style={styles.recoveryTip}><Text style={styles.recoveryTipText}>{t("coach.workoutPlannerScreen.water")}</Text></View>
                        <View style={styles.recoveryTip}><Text style={styles.recoveryTipText}>{t("coach.workoutPlannerScreen.stretch")}</Text></View>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.exerciseList}>
                      {canSwapExercises && exerciseSwapsUsed >= (dayDetail.swaps_limit ?? exerciseSwapsLimit) ? (
                        <View style={styles.swapLimitNotice}>
                          <Text style={styles.swapLimitNoticeText}>{t("coach.workoutPlannerScreen.swapLimitUsed")}</Text>
                        </View>
                      ) : null}
                      {dayDetail.exercises.map((ex, i) => {
                        const tag = MUSCLE_TAG[ex.muscle] ?? defaultMuscleTag;
                        return (
                          <View key={`${exerciseListVersion}-${ex.name}-${i}`} style={styles.exercise}>
                            {swappingExerciseIndex === i ? (
                              <View style={styles.swapLoadingRow}>
                                <ActivityIndicator color={ORANGE} size="small" />
                                <Text style={styles.swapLoadingText}>{t("coach.workoutPlannerScreen.swapping")}</Text>
                              </View>
                            ) : (
                              <>
                                <View style={styles.exerciseNumberBadge}>
                                  <Text style={styles.exerciseNumberText}>{i + 1}</Text>
                                </View>
                                <View style={styles.exerciseMiddle}>
                                  <Text style={styles.exName}>{ex.name}</Text>
                                  <Text style={styles.exercisePrescription}>
                                    {t("coach.workoutPlannerScreen.restSeconds", { sets: ex.sets, reps: ex.reps, seconds: ex.rest_seconds })}
                                  </Text>
                                  <View style={styles.exerciseMetaRow}>
                                    <View style={[styles.muscleTag, { backgroundColor: tag.bg }]}>
                                      <Text style={[styles.muscleTagText, { color: tag.text }]}>{ex.muscle}</Text>
                                    </View>
                                    <Text style={styles.exerciseCue} numberOfLines={2}>{ex.note}</Text>
                                  </View>
                                </View>
                                {canSwapExercises && exerciseSwapsRemaining > 0 ? (
                                  <Pressable
                                    style={styles.exerciseSwapButton}
                                    onPress={() => handleExerciseSwapPress(dayDetail.day, i, ex.name, ex.muscle)}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                  >
                                    <Ionicons name="swap-horizontal" size={15} color={ORANGE} />
                                  </Pressable>
                                ) : null}
                              </>
                            )}
                          </View>
                        );
                      })}
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
        title={swapExerciseTarget ? t("coach.workoutPlannerScreen.replaceTitle", { name: swapExerciseTarget.name }) : t("coach.workoutPlannerScreen.replaceExercise")}
        subtitle={swapExerciseTarget ? t("coach.workoutPlannerScreen.targetMuscle", { muscle: swapExerciseTarget.muscle }) : undefined}
        reasons={EXERCISE_SWAP_REASONS}
        confirmLabel={t("coach.workoutPlannerScreen.replaceConfirm")}
        accentColor={ORANGE}
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
  loadingContent: { flexGrow: 1 },
  loadingWrap: { minHeight: 420, alignItems: "center", justifyContent: "center" },
  loadingText: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 10 },
  screenBody: { flex: 1 },
  header: { paddingHorizontal: 2, paddingTop: 0, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: BG },
  backBtnText: { color: TEXT, fontSize: 17, fontWeight: "800" },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  title: { color: TEXT, fontSize: 16, fontWeight: "800" },
  sub: { color: MUTED, fontSize: 11, marginTop: 2 },
  headerActionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerMonthPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: ORANGE_LIGHT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  headerWorkoutPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: ORANGE_LIGHT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  headerMonthPillDisabled: { opacity: 0.6 },
  headerMonthPillText: { color: ORANGE, fontSize: 10, fontWeight: "800" },
  panel: { backgroundColor: BG, borderRadius: 18, padding: 16, marginBottom: 14 },
  panelTitle: { color: TEXT, fontSize: 17, fontWeight: "800", marginBottom: 12 },
  label: { color: MUTED, fontSize: 13, fontWeight: "700", marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  bullet: { color: MUTED, fontSize: 13, marginBottom: 4 },
  genBtn: { marginTop: 16, backgroundColor: ORANGE, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  genBtnText: { color: WHITE, fontWeight: "800", fontSize: 14 },
  progressTrack: { height: 8, backgroundColor: TRACK, borderRadius: 99, overflow: "hidden", marginTop: 12 },
  progressFill: { height: 8, backgroundColor: ORANGE },
  progressMeta: { color: MUTED, fontSize: 12, marginTop: 8 },
  progressStep: { color: MUTED, fontSize: 12, marginTop: 12 },
  progressSpinner: { marginTop: 16 },
  locked: { backgroundColor: BG, borderRadius: 18, padding: 32, alignItems: "center", marginVertical: 16 },
  lockedText: { color: MUTED, fontSize: 13, fontWeight: "800", marginTop: 8 },
  lockedMessage: { color: MUTED, fontSize: 11, marginTop: 4, textAlign: "center" },
  dayHeader: { backgroundColor: ORANGE, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 20, marginBottom: 14, overflow: "hidden" },
  dayHeaderCircleOne: { position: "absolute", width: 130, height: 130, borderRadius: 65, right: -58, top: -44, backgroundColor: "rgba(255,255,255,0.05)" },
  dayHeaderCircleTwo: { position: "absolute", width: 92, height: 92, borderRadius: 46, left: -34, bottom: -48, backgroundColor: "rgba(255,255,255,0.05)" },
  dayDateLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", marginBottom: 4 },
  split: { color: WHITE, fontSize: 34, fontWeight: "900", letterSpacing: 0.02, lineHeight: 34, marginBottom: 12 },
  statChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  statChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statChipText: { color: WHITE, fontSize: 12, fontWeight: "800" },
  dayFocusPillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  dayFocusPill: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 99, paddingHorizontal: 11, paddingVertical: 4 },
  dayFocusPillText: { color: WHITE, fontSize: 10, fontWeight: "800" },
  extraVolumeNote: { backgroundColor: "rgba(255,215,0,0.15)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  extraVolumeText: { color: GOLD, fontSize: 11, fontWeight: "800" },
  restBox: { backgroundColor: BG, borderRadius: 18, padding: 24, alignItems: "center", marginBottom: 12 },
  restEmoji: { fontSize: 40, textAlign: "center" },
  restTitle: { color: TEXT, fontSize: 15, fontWeight: "800", marginTop: 8 },
  recoveryTipsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 14 },
  recoveryTip: { backgroundColor: ORANGE_LIGHT, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  recoveryTipText: { color: ORANGE, fontSize: 11, fontWeight: "800" },
  exerciseList: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
  swapLimitNotice: { backgroundColor: ORANGE_LIGHT, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8, marginBottom: 12 },
  swapLimitNoticeText: { color: ORANGE, fontSize: 11, fontWeight: "800" },
  exercise: { flexDirection: "row", alignItems: "flex-start", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F0EEF5" },
  exerciseNumberBadge: { width: 28, height: 28, borderRadius: 99, backgroundColor: ORANGE, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  exerciseNumberText: { color: WHITE, fontSize: 12, fontWeight: "800" },
  exerciseMiddle: { flex: 1, minWidth: 0 },
  exName: { color: TEXT, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  exercisePrescription: { color: ORANGE, fontSize: 12, fontWeight: "800", marginBottom: 4 },
  exerciseMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  muscleTag: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  muscleTagText: { fontSize: 10, fontWeight: "800" },
  exerciseCue: { color: "#AAAAAA", fontSize: 10, fontStyle: "italic", flex: 1, minWidth: 120 },
  exerciseSwapButton: { width: 26, height: 26, borderRadius: 7, backgroundColor: ORANGE_LIGHT, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  swapLoadingRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: BG, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  swapLoadingText: { color: MUTED, fontSize: 12, fontWeight: "800" },
  musclePill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: BG },
  musclePillSelected: { borderColor: ORANGE, backgroundColor: ORANGE },
  musclePillText: { color: MUTED, fontSize: 13, fontWeight: "700" },
  musclePillTextSelected: { color: WHITE, fontWeight: "800" },
  muscleSelectionHint: { color: MUTED, fontSize: 12, marginTop: 6, marginBottom: 4 },
  regenerateWorkoutBtn: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  regenerateMonthPlanBtn: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  regenerateWorkoutBtnDisabled: { opacity: 0.45 },
  regenButtonInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  regenButtonLeft: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 1, minWidth: 0 },
  regenerateWorkoutBtnText: { color: WHITE, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  regenerateMonthPlanBtnText: { color: WHITE, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  regenerateWorkoutBtnTextDisabled: { color: MUTED },
  regenBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, flexShrink: 0 },
  regenBadgeText: { fontSize: 10, fontWeight: "800" },
});
