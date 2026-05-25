import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { loadOnboardingWithFallback } from "../../api/onboarding";
import { useAuthStore } from "../../store/authStore";
import { useAppTheme } from "../../theme";
import { type NutritionData, type Task } from "../../types/coach";
import { FilterRow } from "./FilterRow";
import { ProgressBar } from "./ProgressBar";
import { StreakRow } from "./StreakRow";
import { TaskItem } from "./TaskItem";

type FilterValue = "all" | "water" | "food" | "log" | "move";

const todayKey = () => new Date().toISOString().slice(0, 10);
const STREAK_KEY = "streak_data";

type StreakData = Record<string, boolean>;

function buildMealLogTasks(mealsPerDay: number, mealsLogged: number): Task[] {
  const normalizedMeals = Number.isFinite(mealsPerDay) ? Math.max(1, Math.min(8, Math.round(mealsPerDay))) : 3;
  const mealLabels = ["breakfast", "lunch", "dinner", "snack", "pre-workout meal", "post-workout meal"];
  const firstMeals = mealLabels.slice(0, Math.min(normalizedMeals, mealLabels.length));
  const mealList = firstMeals.join(", ");
  const left = Math.max(0, normalizedMeals - mealsLogged);

  const dynamicLogTask: Task = {
    id: "plan-meal-target",
    name: left > 0 ? `Log ${left} more meal(s)` : "Meal logging target completed",
    description:
      left > 0
        ? `Onboarding target is ${normalizedMeals} meals/day. Planned meals: ${mealList}.`
        : `Great consistency. You already logged ${mealsLogged} meal(s) against your ${normalizedMeals} meal target.`,
    tag: "log",
    priority: left > 0 ? "high" : "low",
    done: false,
  };

  const dynamicTimingTask: Task = {
    id: "plan-meal-timing",
    name: "Log each meal right after eating",
    description: "Log meals within 15 minutes to keep calories and macros accurate for AI coaching.",
    tag: "log",
    priority: "medium",
    done: false,
  };

  return [dynamicLogTask, dynamicTimingTask];
}

function buildIntakeDrivenTasks(nutritionData: NutritionData | null, mealsPerDay: number): Task[] {
  const consumed = Number(nutritionData?.caloriesConsumed || 0);
  const target = Number(nutritionData?.tdee || 0);
  const remaining = Math.round(target - consumed);
  const waterMl = Number(nutritionData?.waterMl || 0);
  const proteinG = Number(nutritionData?.proteinG || 0);
  const mealsLogged = Number(nutritionData?.mealsLogged || 0);
  const burned = Number(nutritionData?.burnedKcal || 0);
  const waterTargetMl = 2500;
  const proteinTargetG = Math.max(90, Math.round((target * 0.25) / 4));
  const waterLeft = Math.max(0, waterTargetMl - waterMl);
  const proteinLeft = Math.max(0, Math.round(proteinTargetG - proteinG));
  const mealLeft = Math.max(0, mealsPerDay - mealsLogged);
  const tasks: Task[] = [];

  const mealTasks = buildMealLogTasks(mealsPerDay, mealsLogged);
  const mealTargetTask = mealTasks[0];
  const mealTimingTask = mealTasks[1];
  if (mealTargetTask) {
    tasks.push({ ...mealTargetTask, done: mealLeft === 0 });
  }
  if (mealTimingTask) {
    tasks.push({ ...mealTimingTask, done: mealLeft === 0 });
  }

  tasks.push(
    remaining < 0
      ? {
          id: "plan-calories",
          name: "Hold intake and choose very light options",
          description: `You are over target by ${Math.abs(remaining)} kcal. Keep intake minimal and hydration high.`,
          tag: "food",
          priority: "high",
          done: true,
        }
      : {
          id: "plan-calories",
          name: "Plan a balanced meal under remaining calories",
          description:
            remaining > 250
              ? `${remaining} kcal left today. Prioritize high-protein and high-fiber foods in this budget.`
              : "Calorie budget is on track. Keep meals balanced and within your remaining target.",
          tag: "food",
          priority: remaining > 250 ? "medium" : "low",
          done: remaining <= 250,
        },
  );

  tasks.push({
    id: "plan-water",
    name: "Complete hydration target",
    description:
      waterLeft > 0
        ? `${waterLeft} ml water left to hit ~${waterTargetMl} ml today.`
        : `Hydration goal achieved. You reached ~${waterTargetMl} ml today.`,
    tag: "water",
    priority: waterLeft > 1000 ? "high" : "medium",
    done: waterLeft === 0,
  });

  tasks.push({
    id: "plan-protein",
    name: "Close protein gap",
    description:
      proteinLeft > 0
        ? `${proteinLeft}g protein left. Add lean options like curd, paneer, eggs, chicken, tofu, or whey.`
        : `Protein target reached. Keep meal quality high for recovery and satiety.`,
    tag: "food",
    priority: proteinLeft > 25 ? "high" : "medium",
    done: proteinLeft === 0,
  });

  const movementNeeded = burned < 250 && remaining < 0;
  tasks.push({
    id: "plan-move",
    name: movementNeeded ? "Add a short movement session" : "Movement target covered for now",
    description: movementNeeded
      ? "Add a 15-20 min walk or light workout to support calorie balance."
      : "You have enough movement logged for the current calorie balance. Keep activity steady.",
    tag: "move",
    priority: burned < 150 ? "high" : "medium",
    done: !movementNeeded,
  });

  return tasks;
}

