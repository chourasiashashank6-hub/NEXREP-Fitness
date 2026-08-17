import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { CalorieDayPayload } from "../api/caloriesLog";
import { getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { resolveApiBaseUrl } from "../api/client";
import { fetchMealPlanCurrent } from "../api/mealPlanner";
import { fetchOnboardingMeShared } from "../api/onboarding";
import { getWorkoutCatalog, getWorkoutHistory } from "../api/workout";
import { fetchWorkoutPlanCurrent } from "../api/workoutPlanner";
import { DailyGamePlanCard } from "../components/DailyGamePlanCard";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { useAuthStore } from "../store/authStore";
import type { MealDayPlan, WorkoutPlanCurrent } from "../types/planner";
import { isWeeklyPlannerCurrent } from "../types/planner";
import { isHomeRestDayActive } from "../utils/workoutRestDay";
import {
  collectIngredientNames,
  resolveEquipmentForExercises,
  type CatalogEquipmentRow,
} from "../utils/gamePlanPrepLists";

const TEXT = "#1A1A18";
const MUTED = "#8A8A84";
const WHITE = "#FFFFFF";

type WorkoutHistoryRow = {
  date: string;
  exerciseName?: string;
  type?: string;
  notes?: string | null;
  bodyPart?: string | null;
};

export default function GamePlanModalScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);
  const { hasFeatureAccess } = useFeatureAccess();
  const hasMealPlannerAccess = hasFeatureAccess("meal_plan_generation");
  const hasWorkoutPlannerAccess = hasFeatureAccess("workout_plan_generation");

  const [loading, setLoading] = useState(true);
  const [calorieDay, setCalorieDay] = useState<CalorieDayPayload | null>(null);
  const [todayWorkoutPlan, setTodayWorkoutPlan] = useState<WorkoutPlanCurrent | null>(null);
  const [todayMealPlan, setTodayMealPlan] = useState<MealDayPlan | null>(null);
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutHistoryRow[]>([]);
  const [weightKg, setWeightKg] = useState(70);
  const [workoutCatalog, setWorkoutCatalog] = useState<CatalogEquipmentRow[]>([]);

  const dismiss = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const load = useCallback(async () => {
    if (!token) {
      setCalorieDay(null);
      setTodayWorkoutPlan(null);
      setTodayMealPlan(null);
      setWorkoutHistory([]);
      setWeightKg(70);
      setWorkoutCatalog([]);
      setLoading(false);
      return;
    }
    const apiBase = resolveApiBaseUrl();
    try {
      const [dayRes, onboardingRes, historyRes, workoutPlanRes, mealPlanRes, weightLatestRes, catalogRes] = await Promise.all([
        getDailyCalorieLog(todayLocal()).catch(() => null),
        fetchOnboardingMeShared().catch(() => null),
        getWorkoutHistory(24 * 8).catch(() => ({ items: [] })),
        fetchWorkoutPlanCurrent().catch(() => null),
        hasMealPlannerAccess ? fetchMealPlanCurrent().catch(() => null) : Promise.resolve(null),
        fetch(`${apiBase}/api/weight/latest`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        getWorkoutCatalog().catch(() => ({ items: [] })),
      ]);

      setCalorieDay(dayRes);
      setTodayWorkoutPlan(workoutPlanRes);
      const mealToday = mealPlanRes
        ? isWeeklyPlannerCurrent(mealPlanRes)
          ? mealPlanRes.current_week?.today ?? null
          : mealPlanRes.today ?? null
        : null;
      setTodayMealPlan(mealToday);
      setWorkoutHistory(
        (historyRes.items ?? []).map((item) => ({
          date: item.date,
          exerciseName: item.exerciseName,
          type: item.type,
          notes: item.notes,
          bodyPart: item.bodyPart,
        })),
      );

      const onboardingWeight = Number(onboardingRes?.onboarding?.personal?.weight_kg);
      const latestWeight = Number(weightLatestRes?.weight_kg);
      setWeightKg(
        Number.isFinite(latestWeight) && latestWeight > 0
          ? latestWeight
          : Number.isFinite(onboardingWeight) && onboardingWeight > 0
            ? onboardingWeight
            : 70,
      );
      setWorkoutCatalog(
        ((catalogRes as { items?: CatalogEquipmentRow[] })?.items ?? []).map((item) => ({
          exerciseName: item.exerciseName,
          defaultExerciseName: item.defaultExerciseName,
          equipment: item.equipment,
        })),
      );
    } catch {
      setCalorieDay(null);
      setTodayWorkoutPlan(null);
      setTodayMealPlan(null);
      setWorkoutHistory([]);
    } finally {
      setLoading(false);
    }
  }, [token, hasMealPlannerAccess]);

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
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
      >
        <View style={[StyleSheet.absoluteFill, styles.scrimFallback]} />
        <BlurView
          intensity={40}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </Pressable>

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
  scrimFallback: { backgroundColor: "rgba(20, 20, 18, 0.28)" },
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
