import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import CoachingTips from "../../components/Coach/CoachingTips";
import { CoachCadenceLockedPanel } from "../../components/Coach/CoachCadenceLockedPanel";
import { CoachCadenceSelector } from "../../components/Coach/CoachCadenceSelector";
import { WorkoutCoachSummaryViews } from "../../components/Coach/workout/WorkoutCoachSummaryViews";
import { CoachJourneySection } from "../../components/Coach/CoachJourneySection";
import { CircularScore } from "../../components/Coach/CircularScore";
import { InsightBubble } from "../../components/Coach/InsightBubble";
import MuscleRecoveryMap from "../../components/Coach/MuscleRecoveryMap";
import ReadinessRow from "../../components/Coach/ReadinessRow";
import { RecoveryTipCard } from "../../components/Coach/RecoveryTipCard";
import WeeklyVolumeLoad from "../../components/Coach/WeeklyVolumeLoad";
import { WeeklyProgressBar } from "../../components/Coach/WeeklyProgressBar";
import { fetchOnboardingMe } from "../../api/onboarding";
import { getWorkoutHistory, type WorkoutHistoryItem } from "../../api/workout";
import { ScreenContainer } from "../../components/ScreenContainer";
import { WC_COLORS } from "../../constants/workoutCoach";
import { useCoachCadence } from "../../hooks/useCoachCadence";
import { useCoachRedesignEnabled } from "../../hooks/useCoachRedesign";
import { buildFallbackCoachingTips, normalizeWorkoutCoachResponse } from "../../services/coachNormalize";
import { getFallbackInsight, getWorkoutCoachInsight } from "../../services/workoutCoachService";
import type { OnboardingData } from "../../types/onboarding";
import type { DynamicCoachingTip, MuscleStatus, WorkoutCoachInsight, WorkoutData } from "../../types/workoutCoach";
import type { CoachStackParamList } from "./CoachHomeScreen";
import { getGoalFocusMuscles } from "../../utils/onboardingFocusMuscles";
import { getMuscleWeeklyTargets, getTargetWeeklySets } from "../../utils/weeklyMuscleTargets";
import { inferMusclesFromWorkout, parseWorkoutTimestamp } from "../../utils/workoutMuscleInfer";

const CACHE_KEY = "workout_coach_insight";
const BASE_MUSCLES = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"] as const;

function relativeLabel(dateIso: string): string {
  const d = new Date(dateIso).getTime();
  const now = Date.now();
  const hours = Math.max(0, Math.round((now - d) / (1000 * 60 * 60)));
  if (hours < 24) return i18n.t("coach.common.today");
  const days = Math.round(hours / 24);
  if (days === 1) return i18n.t("coach.common.yesterday");
  return i18n.t("coach.common.daysAgo", { count: days });
}