function computeStreak(data: StreakData): number {
  let count = 0;
  const d = new Date();
  for (let i = 0; i < 60; i += 1) {
    const k = d.toISOString().slice(0, 10);
    if (data[k]) count += 1;
    else break;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function weekPills(data: StreakData) {
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const out: Array<{ day: string; state: "done" | "missed" | "today" }> = [];
  const now = new Date();
  const monday = new Date(now);
  const day = (now.getDay() + 6) % 7;
  monday.setDate(now.getDate() - day);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const today = key === now.toISOString().slice(0, 10);
    const done = Boolean(data[key]);
    out.push({ day: labels[i], state: today ? "today" : done ? "done" : "missed" });
  }
  return out;
}

export function ActionPlanCard({ nutritionData, accentColor = "#a78bfa" }: { nutritionData: NutritionData | null; accentColor?: string }) {
  const { colors, radius } = useAppTheme();
  const token = useAuthStore((s) => s.token);
  const [mealsPerDay, setMealsPerDay] = useState(3);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [streakData, setStreakData] = useState<StreakData>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let preferredMeals = 3;
        if (token) {
          const { profile } = await loadOnboardingWithFallback(token);
          preferredMeals = profile?.dietary?.meals_per_day ?? 3;
        }
        if (!cancelled) setMealsPerDay(preferredMeals);

        const savedStreak = await AsyncStorage.getItem(STREAK_KEY);
        if (cancelled) return;
        if (savedStreak) {
          const parsed = JSON.parse(savedStreak) as StreakData;
          if (parsed && typeof parsed === "object") setStreakData(parsed);
        }
      } catch {
        // silently use memory state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const tasks = useMemo(() => buildIntakeDrivenTasks(nutritionData, mealsPerDay), [nutritionData, mealsPerDay]);

  useEffect(() => {
    const doneCount = tasks.filter((t) => t.done).length;
    const achieved = doneCount >= 4;
    const next = { ...streakData, [todayKey()]: achieved };
    setStreakData(next);
    void AsyncStorage.setItem(STREAK_KEY, JSON.stringify(next)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const done = tasks.filter((t) => t.done).length;
  const filtered = useMemo(() => (filter === "all" ? tasks : tasks.filter((t) => t.tag === filter)), [filter, tasks]);
  const streak = useMemo(() => computeStreak(streakData), [streakData]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
      <LinearGradient colors={[accentColor, `${accentColor}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardAccent} />
      <View style={styles.headRow}>
        <Text style={[styles.title, { color: colors.text }]}>TODAY'S ACTION PLAN</Text>
        <View style={[styles.donePill, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
          <Text style={[styles.doneText, { color: colors.muted }]}>
            {done} / {tasks.length} done
          </Text>
        </View>
      </View>

      <FilterRow value={filter} onChange={setFilter} />

      {filtered.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>No tasks in this category</Text>
      ) : (
        filtered.map((task) => <TaskItem key={task.id} task={task} onToggle={() => undefined} />)
      )}

      <ProgressBar done={done} total={tasks.length} />
      <StreakRow days={weekPills(streakData)} streak={streak} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardAccent: {
    height: 3,
    width: "100%",
    borderRadius: 2,
    marginBottom: 12,
  },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, fontWeight: "600" },
  donePill: { borderRadius: 99, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  doneText: { fontSize: 12, fontWeight: "600" },
  empty: { fontSize: 12, marginVertical: 8 },
});
