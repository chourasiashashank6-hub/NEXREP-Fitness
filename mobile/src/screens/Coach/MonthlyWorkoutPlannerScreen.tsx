import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fetchWorkoutPlanCurrent, fetchWorkoutPlanDay, generateWorkoutPlan, swapWorkoutExercise } from "../../api/workoutPlanner";
import { fetchOnboardingMe } from "../../api/onboarding";
import { PlannerMonthCalendar } from "../../components/Coach/PlannerMonthCalendar";
import { EXERCISE_SWAP_REASONS, SwapBottomSheet } from "../../components/SwapBottomSheet";
import { ScreenContainer } from "../../components/ScreenContainer";
import { notifyUser } from "../../utils/notify";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { useAppTheme } from "../../theme";
import type { FocusMuscle, WorkoutDayPlan, WorkoutPlanCurrent } from "../../types/planner";
import { fullDayLabel, monthYearLabel } from "../../utils/localDate";

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
  const exerciseSwapsLimit = 5;
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedWorkoutOverview = plan?.month_overview.find((d) => d.day === selectedDay);
  const canSwapExercises = Boolean(selectedWorkoutOverview && !selectedWorkoutOverview.is_future && plan);
  const exerciseSwapsRemaining = exerciseSwapsLimit - exerciseSwapsUsed;

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const current = await fetchWorkoutPlanCurrent();
      setPlan(current);
      if (current) setSelectedMuscles(planFocusMuscles(current));
      if (current?.today?.day) setSelectedDay(current.today.day);
    } catch {
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDay = useCallback(
    async (day: number) => {
      if (!plan) return;
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
      } catch {
        setDayDetail(null);
      }
    },
    [plan],
  );

  useFocusEffect(
    useCallback(() => {
      void loadPlan();
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
    setGenerating(true);
    setGenStep(0);
    progressTimer.current = setInterval(() => setGenStep((s) => Math.min(s + 1, 4)), 5000);
    try {
      const created = await generateWorkoutPlan(selectedMuscles);
      setPlan(created);
      if (created.today?.day) setSelectedDay(created.today.day);
    } catch (e: unknown) {
      Alert.alert("Generation failed", e instanceof Error ? e.message : "Could not generate workout plan");
    } finally {
      if (progressTimer.current) clearInterval(progressTimer.current);
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

      {showFocusBadge && plan ? (
        <View style={[styles.focusBadge, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md }]}>
          <Text style={{ color: "#22d3ee", fontWeight: "700" }}>🎯 Focusing on: {activeFocusMuscles.join(", ")} this month</Text>
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
                  {!dayDetail.is_rest_day ? (
                    <>
                      <Text style={{ color: colors.muted, marginTop: 6 }}>Focus: {dayDetail.focus_muscles.join(", ")}</Text>
                      <Text style={{ color: colors.muted }}>Est. Duration: {dayDetail.estimated_duration_min} min</Text>
                      {activeFocusMuscles.length > 0 &&
                      dayDetail.focus_muscles.some((m) =>
                        activeFocusMuscles.some((f) => m.toLowerCase().includes(f.toLowerCase())),
                      ) ? (
                        <Text style={{ color: "#fbbf24", marginTop: 6 }}>🎯 Extra {activeFocusMuscles.join(", ")} Volume</Text>
                      ) : null}
                    </>
                  ) : null}
                </View>

                {dayDetail.is_rest_day ? (
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
                      <View key={`${ex.name}-${i}`} style={styles.exercise}>
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
});