function buildWorkoutDataFromHistory(items: WorkoutHistoryItem[], onboardingData?: OnboardingData | null): WorkoutData {
  const focusMuscles = onboardingData?.goal ? getGoalFocusMuscles(onboardingData.goal) : [];
  const muscleTargets = getMuscleWeeklyTargets(onboardingData?.activity?.workouts_per_week, focusMuscles);
  const targetWeeklySets = getTargetWeeklySets(onboardingData?.activity?.workouts_per_week, focusMuscles);

  if (!items.length) {
    return {
      recentWorkouts: [],
      weeklyVolume: [...BASE_MUSCLES].map((m, idx) => ({
        muscle: m,
        sets: 0,
        targetSets: muscleTargets[m],
        color: ["#4ADE80", "#FBBF24", "#A78BFA", "#60A5FA", "#F87171", "#2DD4BF"][idx % 6],
      })),
      muscleGroups: [...BASE_MUSCLES].map((m) => ({ name: m, status: "fresh", recoveryPercent: 90, lastTrainedLabel: i18n.t("coach.common.notTrainedRecently") })),
      lastWorkoutDate: i18n.t("coach.common.noWorkoutYet"),
      totalWeeklySets: 0,
      targetWeeklySets,
    };
  }
  const sorted = [...items].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const byMuscleSets = new Map<string, number>();
  const lastTrained = new Map<string, number>();
  for (const m of BASE_MUSCLES) byMuscleSets.set(m, 0);

  for (const w of sorted) {
    const muscles = inferMusclesFromWorkout(w);
    const sets = Math.max(0, Number(w.sets || 0));
    const ts = parseWorkoutTimestamp(w.date);
    if (ts == null) continue;
    for (const m of muscles) {
      if (!byMuscleSets.has(m)) continue;
      if (ts >= sevenDaysAgo) byMuscleSets.set(m, (byMuscleSets.get(m) || 0) + sets);
      if (!lastTrained.has(m) || ts > (lastTrained.get(m) || 0)) lastTrained.set(m, ts);
    }
  }

  const weeklyVolume = [...BASE_MUSCLES].map((m, idx) => ({
    muscle: m,
    sets: byMuscleSets.get(m) || 0,
    targetSets: muscleTargets[m],
    color: ["#4ADE80", "#FBBF24", "#A78BFA", "#60A5FA", "#F87171", "#2DD4BF"][idx % 6],
  }));
  const muscleGroups = [...BASE_MUSCLES].map((m) => {
    const ts = lastTrained.get(m);
    const hrs = ts ? Math.max(0, (now - ts) / (1000 * 60 * 60)) : 168;
    const recoveryPercent = Math.max(12, Math.min(96, Math.round((Math.min(168, hrs) / 168) * 100)));
    const status: MuscleStatus = recoveryPercent < 28 ? "sore" : recoveryPercent < 52 ? "tired" : recoveryPercent < 76 ? "ready" : "fresh";
    return { name: m, status, recoveryPercent, lastTrainedLabel: ts ? relativeLabel(new Date(ts).toISOString()) : i18n.t("coach.common.notTrainedRecently") };
  });
  const recentWorkouts = sorted.slice(0, 5).map((w) => ({
    date: relativeLabel(w.date),
    type: w.type,
    musclesTrained: inferMusclesFromWorkout(w),
    durationMin: Number(w.duration || 0),
  }));
  const totalWeeklySets = weeklyVolume.reduce((s, v) => s + v.sets, 0);
  return {
    recentWorkouts,
    weeklyVolume,
    muscleGroups,
    lastWorkoutDate: sorted[0] ? relativeLabel(sorted[0].date) : i18n.t("coach.common.noWorkoutYet"),
    totalWeeklySets,
    targetWeeklySets,
  };
}

