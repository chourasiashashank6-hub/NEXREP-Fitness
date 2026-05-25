import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { patchCalorieWater } from "../../api/caloriesLog";
import { getCalorieCoachInsight, hasOpenAiKey } from "../../services/aiCoachService";
import { coachAlertsToPills } from "../../services/coachNormalize";
import { useAppTheme } from "../../theme";
import type { AICoachResponse, NutritionData } from "../../types/coach";
import { AlertPill } from "./AlertPill";
import { CircularScore } from "./CircularScore";
import { CoachSectionHeader } from "./CoachSectionHeader";
import { HydrationBar } from "./HydrationBar";
import { InsightBubble } from "./InsightBubble";
import { MacroCard } from "./MacroCard";
import { MealPlanCard } from "./MealPlanCard";

const CACHE_KEY = "ai_calorie_insight_v2";
const MEAL_PLAN_ACCENT = "#22D3EE";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type CachedInsight = {
  result?: AICoachResponse;
  ts?: number;
  signature?: string;
};

function buildNutritionSignature(nutritionData: NutritionData | null): string {
  if (!nutritionData) return "no-data";
  return JSON.stringify({
    tdee: Math.round(Number(nutritionData.tdee || 0)),
    calories: Math.round(Number(nutritionData.caloriesConsumed || 0)),
    protein: Math.round(Number(nutritionData.proteinG || 0) * 10) / 10,
    carbs: Math.round(Number(nutritionData.carbsG || 0) * 10) / 10,
    fat: Math.round(Number(nutritionData.fatG || 0) * 10) / 10,
    water: Math.round(Number(nutritionData.waterMl || 0)),
    meals: Math.round(Number(nutritionData.mealsLogged || 0)),
  });
}

type Props = {
  nutritionData: NutritionData | null;
  accentColor?: string;
  onNutritionRefresh?: () => void;
};

