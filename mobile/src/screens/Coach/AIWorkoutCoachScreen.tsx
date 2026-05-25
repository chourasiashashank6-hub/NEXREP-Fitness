import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import CoachingTips from "../../components/Coach/CoachingTips";
import { CircularScore } from "../../components/Coach/CircularScore";
import { InsightBubble } from "../../components/Coach/InsightBubble";
import MuscleRecoveryMap from "../../components/Coach/MuscleRecoveryMap";
import ReadinessRow from "../../components/Coach/ReadinessRow";
import { RecoveryTipCard } from "../../components/Coach/RecoveryTipCard";
import { TodaysWorkoutPlan } from "../../components/Coach/TodaysWorkoutPlan";
import WeeklyVolumeLoad from "../../components/Coach/WeeklyVolumeLoad";
import { WeeklyProgressBar } from "../../components/Coach/WeeklyProgressBar";
import { getWorkoutCoachData, getWorkoutHistory, type WorkoutHistoryItem } from "../../api/workout";
import { ScreenContainer } from "../../components/ScreenContainer";
import { WC_COLORS } from "../../constants/workoutCoach";
import { buildFallbackCoachingTips, normalizeWorkoutCoachResponse } from "../../services/coachNormalize";
import { getFallbackInsight, getWorkoutCoachInsight } from "../../services/workoutCoachService";
import { useAppTheme } from "../../theme";
import type { DynamicCoachingTip, MuscleStatus, WorkoutCoachInsight, WorkoutData } from "../../types/workoutCoach";
import type { CoachStackParamList } from "./CoachHomeScreen";

const CACHE_KEY = "workout_coach_insight";
const BASE_MUSCLES = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"] as const;
const CARD_ACCENTS = {
  insight: "#22d3ee",
  recovery: "#34d399",
  volume: "#60a5fa",
  tips: "#a78bfa",
} as const;

