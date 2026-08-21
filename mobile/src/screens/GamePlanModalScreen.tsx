import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { CalorieDayPayload } from "../api/caloriesLog";
import { getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { resolveApiBaseUrl } from "../api/client";
import { fetchMealPlanCurrent } from "../api/mealPlanner";
import { fetchOnboardingMeShared } from "../api/onboarding";
import { getWorkoutHistory } from "../api/workout";
import { fetchWorkoutPlanCurrent, fetchWeeklyWorkoutReview } from "../api/workoutPlanner";
import { DailyGamePlanCard } from "../components/DailyGamePlanCard";
import { BlurredModalBackdrop } from "../components/BlurredModalBackdrop";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { runSmartReflowDetection } from "../services/smartReflowRunner";
import { getGamePlanCache, setGamePlanCache, type GamePlanHistoryRow } from "../store/gamePlanCache";
import { sanitizeWorkoutPlanCurrent } from "../utils/sanitizePlannerDay";
import { useAuthStore } from "../store/authStore";
import type { MealDayPlan, WorkoutPlanCurrent } from "../types/planner";
import { isWeeklyPlannerCurrent } from "../types/planner";
import { isHomeRestDayActive } from "../utils/workoutRestDay";
import {
  collectIngredientNames,
  fetchEquipmentForExercises,
  resolveEquipmentForExercises,
  type CatalogEquipmentRow,
} from "../utils/gamePlanPrepLists";

const TEXT = "#1A1A18";
const MUTED = "#8A8A84";
const WHITE = "#FFFFFF";

type WorkoutHistoryRow = GamePlanHistoryRow;

function mapHistoryItems(items: { date: string; exerciseName?: string; type?: string; notes?: string | null; bodyPart?: string | null }[]): WorkoutHistoryRow[] {
  return items.map((item) => ({
    date: item.date,
    exerciseName: item.exerciseName,
    type: item.type,
    notes: item.notes,
    bodyPart: item.bodyPart,
  }));
}

function resolveWeightKg(weightLatestRes: { weight_kg?: number } | null, onboardingWeight: number): number {
  const latestWeight = Number(weightLatestRes?.weight_kg);
  if (Number.isFinite(latestWeight) && latestWeight > 0) return latestWeight;
  if (Number.isFinite(onboardingWeight) && onboardingWeight > 0) return onboardingWeight;
  return 70;
}

export default function GamePlanModalScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);
  const { hasFeatureAccess } = useFeatureAccess();
  const hasMealPlannerAccess = hasFeatureAccess("meal_plan_generation");
  const hasWorkoutPlannerAccess = hasFeatureAccess("workout_plan_generation");
  const canSmartReflow = hasFeatureAccess("smart_reflow");

  const [loading, setLoading] = useState(true);
  const [calorieDay, setCalorieDay] = useState<CalorieDayPayload | null>(null);
  const [todayWorkoutPlan, setTodayWorkoutPlan] = useState<WorkoutPlanCurrent | null>(null);
  const [todayMealPlan, setTodayMealPlan] = useState<MealDayPlan | null>(null);
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutHistoryRow[]>([]);
  const [weightKg, setWeightKg] = useState(70);
  const [workoutCatalog, setWorkoutCatalog] = useState<CatalogEquipmentRow[]>([]);
  const [weeklyReviewMessage, setWeeklyReviewMessage] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const loadDeferred = useCallback(
    async (exerciseNames: string[], workoutPlan: WorkoutPlanCurrent | null) => {
      if (!token) return;
      try {
        const weeklyPromise = canSmartReflow
          ? fetchWeeklyWorkoutReview()
              .then((review) => {
                const day = new Date().getDay();
                const isSundayWindow = day === 0 || day === 1;
                if (review.weekly_summary_enabled && isSundayWindow && review.message) {
                  setWeeklyReviewMessage(review.message);
                }
              })
              .catch(() => undefined)
          : Promise.resolve();

        const reflowPromise =
          canSmartReflow && workoutPlan
            ? runSmartReflowDetection(workoutPlan).then((result) => {
                if (result.status === "applied") {
                  setTodayWorkoutPlan(result.plan);
                }
              })
            : Promise.resolve();

        const equipmentPromise = exerciseNames.length
          ? fetchEquipmentForExercises(exerciseNames).then(setWorkoutCatalog).catch(() => undefined)
          : Promise.resolve();

        await Promise.all([weeklyPromise, reflowPromise, equipmentPromise]);
      } catch {
        // Non-blocking enhancements — ignore failures.
      }
    },
    [token, canSmartReflow],
  );

  const applyCorePayload = useCallback(
    (payload: {
      calorieDay: CalorieDayPayload | null;
      todayWorkoutPlan: WorkoutPlanCurrent | null;
      todayMealPlan: MealDayPlan | null;
      workoutHistory: WorkoutHistoryRow[];
      weightKg: number;
    }) => {
      setCalorieDay(payload.calorieDay);
      setTodayWorkoutPlan(payload.todayWorkoutPlan);
      setTodayMealPlan(payload.todayMealPlan);
      setWorkoutHistory(payload.workoutHistory);
      setWeightKg(payload.weightKg);
    },
    [],
  );

  const load = useCallback(async () => {
    const cached = getGamePlanCache();
    if (cached) {
      const sanitizedCachedPlan = sanitizeWorkoutPlanCurrent(cached.todayWorkoutPlan);
      applyCorePayload({
        calorieDay: cached.calorieDay,
        todayWorkoutPlan: sanitizedCachedPlan,
        todayMealPlan: null,
        workoutHistory: cached.workoutHistory,
        weightKg: cached.weightKg,
      });
      setLoading(false);
      const cachedExercises =
        sanitizedCachedPlan?.today && !isHomeRestDayActive({ hasWorkoutPlannerAccess, plan: sanitizedCachedPlan })
          ? sanitizedCachedPlan.today.exercises ?? []
          : [];
      void loadDeferred(
        cachedExercises.map((ex) => ex.name),
        sanitizedCachedPlan,
      );
    }

    if (!token) {
      setCalorieDay(null);
      setTodayWorkoutPlan(null);
      setTodayMealPlan(null);
      setWorkoutHistory([]);
      setWeightKg(70);
      setWorkoutCatalog([]);
      setWeeklyReviewMessage(null);
      setLoading(false);
      return;
    }

    const apiBase = resolveApiBaseUrl();
    try {
      const [dayRes, onboardingRes, historyRes, workoutPlanRes, mealPlanRes, weightLatestRes] = await Promise.all([
        getDailyCalorieLog(todayLocal()).catch(() => null),
        fetchOnboardingMeShared().catch(() => null),
        getWorkoutHistory(24 * 7).catch(() => ({ items: [] })),
        fetchWorkoutPlanCurrent().catch(() => null),
        hasMealPlannerAccess ? fetchMealPlanCurrent().catch(() => null) : Promise.resolve(null),
        fetch(`${apiBase}/api/weight/latest`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      const mealToday = mealPlanRes
        ? isWeeklyPlannerCurrent(mealPlanRes)
          ? mealPlanRes.current_week?.today ?? null
          : mealPlanRes.today ?? null
        : null;
      const historyRows = mapHistoryItems(historyRes.items ?? []);
      const onboardingWeight = Number(onboardingRes?.onboarding?.personal?.weight_kg);
      const resolvedWeightKg = resolveWeightKg(weightLatestRes, onboardingWeight);

      const sanitizedWorkoutPlan = sanitizeWorkoutPlanCurrent(workoutPlanRes);

      applyCorePayload({
        calorieDay: dayRes,
        todayWorkoutPlan: sanitizedWorkoutPlan,
        todayMealPlan: mealToday,
        workoutHistory: historyRows,
        weightKg: resolvedWeightKg,
      });

      setGamePlanCache({
        calorieDay: dayRes,
        todayWorkoutPlan: sanitizedWorkoutPlan,
        workoutHistory: historyRows,
        weightKg: resolvedWeightKg,
      });

      const todayExercises =
        sanitizedWorkoutPlan?.today && !isHomeRestDayActive({ hasWorkoutPlannerAccess, plan: sanitizedWorkoutPlan })
          ? sanitizedWorkoutPlan.today.exercises ?? []
          : [];
      void loadDeferred(todayExercises.map((ex) => ex.name), sanitizedWorkoutPlan);
    } catch {
      if (!cached) {
        setCalorieDay(null);
        setTodayWorkoutPlan(null);
        setTodayMealPlan(null);
        setWorkoutHistory([]);
        setWeeklyReviewMessage(null);
      }
    } finally {
      setLoading(false);
    }
  }, [token, hasMealPlannerAccess, hasWorkoutPlannerAccess, applyCorePayload, loadDeferred]);

  useEffect(() => {
    void load();
  }, [load]);

  const restDayActive = useMemo(
    () =>
      isHomeRestDayActive({
        hasWorkoutPlannerAccess,
        plan: todayWorkoutPlan,
      }),
    [hasWorkoutPlannerAccess, todayWorkoutPlan],
  );

  const dailyGoal = Math.max(1, Math.round(Number(calorieDay?.log?.target_calories) || 1800));

  const todayExercises =
    todayWorkoutPlan?.today && !isHomeRestDayActive({ hasWorkoutPlannerAccess, plan: todayWorkoutPlan })
      ? todayWorkoutPlan.today.exercises ?? []
      : [];

  const equipmentItems = useMemo(
    () => resolveEquipmentForExercises(todayExercises.map((ex) => ex.name), workoutCatalog),
    [todayExercises, workoutCatalog],
  );

  const ingredientNames = useMemo(
    () => collectIngredientNames(todayMealPlan?.meals ?? []),
    [todayMealPlan?.meals],
  );

  return (
    <View style={styles.root}>
      <BlurredModalBackdrop onPress={dismiss} accessibilityLabel={t("common.close")} />

      <View pointerEvents="box-none" style={[styles.sheetWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Pressable
              onPress={dismiss}
              hitSlop={10}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Ionicons name="close" size={18} color={TEXT} />
            </Pressable>
          </View>
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={MUTED} />
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.scrollContent}
            >
              <DailyGamePlanCard
                dailyGoal={dailyGoal}
                restDayActive={restDayActive}
                hasWorkoutPlannerAccess={hasWorkoutPlannerAccess}
                hasMealPlannerAccess={hasMealPlannerAccess}
                todayWorkoutPlan={todayWorkoutPlan}
                todayMealPlan={todayMealPlan}
                calorieDay={calorieDay}
                workoutHistory={workoutHistory}
                weightKg={weightKg}
                equipmentItems={equipmentItems}
                ingredientNames={ingredientNames}
                weeklyReviewMessage={weeklyReviewMessage}
              />
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  sheetWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  sheet: {
    maxHeight: "88%",
    backgroundColor: "transparent",
  },
  header: {
    alignItems: "flex-end",
    marginBottom: 8,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: WHITE,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingBox: {
    backgroundColor: WHITE,
    borderRadius: 20,
    paddingVertical: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: { paddingBottom: 4 },
});