export default function AIWorkoutCoachScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { enabled: redesignEnabled } = useCoachRedesignEnabled();
  const { cadence, setCadence, isCadenceLocked, handleYearlyPress } = useCoachCadence();
  const [data, setData] = useState<WorkoutData | null>(null);
  const [insight, setInsight] = useState<WorkoutCoachInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboardingData, setOnboardingData] = useState<OnboardingData | null>(null);
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const loadingDataRef = useRef(false);
  const cacheHydratedRef = useRef(false);
  const defaultWorkoutData = useMemo(() => buildWorkoutDataFromHistory([], onboardingData), [onboardingData]);

  const loadWorkoutData = useCallback(async () => {
    if (loadingDataRef.current) return;
    loadingDataRef.current = true;
    try {
      setDataLoading(true);
      setDataError(null);
      const [historyRes, onboardingRes] = await Promise.all([
        getWorkoutHistory(24 * 14),
        fetchOnboardingMe().catch(() => null),
      ]);
      const nextOnboarding = onboardingRes?.onboarding ?? null;
      setOnboardingData(nextOnboarding);
      setData(buildWorkoutDataFromHistory(Array.isArray(historyRes?.items) ? historyRes.items : [], nextOnboarding));
    } catch (e1) {
      try {
        const [historyRes, onboardingRes] = await Promise.all([
          getWorkoutHistory(24 * 14),
          fetchOnboardingMe().catch(() => null),
        ]);
        const nextOnboarding = onboardingRes?.onboarding ?? null;
        setOnboardingData(nextOnboarding);
        setData(buildWorkoutDataFromHistory(Array.isArray(historyRes?.items) ? historyRes.items : [], nextOnboarding));
      } catch (e2) {
        setData(buildWorkoutDataFromHistory([], null));
        const m1 = e1 instanceof Error ? e1.message : t("coach.workout.couldNotLoadData");
        const m2 = e2 instanceof Error ? e2.message : t("coach.workout.historyFallbackFailed");
        setDataError(t("coach.workout.localDefaultView", { first: m1, second: m2 }));
      }
    } finally {
      setDataLoading(false);
      loadingDataRef.current = false;
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void loadWorkoutData();
    }, [loadWorkoutData]),
  );

  const fetchInsight = useCallback(async () => {
    if (!data) {
      setError(t("coach.workout.dataUnavailable"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getWorkoutCoachInsight(data, onboardingData);
      setInsight(next);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch (e) {
      const fallback = getFallbackInsight(data, onboardingData);
      setInsight(fallback);
      setError(e instanceof Error ? t("coach.workout.fallbackInsight", { message: e.message }) : t("coach.workout.couldNotReachAi"));
    } finally {
      setLoading(false);
    }
  }, [data, onboardingData, t]);

  useEffect(() => {
    if (cacheHydratedRef.current) return;
    cacheHydratedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as WorkoutCoachInsight;
        const normalized = normalizeWorkoutCoachResponse(parsed, defaultWorkoutData, onboardingData);
        if (normalized.insightText) {
          setInsight(normalized);
        }
      } catch {
        // ignore cache parsing failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultWorkoutData, onboardingData, t]);

  const coachingTips = useMemo((): DynamicCoachingTip[] => {
    if (insight?.coachingTips?.length) return insight.coachingTips;
    const source = data ?? defaultWorkoutData;
    const score = insight?.readinessScore ?? 68;
    return buildFallbackCoachingTips(source, score);
  }, [insight, data, defaultWorkoutData]);

  const showLegacyContent = !redesignEnabled;

  const handleRefresh = () => {
    if (redesignEnabled) {
      setSummaryRefresh((n) => n + 1);
      void loadWorkoutData();
      return;
    }
    void fetchInsight();
  };

  const renderCadenceBody = () => {
    if (!redesignEnabled) return null;
    if (cadence === "yearly" || (cadence === "monthly" && isCadenceLocked("monthly"))) {
      return <CoachCadenceLockedPanel cadence={cadence === "yearly" ? "yearly" : "monthly"} accentColor={WC_COLORS.PURPLE_MID} />;
    }
    if (cadence === "daily" || cadence === "weekly" || cadence === "monthly") {
      return <WorkoutCoachSummaryViews cadence={cadence} refreshToken={summaryRefresh} />;
    }
    return null;
  };

  return (
    <ScreenContainer bg={WC_COLORS.SCREEN_BG} contentStyle={styles.screenContent}>
      <View style={styles.topHeader}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color={WC_COLORS.TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("coach.workout.title")}</Text>
        <Pressable style={[styles.headerRefresh, (loading || dataLoading) && styles.disabled]} onPress={handleRefresh} disabled={loading || dataLoading}>
          {loading || dataLoading ? (
            <ActivityIndicator size="small" color={WC_COLORS.PURPLE_MID} />
          ) : (
            <Ionicons name="refresh" size={13} color={WC_COLORS.PURPLE_MID} />
          )}
          <Text style={styles.headerRefreshText}>{t("coach.common.refresh")}</Text>
        </Pressable>
        <View style={styles.onlineDot} />
      </View>
      {redesignEnabled ? (
        <CoachCadenceSelector
          value={cadence}
          accentColor={WC_COLORS.PURPLE_MID}
          onChange={setCadence}
          onYearlyPress={handleYearlyPress}
          isCadenceLocked={isCadenceLocked}
        />
      ) : null}
      {renderCadenceBody()}
      {showLegacyContent ? (
      <View>
        <View style={styles.heroCard}>
          <View style={styles.heroCircleOne} />
          <View style={styles.heroCircleTwo} />
          {loading && !insight ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={WC_COLORS.GOLD} />
              <Text style={styles.loadingText}>{t("coach.workout.buildingPlan")}</Text>
            </View>
          ) : null}

          {insight ? (
            <>
              <View style={styles.heroScoreRow}>
                <CircularScore
                  score={insight.readinessScore}
                  label=""
                  size={90}
                  pulseWhenHigh
                  strokeColor={WC_COLORS.GOLD}
                  trackColor="rgba(255,255,255,0.15)"
                  textColor={WC_COLORS.GOLD}
                />
                <View style={styles.heroInfo}>
                  <Text style={styles.heroLabel}>{insight.readinessLabel}</Text>
                  <Text style={styles.heroSub}>{t("coach.workout.recoveryMode")}</Text>
                  <View style={styles.heroStatsRow}>
                    <View style={styles.heroStatTile}>
                      <Text style={styles.heroStatValue}>{insight.weeklyProgress.completedSets}</Text>
                      <Text style={styles.heroStatLabel}>{t("coach.workout.setsDone")}</Text>
                    </View>
                    <View style={styles.heroStatTile}>
                      <Text style={[styles.heroStatValue, styles.heroStatGreen]}>{insight.weeklyProgress.percentComplete}%</Text>
                      <Text style={styles.heroStatLabel}>{t("coach.workout.weekly")}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </>
          ) : null}

          <InsightBubble
            loading={loading && !insight}
            insight={insight?.insightText ?? ""}
            placeholder={t("coach.workout.insightPlaceholder")}
            expandLinkColor={WC_COLORS.GOLD}
            backgroundColor="rgba(255,255,255,0.1)"
            borderColor="transparent"
            textColor="rgba(255,255,255,0.8)"
            placeholderColor="rgba(255,255,255,0.6)"
            lineHeight={17}
          />

          {insight ? (
            <View style={styles.readinessWrap}>
              <ReadinessRow insight={insight} hideGauge />
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        {insight?.weeklyProgress ? (
          <View style={styles.sectionGap}>
            <WeeklyProgressBar
              completed={insight.weeklyProgress.completedSets}
              target={insight.weeklyProgress.targetSets}
              percent={insight.weeklyProgress.percentComplete}
              insight={insight.weeklyProgress.insight}
            />
          </View>
        ) : null}

        <View style={styles.sectionGap}>
          <MuscleRecoveryMap muscles={data?.muscleGroups ?? []} />
        </View>

        <View style={styles.sectionGap}>
          <WeeklyVolumeLoad volumes={data?.weeklyVolume ?? []} />
        </View>

        {insight?.recoveryTips?.length ? (
          <View style={styles.recoverySection}>
            <Text style={styles.sectionLabel}>{t("coach.workout.recoveryTips")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tipsRow}>
              {insight.recoveryTips.map((item, i) => (
                <RecoveryTipCard key={`${item.title}-${i}`} {...item} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.tipsSection}>
          <CoachJourneySection domain="workout" accentColor={WC_COLORS.PURPLE_MID} />
          <CoachingTips tips={coachingTips} loading={loading} />
        </View>
      </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: 18, paddingTop: 16 },
  topHeader: { flexDirection: "row", alignItems: "center", paddingBottom: 10, gap: 8 },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
    backgroundColor: WC_COLORS.BG,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, color: WC_COLORS.TEXT, fontSize: 16, fontWeight: "800" },
  headerRefresh: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: WC_COLORS.PURPLE_LIGHT, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 7 },
  headerRefreshText: { color: WC_COLORS.PURPLE_MID, fontSize: 11, fontWeight: "800" },
  onlineDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: WC_COLORS.GREEN },
  heroCard: {
    position: "relative",
    backgroundColor: WC_COLORS.PURPLE,
    borderRadius: 22,
    paddingVertical: 20,
    paddingHorizontal: 18,
    marginBottom: 12,
    overflow: "hidden",
  },
  heroCircleOne: { position: "absolute", width: 160, height: 160, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.05)", top: -58, right: -40 },
  heroCircleTwo: { position: "absolute", width: 112, height: 112, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.04)", bottom: -44, left: -24 },
  heroScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
  },
  heroInfo: { flex: 1 },
  heroLabel: { color: WC_COLORS.WHITE, fontSize: 18, fontWeight: "800" },
  heroSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 3 },
  heroStatsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  heroStatTile: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  heroStatValue: { color: WC_COLORS.WHITE, fontSize: 14, fontWeight: "800" },
  heroStatGreen: { color: "#A8F0C8" },
  heroStatLabel: { color: "rgba(255,255,255,0.55)", fontSize: 9, marginTop: 1 },
  readinessWrap: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 13,
    marginTop: 10,
  },
  error: {
    fontSize: 12,
    color: WC_COLORS.ORANGE_LIGHT,
    marginTop: 10,
    lineHeight: 18,
  },
  sectionGap: { marginBottom: 12 },
  recoverySection: { marginBottom: 12 },
  tipsSection: { marginBottom: 12 },
  tipsRow: { gap: 10, paddingBottom: 4 },
  disabled: { opacity: 0.6 },
  loadingBox: { alignItems: "center", paddingVertical: 20, gap: 8 },
  loadingText: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  sectionLabel: { color: WC_COLORS.MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase" },
});