export function AICoachCard({ nutritionData, accentColor = "#22d3ee", onNutritionRefresh }: Props) {
  const { colors, radius } = useAppTheme();
  const [loading, setLoading] = useState(false);
  const [waterLoading, setWaterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AICoachResponse | null>(null);
  const [timestampText, setTimestampText] = useState("Not analyzed yet");
  const [isMealPlanExpanded, setIsMealPlanExpanded] = useState(false);
  const mealPlanChevronRotation = useRef(new Animated.Value(0)).current;
  const currentSignature = useMemo(() => buildNutritionSignature(nutritionData), [nutritionData]);

  const keyMissing = !hasOpenAiKey();
  const hasData = Boolean(nutritionData);

  const proteinTarget = nutritionData?.proteinTargetG ?? Math.round((nutritionData?.tdee ?? 2000) * 0.3 / 4);
  const carbsTarget = nutritionData?.carbsTargetG ?? Math.round((nutritionData?.tdee ?? 2000) * 0.5 / 4);
  const fatTarget = nutritionData?.fatTargetG ?? Math.round((nutritionData?.tdee ?? 2000) * 0.2 / 9);
  const remainingCal = Math.round((nutritionData?.tdee ?? 0) - (nutritionData?.caloriesConsumed ?? 0));

  const run = async () => {
    if (keyMissing || !nutritionData) return;
    try {
      setLoading(true);
      setError(null);
      const next = await getCalorieCoachInsight(nutritionData);
      setResult(next);
      setTimestampText("Analyzed just now");
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ result: next, ts: Date.now(), signature: currentSignature }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load insight. Tap refresh to try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleWaterAdd = async (ml: number) => {
    if (!nutritionData) return;
    try {
      setWaterLoading(true);
      const nextL = (nutritionData.waterMl + ml) / 1000;
      await patchCalorieWater(nextL);
      onNutritionRefresh?.();
    } catch {
      // ignore — parent may retry load
    } finally {
      setWaterLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (!raw || cancelled) {
          if (!cancelled) {
            setResult(null);
            setTimestampText("Not analyzed yet");
          }
          return;
        }
        const cached = JSON.parse(raw) as CachedInsight;
        if (!cached?.result) return;
        if (cancelled) return;
        setResult(cached.result);
        setTimestampText(
          cached.signature && cached.signature === currentSignature
            ? "From previous session"
            : "Previous insight (tap Refresh to update)",
        );
        setError(null);
      } catch {
        if (!cancelled) {
          setResult(null);
          setTimestampText("Not analyzed yet");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSignature]);

  const alertPills = useMemo(() => {
    if (result?.alerts?.length) return coachAlertsToPills(result.alerts);
    return [];
  }, [result?.alerts]);

  const handleToggleMealPlan = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !isMealPlanExpanded;
    Animated.timing(mealPlanChevronRotation, {
      toValue: next ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
    setIsMealPlanExpanded(next);
  };

  const mealPlanChevronStyle = {
    transform: [
      {
        rotate: mealPlanChevronRotation.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", "180deg"],
        }),
      },
    ],
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
      <LinearGradient colors={[accentColor, `${accentColor}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardAccent} />
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>AI coach</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{timestampText}</Text>
        </View>
        <View style={styles.liveWrap}>
          <View style={styles.liveDot} />
        </View>
      </View>

      {keyMissing ? (
        <View style={[styles.setupBox, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
          <Text style={[styles.setupTitle, { color: colors.text }]}>API key missing</Text>
          <Text style={[styles.setupText, { color: colors.muted }]}>Configure GROQ_API_KEY on the server and restart.</Text>
        </View>
      ) : !hasData ? (
        <View style={[styles.setupBox, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
          <Text style={[styles.setupTitle, { color: colors.text }]}>No nutrition data yet</Text>
          <Text style={[styles.setupText, { color: colors.muted }]}>Log your meals first to get AI insights.</Text>
        </View>
      ) : (
        <>
          {loading && !result ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={accentColor} />
              <Text style={[styles.loadingText, { color: colors.muted }]}>Building your nutrition plan...</Text>
            </View>
          ) : null}

          {result ? (
            <>
              <CircularScore
                score={result.dailyScore}
                label={result.scoreLabel}
                subtitle="Based on calories, macros, hydration, and meal timing"
              />

              <InsightBubble loading={false} insight={result.insight} error={error} expandLinkColor={accentColor} />

              <View style={[styles.bodyImpact, { backgroundColor: "rgba(56,189,248,0.08)", borderColor: "rgba(56,189,248,0.2)", borderRadius: radius.md }]}>
                <Text style={[styles.bodyImpactTitle, { color: accentColor }]}>How this affects you</Text>
                <Text style={[styles.bodyImpactText, { color: colors.text }]}>{result.bodyImpact}</Text>
              </View>

              <CoachSectionHeader title="MACRO BREAKDOWN" accent={accentColor} />
              <View style={styles.macroRow}>
                <MacroCard
                  name="Protein"
                  consumed={nutritionData?.proteinG ?? 0}
                  target={proteinTarget}
                  status={result.macroVerdict.protein.status}
                  tip={result.macroVerdict.protein.tip}
                />
                <MacroCard
                  name="Carbs"
                  consumed={nutritionData?.carbsG ?? 0}
                  target={carbsTarget}
                  status={result.macroVerdict.carbs.status}
                  tip={result.macroVerdict.carbs.tip}
                />
                <MacroCard
                  name="Fat"
                  consumed={nutritionData?.fatG ?? 0}
                  target={fatTarget}
                  status={result.macroVerdict.fat.status}
                  tip={result.macroVerdict.fat.tip}
                />
              </View>

              {result.mealPlan.length > 0 ? (
                <View style={styles.mealPlanSection}>
                  <LinearGradient
                    colors={[accentColor, `${accentColor}66`, "transparent"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.mealPlanAccent}
                  />
                  <Pressable
                    onPress={handleToggleMealPlan}
                    style={styles.mealPlanHeader}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isMealPlanExpanded }}
                    accessibilityLabel="Your meal plan"
                  >
                    <View style={styles.mealPlanHeaderText}>
                      <Text style={[styles.mealPlanTitle, { color: MEAL_PLAN_ACCENT }]}>YOUR MEAL PLAN</Text>
                      <Text style={styles.mealPlanSubtitle}>Fill your remaining {Math.max(0, remainingCal)} kcal</Text>
                    </View>
                    <Animated.View style={mealPlanChevronStyle}>
                      <Ionicons name="chevron-down" size={20} color={MEAL_PLAN_ACCENT} />
                    </Animated.View>
                  </Pressable>
                  {isMealPlanExpanded ? (
                    <View style={styles.mealPlanContent}>
                      <View style={styles.mealPlanDivider} />
                      {result.mealPlan.map((m, i) => (
                        <MealPlanCard key={`${m.meal}-${i}`} {...m} />
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <HydrationBar
                currentMl={result.hydrationPlan.currentMl}
                targetMl={result.hydrationPlan.targetMl}
                nextAction={result.hydrationPlan.nextAction}
                onQuickAdd={(ml) => void handleWaterAdd(ml)}
                loading={waterLoading}
              />

              {alertPills.length > 0 ? (
                <View style={styles.grid}>
                  {alertPills.map((a, idx) => (
                    <View key={`${a.title}-${idx}`} style={styles.gridItem}>
                      <AlertPill alert={a} />
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <InsightBubble loading={loading} insight="" error={error} expandLinkColor={accentColor} placeholder="Tap refresh to generate your premium nutrition plan." />
          )}

          <Pressable
            style={[styles.refreshBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.md }, loading && { opacity: 0.6 }]}
            disabled={loading}
            onPress={() => void run()}
          >
            <Text style={[styles.refreshText, { color: colors.text }]}>↻ Refresh AI insight</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, marginBottom: 12, overflow: "hidden" },
  cardAccent: { height: 3, width: "100%", borderRadius: 2, marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 15, fontWeight: "600" },
  sub: { fontSize: 12, marginTop: 2 },
  liveWrap: { paddingHorizontal: 6, paddingVertical: 4 },
  liveDot: { width: 10, height: 10, borderRadius: 99, backgroundColor: "#639922" },
  loadingBox: { alignItems: "center", paddingVertical: 24, gap: 10 },
  loadingText: { fontSize: 12 },
  bodyImpact: { borderWidth: 1, padding: 12, marginTop: 12 },
  bodyImpactTitle: { fontSize: 12, fontWeight: "700", marginBottom: 6 },
  bodyImpactText: { fontSize: 13, lineHeight: 19 },
  macroRow: { flexDirection: "row", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 12, gap: 10 },
  gridItem: { width: "48%" },
  refreshBtn: { minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, marginTop: 12 },
  refreshText: { fontSize: 13, fontWeight: "600" },
  setupBox: { borderWidth: 1, padding: 12 },
  setupTitle: { fontSize: 14, fontWeight: "600" },
  setupText: { marginTop: 4, fontSize: 12, lineHeight: 18 },
  mealPlanSection: { marginTop: 16 },
  mealPlanAccent: { height: 2, borderRadius: 1, marginBottom: 8 },
  mealPlanHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 10,
  },
  mealPlanHeaderText: { flex: 1 },
  mealPlanTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9 },
  mealPlanSubtitle: { fontSize: 12, color: "#9AA8C4", marginTop: 4 },
  mealPlanContent: { paddingBottom: 4 },
  mealPlanDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 10,
  },
});
