import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fetchWorkoutPlanCurrent, fetchWorkoutPlanDay } from "../api/workoutPlanner";
import { AppCard } from "./AppCard";
import { useAppTheme } from "../theme";
import type { WorkoutDayPlan, WorkoutExercise } from "../types/planner";

const ACCENT = "#22d3ee";
const ACCENT_PLANNER = ["#3b82f6", "#22d3ee", "transparent"] as const;
const EMPTY_MESSAGE = "No workout planned — generate your plan in the Coach tab";

function isWorkoutRestDay(day: Pick<WorkoutDayPlan, "is_rest_day" | "split_name"> | null | undefined): boolean {
  if (!day) return true;
  if (day.is_rest_day) return true;
  const split = (day.split_name ?? "").trim().toLowerCase();
  return split.includes("rest") || split === "off";
}

export function dedupeMusclesFromExercises(exercises: WorkoutExercise[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ex of exercises) {
    const muscle = (ex.muscle ?? "").trim();
    if (!muscle) continue;
    const key = muscle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(muscle);
  }
  return result;
}

export function TodaysFocusCard() {
  const { colors } = useAppTheme();
  const [dayPlan, setDayPlan] = useState<WorkoutDayPlan | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadSeqRef = useRef(0);
  const initialLoadDoneRef = useRef(false);

  const syncFromPlanner = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++loadSeqRef.current;
    if (!opts?.silent) setRefreshing(true);
    try {
      const plan = await fetchWorkoutPlanCurrent();
      if (seq !== loadSeqRef.current) return;

      if (!plan) {
        setHasPlan(false);
        setDayPlan(null);
        return;
      }

      setHasPlan(true);
      const todayDay =
        plan.month_overview.find((d) => d.is_today)?.day ??
        plan.today?.day ??
        new Date().getDate();

      let detail: WorkoutDayPlan | null = plan.today?.day === todayDay ? plan.today : null;
      if (!detail || detail.locked) {
        try {
          detail = await fetchWorkoutPlanDay(todayDay);
        } catch {
          detail = plan.today;
        }
      }

      if (seq !== loadSeqRef.current) return;
      setDayPlan(detail);
    } catch {
      if (seq !== loadSeqRef.current) return;
      setHasPlan(false);
      setDayPlan(null);
    } finally {
      if (seq === loadSeqRef.current) {
        initialLoadDoneRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void syncFromPlanner({ silent: initialLoadDoneRef.current });
    }, [syncFromPlanner]),
  );

  const showWorkout =
    hasPlan &&
    dayPlan &&
    !dayPlan.locked &&
    !isWorkoutRestDay(dayPlan) &&
    (dayPlan.exercises?.length ?? 0) > 0;

  const muscles = showWorkout ? dedupeMusclesFromExercises(dayPlan!.exercises ?? []) : [];
  const heading = showWorkout ? (dayPlan!.split_name ?? "").trim().toUpperCase() : "";

  return (
    <AppCard>
      <LinearGradient colors={ACCENT_PLANNER} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardTopAccent} />
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          {showWorkout ? (
            <>
              <Text style={[styles.eyebrow, { color: colors.muted }]}>TODAY&apos;S FOCUS</Text>
              <Text style={[styles.heading, { color: colors.text }]}>{heading}</Text>
            </>
          ) : (
            <Text style={[styles.heading, { color: colors.text }]}>Today&apos;s Focus</Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh today's focus from planner"
          style={[styles.refreshBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
          onPress={() => void syncFromPlanner()}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Ionicons name="refresh-outline" size={18} color={ACCENT} />
          )}
        </Pressable>
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator color={ACCENT} style={styles.loader} />
      ) : showWorkout && muscles.length > 0 ? (
        <View style={styles.pills}>
          {muscles.map((muscle) => (
            <View key={muscle} style={styles.musclePill}>
              <Text style={styles.musclePillText}>{muscle}</Text>
            </View>
          ))}
        </View>
      ) : !loading ? (
        <Text style={[styles.emptyText, { color: colors.muted }]}>{EMPTY_MESSAGE}</Text>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  cardTopAccent: {
    height: 3,
    width: "100%",
    borderRadius: 2,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  headerText: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  heading: { fontSize: 18, fontWeight: "800", letterSpacing: 0.5 },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loader: { marginTop: 12 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  musclePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: "rgba(34, 211, 238, 0.15)",
  },
  musclePillText: { color: ACCENT, fontSize: 13, fontWeight: "700" },
  emptyText: { fontSize: 13, lineHeight: 19, marginTop: 10 },
});