function formatTimestamp(): string {
  const now = new Date();
  return `Analyzed at ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

function parseBodyPartFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/body_part=([^;]+)/i);
  return m?.[1]?.trim() || null;
}

function inferMuscles(item: WorkoutHistoryItem): string[] {
  const fromNotes = parseBodyPartFromNotes(item.notes);
  if (fromNotes) {
    const lowered = fromNotes.toLowerCase();
    if (lowered.includes("chest")) return ["Chest"];
    if (lowered.includes("shoulder")) return ["Shoulders"];
    if (lowered.includes("tricep")) return ["Triceps"];
    if (lowered.includes("back")) return ["Back"];
    if (lowered.includes("leg")) return ["Legs"];
    if (lowered.includes("bicep") || lowered.includes("arm")) return ["Biceps"];
  }
  const ex = `${item.exerciseName} ${item.type}`.toLowerCase();
  if (/(bench|press|pushup|chest)/.test(ex)) return ["Chest", "Triceps"];
  if (/(row|pull|lat|deadlift|back)/.test(ex)) return ["Back", "Biceps"];
  if (/(squat|lunge|leg|hamstring|quad|glute)/.test(ex)) return ["Legs"];
  if (/(shoulder|overhead|lateral raise)/.test(ex)) return ["Shoulders"];
  if (/bicep|curl/.test(ex)) return ["Biceps"];
  if (/tricep|dip|pushdown/.test(ex)) return ["Triceps"];
  return [];
}

function relativeLabel(dateIso: string): string {
  const d = new Date(dateIso).getTime();
  const now = Date.now();
  const hours = Math.max(0, Math.round((now - d) / (1000 * 60 * 60)));
  if (hours < 24) return "Today";
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function buildWorkoutDataFromHistory(items: WorkoutHistoryItem[]): WorkoutData {
  if (!items.length) {
    return {
      recentWorkouts: [],
      weeklyVolume: [...BASE_MUSCLES].map((m, idx) => ({
        muscle: m,
        sets: 0,
        targetSets: 14,
        color: ["#4ADE80", "#FBBF24", "#A78BFA", "#60A5FA", "#F87171", "#2DD4BF"][idx % 6],
      })),
      muscleGroups: [...BASE_MUSCLES].map((m) => ({ name: m, status: "fresh", recoveryPercent: 90, lastTrainedLabel: "Not trained recently" })),
      lastWorkoutDate: "No workout yet",
      totalWeeklySets: 0,
      targetWeeklySets: 84,
    };
  }
  const sorted = [...items].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const byMuscleSets = new Map<string, number>();
  const lastTrained = new Map<string, number>();
  for (const m of BASE_MUSCLES) byMuscleSets.set(m, 0);

  for (const w of sorted) {
    const muscles = inferMuscles(w);
    const sets = Math.max(0, Number(w.sets || 0));
    const ts = +new Date(w.date);
    for (const m of muscles) {
      if (!byMuscleSets.has(m)) continue;
      if (ts >= sevenDaysAgo) byMuscleSets.set(m, (byMuscleSets.get(m) || 0) + sets);
      if (!lastTrained.has(m) || ts > (lastTrained.get(m) || 0)) lastTrained.set(m, ts);
    }
  }

  const weeklyVolume = [...BASE_MUSCLES].map((m, idx) => ({
    muscle: m,
    sets: byMuscleSets.get(m) || 0,
    targetSets: 14,
    color: ["#4ADE80", "#FBBF24", "#A78BFA", "#60A5FA", "#F87171", "#2DD4BF"][idx % 6],
  }));
  const muscleGroups = [...BASE_MUSCLES].map((m) => {
    const ts = lastTrained.get(m);
    const hrs = ts ? Math.max(0, (now - ts) / (1000 * 60 * 60)) : 168;
    const recoveryPercent = Math.max(12, Math.min(96, Math.round((Math.min(168, hrs) / 168) * 100)));
    const status: MuscleStatus = recoveryPercent < 28 ? "sore" : recoveryPercent < 52 ? "tired" : recoveryPercent < 76 ? "ready" : "fresh";
    return { name: m, status, recoveryPercent, lastTrainedLabel: ts ? relativeLabel(new Date(ts).toISOString()) : "Not trained recently" };
  });
  const recentWorkouts = sorted.slice(0, 5).map((w) => ({
    date: relativeLabel(w.date),
    type: w.type,
    musclesTrained: inferMuscles(w),
    durationMin: Number(w.duration || 0),
  }));
  const totalWeeklySets = weeklyVolume.reduce((s, v) => s + v.sets, 0);
  const targetWeeklySets = weeklyVolume.reduce((s, v) => s + v.targetSets, 0);
  return {
    recentWorkouts,
    weeklyVolume,
    muscleGroups,
    lastWorkoutDate: sorted[0] ? relativeLabel(sorted[0].date) : "No workout yet",
    totalWeeklySets,
    targetWeeklySets,
  };
}

export default function AIWorkoutCoachScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { colors, radius } = useAppTheme();
  const [data, setData] = useState<WorkoutData | null>(null);
  const [insight, setInsight] = useState<WorkoutCoachInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState("Not analyzed yet");
  const defaultWorkoutData = useMemo(() => buildWorkoutDataFromHistory([]), []);

  const loadWorkoutData = useCallback(async () => {
    try {
      setDataLoading(true);
      setDataError(null);
      const workoutData = await getWorkoutCoachData(14);
      setData(workoutData);
    } catch (e1) {
      try {
        const historyRes = await getWorkoutHistory(24 * 14);
        const fallbackData = buildWorkoutDataFromHistory(Array.isArray(historyRes?.items) ? historyRes.items : []);
        setData(fallbackData);
        setDataError("Using history fallback data");
      } catch (e2) {
        setData(defaultWorkoutData);
        const m1 = e1 instanceof Error ? e1.message : "Could not load workout data";
        const m2 = e2 instanceof Error ? e2.message : "History fallback failed";
        setDataError(`${m1}. ${m2}. Showing local default view.`);
      }
    } finally {
      setDataLoading(false);
    }
  }, [defaultWorkoutData]);

  useEffect(() => {
    void loadWorkoutData();
  }, [loadWorkoutData]);

  useFocusEffect(
    useCallback(() => {
      void loadWorkoutData();
    }, [loadWorkoutData]),
  );

  const fetchInsight = useCallback(async () => {
    if (!data) {
      setError("Workout data unavailable. Please retry loading data first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getWorkoutCoachInsight(data);
      setInsight(next);
      setTimestamp(formatTimestamp());
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch (e) {
      const fallback = getFallbackInsight(data);
      setInsight(fallback);
      setTimestamp("Offline estimate");
      setError(e instanceof Error ? `${e.message}. Showing fallback insight.` : "Could not reach AI. Showing fallback insight.");
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as WorkoutCoachInsight;
        const normalized = normalizeWorkoutCoachResponse(parsed, defaultWorkoutData);
        if (normalized.insightText) {
          setInsight(normalized);
          setTimestamp("From previous session");
        }
      } catch {
        // ignore cache parsing failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultWorkoutData]);

  const coachingTips = useMemo((): DynamicCoachingTip[] => {
    if (insight?.coachingTips?.length) return insight.coachingTips;
    const source = data ?? defaultWorkoutData;
    const score = insight?.readinessScore ?? 68;
    return buildFallbackCoachingTips(source, score);
  }, [insight, data, defaultWorkoutData]);

  return (
    <ScreenContainer>
      <View style={styles.topHeader}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.backBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.md }]}
        >
          <Text style={[styles.backTxt, { color: colors.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>AI Workout Coach</Text>
      </View>
      <View>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
          ]}
        >
          <LinearGradient colors={[CARD_ACCENTS.insight, `${CARD_ACCENTS.insight}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardAccent} />
          <View style={styles.cardHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarTxt}>🏋️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>Workout AI coach</Text>
              <Text style={[styles.sub, { color: colors.muted }]}>{timestamp}</Text>
            </View>
            <View style={styles.liveWrap}>
              <View style={styles.liveDot} />
            </View>
          </View>

          {loading && !insight ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={WC_COLORS.green} />
              <Text style={[styles.loadingText, { color: colors.muted }]}>Building your workout plan...</Text>
            </View>
          ) : null}

          {insight ? (
            <>
              <CircularScore
                score={insight.readinessScore}
                label={insight.readinessLabel}
                subtitle={insight.readinessDescription}
                pulseWhenHigh
              />
              <ReadinessRow insight={insight} hideGauge />
            </>
          ) : null}

          <InsightBubble
            loading={loading && !insight}
            insight={insight?.insightText ?? ""}
            placeholder="Tap refresh to generate workout insight."
            expandLinkColor={WC_COLORS.green}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {insight?.todaysPlan?.exercises?.length ? (
            <View style={{ marginTop: 12 }}>
              <TodaysWorkoutPlan plan={insight.todaysPlan} />
            </View>
          ) : null}

          {insight?.weeklyProgress ? (
            <View style={{ marginTop: 12 }}>
              <WeeklyProgressBar
                completed={insight.weeklyProgress.completedSets}
                target={insight.weeklyProgress.targetSets}
                percent={insight.weeklyProgress.percentComplete}
                insight={insight.weeklyProgress.insight}
              />
            </View>
          ) : null}

          <Pressable
            style={[styles.refreshBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt }, loading && { opacity: 0.6 }]}
            onPress={() => void fetchInsight()}
            disabled={loading || dataLoading}
          >
            <Text style={[styles.refreshText, { color: colors.text }]}>
              {dataLoading ? "Loading your workout data..." : loading ? "Analyzing..." : "↻ Refresh analysis"}
            </Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
          ]}
        >
          <LinearGradient colors={[CARD_ACCENTS.recovery, `${CARD_ACCENTS.recovery}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardAccent} />
          <MuscleRecoveryMap muscles={data?.muscleGroups ?? []} />
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
          ]}
        >
          <LinearGradient colors={[CARD_ACCENTS.volume, `${CARD_ACCENTS.volume}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardAccent} />
          <WeeklyVolumeLoad volumes={data?.weeklyVolume ?? []} />
        </View>

        {insight?.recoveryTips?.length ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
            ]}
          >
            <LinearGradient colors={[CARD_ACCENTS.tips, `${CARD_ACCENTS.tips}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardAccent} />
            <Text style={[styles.sectionLabel, { color: WC_COLORS.green }]}>RECOVERY TIPS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tipsRow}>
              {insight.recoveryTips.map((item, i) => (
                <RecoveryTipCard key={`${item.title}-${i}`} {...item} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
          ]}
        >
          <LinearGradient colors={[CARD_ACCENTS.tips, `${CARD_ACCENTS.tips}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardAccent} />
          <CoachingTips tips={coachingTips} loading={loading} />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 99,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  backTxt: { fontSize: 20 },
  headerTitle: { fontSize: 20, fontWeight: "600" },
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  tipsRow: { paddingRight: 4 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: WC_COLORS.tealLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTxt: { fontSize: 16 },
  title: { fontSize: 15, fontWeight: "700" },
  sub: { marginTop: 2, fontSize: 12 },
  liveWrap: {
    width: 18,
    alignItems: "flex-end",
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 99,
    backgroundColor: "#639922",
  },
  error: {
    fontSize: 12,
    color: "#FCA5A5",
    marginBottom: 10,
    lineHeight: 18,
  },
  refreshBtn: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: { fontSize: 13, fontWeight: "600" },
  emptyTitle: { fontSize: 15, fontWeight: "700" },
  emptySub: { marginTop: 6, fontSize: 12, lineHeight: 18 },
  loadingBox: { alignItems: "center", paddingVertical: 20, gap: 8 },
  loadingText: { fontSize: 12 },
  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 10 },
});
