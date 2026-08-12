import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Circle } from "react-native-svg";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { getCalorieCoachInsight, hasOpenAiKey } from "../../services/aiCoachService";
import type { AICoachResponse, MacroStatus, NutritionData } from "../../types/coach";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const AMBER = "#FFB800";
const AMBER_LIGHT = "#FFF8E8";
const AMBER_TEXT = "#C08000";
const PURPLE = "#7B68CC";
const GOLD = "#FFD700";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";

const CACHE_KEY_PREFIX = "ai_calorie_insight_v2";

function cacheStorageKey(logDate: string): string {
  return `${CACHE_KEY_PREFIX}:${logDate}`;
}

type CachedInsight = {
  result?: AICoachResponse;
  ts?: number;
  signature?: string;
  logDate?: string;
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
  logDate: string;
  nutritionData: NutritionData | null;
  accentColor?: string;
  onNutritionRefresh?: () => void;
  onCoachResult?: (result: AICoachResponse | null) => void;
  onLoadingChange?: (loading: boolean) => void;
};

export type AICoachCardHandle = {
  refresh: () => void;
};

type MacroKey = "protein" | "carbs" | "fat";

function getMacroFoods(dietType: string): Record<MacroKey, string[]> {
  const isVegan = dietType === "vegan";
  const isVegetarian = dietType === "vegetarian" || isVegan;

  const protein = isVegan
    ? ["🥜 Almonds 30g", "🫘 Dal 150g", "🌱 Tofu 100g", "🥜 Peanut butter 2tbsp", "🫛 Edamame 100g"]
    : isVegetarian
      ? ["🧀 Paneer 80g", "🥚 2 Eggs", "🥛 Greek yogurt", "🫘 Dal 150g", "🥜 Almonds 30g"]
      : ["🧀 Paneer 80g", "🥚 2 Eggs", "🍗 Chicken 120g", "🥛 Greek yogurt", "🐟 Tuna 100g"];

  return {
    protein,
    carbs: ["🍚 Brown rice", "🫓 2 Roti", "🥣 Oats 80g", "🍠 Sweet potato", "🍌 Banana"],
    fat: ["🥜 Almonds", "🫒 Olive oil", "🥑 Avocado", "🥥 Coconut", "🧈 Peanut butter"],
  };
}

const MACRO_META: Record<MacroKey, { label: string; color: string; light: string; emoji: string; subtitle: string }> = {
  protein: { label: i18n.t("coach.calorie.card.protein"), color: BLUE, light: BLUE_LIGHT, emoji: "💪", subtitle: i18n.t("coach.calorie.card.proteinSubtitle") },
  carbs: { label: i18n.t("coach.calorie.card.carbs"), color: GREEN, light: GREEN_LIGHT, emoji: "⚡", subtitle: i18n.t("coach.calorie.card.carbsSubtitle") },
  fat: { label: i18n.t("coach.calorie.card.fat"), color: AMBER_TEXT, light: AMBER_LIGHT, emoji: "🥑", subtitle: i18n.t("coach.calorie.card.fatSubtitle") },
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function statusTone(status: MacroStatus) {
  if (status === "low") return { bg: ORANGE_LIGHT, color: ORANGE, label: i18n.t("coach.calorie.card.low") };
  if (status === "high") return { bg: AMBER_LIGHT, color: AMBER_TEXT, label: i18n.t("coach.calorie.card.high") };
  return { bg: GREEN_LIGHT, color: GREEN, label: i18n.t("coach.calorie.card.onTrack") };
}

function extractGapText(tip: string, fallback: number) {
  const match = tip.match(/(\d+(?:\.\d+)?)\s*g/i);
  if (match?.[0]) return match[0].replace(/\s+/g, "");
  return `${Math.max(0, Math.round(fallback))}g`;
}

function MacroRing({ value, target, color }: { value: number; target: number; color: string }) {
  const size = 64;
  const radius = 28;
  const circumference = 175.9;
  const progress = clamp(target > 0 ? value / target : 0);
  return (
    <View style={styles.macroRingWrap}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={TRACK} strokeWidth={7} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${progress * circumference} ${circumference}`}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.macroRingCenter}>
        <Text style={[styles.macroRingText, { color }]}>{Math.round(value)}g</Text>
      </View>
    </View>
  );
}

function ScoreRing({ value }: { value: number }) {
  const size = 90;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <View style={styles.scoreRingWrap}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.15)" strokeWidth={8} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={GOLD}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={offset}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.scoreRingCenter}>
        <Text style={styles.scoreRingText}>{clamped}</Text>
      </View>
    </View>
  );
}

function ExpandableInsight({ insight, error, loading }: { insight: string; error?: string | null; loading: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setCanExpand(false);
  }, [insight]);

  if (loading) {
    return (
      <View style={styles.insightBubble}>
        <Text style={styles.insightText}>●  ●  ●</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.insightBubble}>
        <Text style={[styles.insightText, { color: ORANGE_LIGHT }]}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.insightBubble}>
      <Text
        style={styles.insightText}
        numberOfLines={expanded ? undefined : 4}
        onTextLayout={(e) => {
          if (expanded) return;
          if (e.nativeEvent.lines.length > 4) setCanExpand(true);
        }}
      >
        {insight}
      </Text>
      {canExpand ? (
        <Pressable onPress={() => setExpanded((next) => !next)} hitSlop={8}>
          <Text style={styles.insightMore}>{expanded ? t("coach.calorie.card.showLess") : "..."}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const AICoachCard = forwardRef<AICoachCardHandle, Props>(function AICoachCard(
  { logDate, nutritionData, accentColor = PURPLE, onNutritionRefresh, onCoachResult, onLoadingChange },
  ref,
) {
  const { t } = useTranslation();
  const { data: onboardingData } = useOnboardingContext();
  const dietType = (onboardingData?.dietary?.diet_type ?? "none").toLowerCase().trim();
  const MACRO_FOODS = getMacroFoods(dietType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AICoachResponse | null>(null);
  const [timestampText, setTimestampText] = useState(t("coach.calorie.card.notAnalyzed"));
  const [loadedCacheSignature, setLoadedCacheSignature] = useState<string | null>(null);
  const currentSignature = useMemo(() => buildNutritionSignature(nutritionData), [nutritionData]);
  const isStaleInsight = Boolean(result && loadedCacheSignature && loadedCacheSignature !== currentSignature);

  const keyMissing = !hasOpenAiKey();
  const hasData = Boolean(nutritionData);

  const proteinTarget = nutritionData?.proteinTargetG ?? Math.round((nutritionData?.tdee ?? 2000) * 0.3 / 4);
  const carbsTarget = nutritionData?.carbsTargetG ?? Math.round((nutritionData?.tdee ?? 2000) * 0.5 / 4);
  const fatTarget = nutritionData?.fatTargetG ?? Math.round((nutritionData?.tdee ?? 2000) * 0.2 / 9);
  const run = async () => {
    if (keyMissing || !nutritionData) return;
    try {
      setLoading(true);
      onLoadingChange?.(true);
      setError(null);
      const next = await getCalorieCoachInsight(nutritionData, logDate);
      setResult(next);
      onCoachResult?.(next);
      setLoadedCacheSignature(currentSignature);
      setTimestampText(t("coach.calorie.card.analyzedJustNow"));
      await AsyncStorage.setItem(
        cacheStorageKey(logDate),
        JSON.stringify({ result: next, ts: Date.now(), signature: currentSignature, logDate }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("coach.calorie.card.loadInsightFailed");
      setError(msg);
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(cacheStorageKey(logDate));
        if (!raw || cancelled) {
          if (!cancelled) {
            setResult(null);
            setLoadedCacheSignature(null);
            onCoachResult?.(null);
            setTimestampText(t("coach.calorie.card.notAnalyzed"));
          }
          return;
        }
        const cached = JSON.parse(raw) as CachedInsight;
        if (!cached?.result) return;
        if (cancelled) return;
        setResult(cached.result);
        setLoadedCacheSignature(cached.signature ?? null);
        onCoachResult?.(cached.result);
        setTimestampText(
          cached.signature && cached.signature === currentSignature
            ? t("coach.calorie.card.previousSession")
            : t("coach.calorie.card.previousInsight"),
        );
        setError(null);
      } catch {
        if (!cancelled) {
          setResult(null);
          setLoadedCacheSignature(null);
          onCoachResult?.(null);
          setTimestampText(t("coach.calorie.card.notAnalyzed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSignature, logDate, onCoachResult, t]);

  useImperativeHandle(ref, () => ({
    refresh: () => {
      void run();
    },
  }));

  return (
    <View style={styles.card}>
      {keyMissing ? (
        <View style={styles.setupBox}>
          <Text style={styles.setupTitle}>{t("coach.calorie.card.apiKeyMissing")}</Text>
          <Text style={styles.setupText}>{t("coach.calorie.card.apiKeyMissingBody")}</Text>
        </View>
      ) : !hasData ? (
        <View style={styles.setupBox}>
          <Text style={styles.setupTitle}>{t("coach.calorie.card.noNutritionData")}</Text>
          <Text style={styles.setupText}>{t("coach.calorie.card.noNutritionDataBody")}</Text>
        </View>
      ) : (
        <>
          {loading && !result ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={accentColor} />
              <Text style={styles.loadingText}>{t("coach.calorie.card.buildingNutritionPlan")}</Text>
            </View>
          ) : null}

          {result ? (
            <>
              <View style={[styles.heroCard, isStaleInsight && styles.heroCardStale]}>
                {isStaleInsight ? (
                  <View style={styles.staleBanner}>
                    <Text style={styles.staleBannerText}>{t("coach.calorie.card.staleInsightBanner")}</Text>
                  </View>
                ) : null}
                <View style={styles.heroCircleOne} />
                <View style={styles.heroCircleTwo} />
                <View style={[styles.heroTopRow, isStaleInsight && styles.heroContentStale]}>
                  <ScoreRing value={result.dailyScore} />
                  <View style={styles.heroTextCol}>
                    <Text style={[styles.scoreLabel, isStaleInsight && styles.staleText]}>{result.scoreLabel}</Text>
                    <Text style={[styles.scoreSubtitle, isStaleInsight && styles.staleTextMuted]}>{t("coach.calorie.card.scoreSubtitle")}</Text>
                    <View style={styles.heroStatsRow}>
                      <View style={styles.heroStatTile}>
                        <Text style={[styles.heroStatValue, isStaleInsight && styles.staleText]}>{Math.round(nutritionData?.caloriesConsumed ?? 0)}</Text>
                        <Text style={[styles.heroStatLabel, isStaleInsight && styles.staleTextMuted]}>{t("coach.calorie.card.eaten")}</Text>
                      </View>
                      <View style={styles.heroStatTile}>
                        <Text style={[styles.heroStatValue, styles.remainingValue, isStaleInsight && styles.staleText]}>
                          {Math.max(0, Math.round((nutritionData?.tdee ?? 0) - (nutritionData?.caloriesConsumed ?? 0)))}
                        </Text>
                        <Text style={[styles.heroStatLabel, isStaleInsight && styles.staleTextMuted]}>{t("coach.calorie.card.left")}</Text>
                      </View>
                    </View>
                  </View>
                </View>
                <ExpandableInsight loading={false} insight={result.insight} error={error} />
                <View style={[styles.bodyImpact, isStaleInsight && styles.bodyImpactStale]}>
                  <Text style={[styles.bodyImpactTitle, isStaleInsight && styles.staleTextMuted]}>{t("coach.calorie.card.bodyImpact")}</Text>
                  <Text style={[styles.bodyImpactText, isStaleInsight && styles.staleTextMuted]}>{result.bodyImpact}</Text>
                </View>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>{t("coach.calorie.card.macroBreakdown")}</Text>
                <View style={styles.macroRow}>
                  {([
                    ["protein", nutritionData?.proteinG ?? 0, proteinTarget],
                    ["carbs", nutritionData?.carbsG ?? 0, carbsTarget],
                    ["fat", nutritionData?.fatG ?? 0, fatTarget],
                  ] as Array<[MacroKey, number, number]>).map(([key, consumed, target]) => {
                    const meta = MACRO_META[key];
                    const status = statusTone(result.macroVerdict[key].status);
                    return (
                      <View key={key} style={styles.macroColumn}>
                        <MacroRing value={consumed} target={target} color={meta.color} />
                        <Text style={styles.macroName}>{meta.label}</Text>
                        <Text style={styles.macroTarget}>/ {Math.round(target)}g</Text>
                        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={styles.recommendationSection}>
                <View style={styles.recommendationHeader}>
                  <Text style={styles.sectionLabel}>{t("coach.calorie.card.dietRecommendations")}</Text>
                  <View style={styles.recommendationBadge}>
                    <Text style={styles.recommendationBadgeText}>{t("coach.calorie.card.basedOnGaps")}</Text>
                  </View>
                </View>
                {(["protein", "carbs", "fat"] as MacroKey[]).filter((key) => result.macroVerdict[key].status === "low").length === 0 ? (
                  <View style={styles.successCard}>
                    <Text style={styles.successText}>{t("coach.calorie.card.allMacrosOnTrack")}</Text>
                  </View>
                ) : (
                  (["protein", "carbs", "fat"] as MacroKey[])
                    .filter((key) => result.macroVerdict[key].status === "low")
                    .map((key) => {
                      const meta = MACRO_META[key];
                      const consumed = key === "protein" ? nutritionData?.proteinG ?? 0 : key === "carbs" ? nutritionData?.carbsG ?? 0 : nutritionData?.fatG ?? 0;
                      const target = key === "protein" ? proteinTarget : key === "carbs" ? carbsTarget : fatTarget;
                      const gap = extractGapText(result.macroVerdict[key].tip, target - consumed);
                      return (
                        <View key={key} style={styles.gapCard}>
                          <View style={[styles.gapStrip, { backgroundColor: meta.light }]}>
                            <View style={[styles.gapIconTile, { backgroundColor: meta.color }]}>
                              <Text style={styles.gapEmoji}>{meta.emoji}</Text>
                            </View>
                            <View style={styles.gapTitleWrap}>
                              <Text style={[styles.gapTitle, { color: meta.color }]}>{t("coach.calorie.card.macroGap", { macro: meta.label })}</Text>
                              <Text style={[styles.gapSubtitle, { color: meta.color }]}>{meta.subtitle}</Text>
                            </View>
                            <View style={[styles.gapBadge, { backgroundColor: meta.color }]}>
                              <Text style={styles.gapBadgeText}>{gap}</Text>
                            </View>
                          </View>
                          <View style={styles.gapBody}>
                            <Text style={styles.suggestsLabel}>{t("coach.calorie.card.aiSuggests")}</Text>
                            <View style={styles.foodChips}>
                              {MACRO_FOODS[key].map((food) => (
                                <View key={food} style={styles.foodChip}>
                                  <Text style={styles.foodChipText}>{food}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        </View>
                      );
                    })
                )}
              </View>

              <View style={styles.timestampRow}>
                <Text style={styles.timestampText}>{timestampText}</Text>
              </View>
            </>
          ) : (
            <>
              <ExpandableInsight loading={loading} insight="" error={error} />
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderText}>{t("coach.calorie.card.placeholder")}</Text>
              </View>
            </>
          )}

        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  heroCard: { backgroundColor: GREEN, borderRadius: 22, paddingVertical: 20, paddingHorizontal: 18, overflow: "hidden", marginBottom: 12 },
  heroCardStale: { opacity: 0.55 },
  staleBanner: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  staleBannerText: { color: GOLD, fontSize: 12, fontWeight: "900", textAlign: "center" },
  heroContentStale: { opacity: 0.85 },
  staleText: { opacity: 0.75 },
  staleTextMuted: { opacity: 0.6 },
  bodyImpactStale: { opacity: 0.7 },
  heroCircleOne: { position: "absolute", width: 160, height: 160, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.05)", top: -62, right: -42 },
  heroCircleTwo: { position: "absolute", width: 110, height: 110, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.04)", bottom: -38, left: -26 },
  heroTopRow: { flexDirection: "row", gap: 16, alignItems: "center" },
  scoreRingWrap: { width: 90, height: 90 },
  scoreRingCenter: { position: "absolute", top: 0, left: 0, width: 90, height: 90, alignItems: "center", justifyContent: "center" },
  scoreRingText: { color: GOLD, fontSize: 28, fontWeight: "900" },
  heroTextCol: { flex: 1 },
  scoreLabel: { color: WHITE, fontSize: 18, fontWeight: "900" },
  scoreSubtitle: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 3 },
  heroStatsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  heroStatTile: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 9 },
  heroStatValue: { color: WHITE, fontSize: 14, fontWeight: "900" },
  remainingValue: { color: "#A8F0C8" },
  heroStatLabel: { color: "rgba(255,255,255,0.55)", fontSize: 9, marginTop: 1 },
  insightBubble: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, marginTop: 14 },
  insightText: { color: "rgba(255,255,255,0.8)", fontSize: 11, lineHeight: 17 },
  insightMore: { color: GOLD, fontSize: 11, fontWeight: "800", marginTop: 4 },
  bodyImpact: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, borderLeftWidth: 3, borderLeftColor: "rgba(255,255,255,0.4)", padding: 12, marginTop: 10 },
  bodyImpactTitle: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "900", textTransform: "uppercase", marginBottom: 5 },
  bodyImpactText: { color: "rgba(255,255,255,0.6)", fontSize: 11, lineHeight: 17 },
  sectionCard: { backgroundColor: BG, borderRadius: 18, padding: 14, marginBottom: 12 },
  sectionLabel: { color: MUTED, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  macroRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 12 },
  macroColumn: { flex: 1, alignItems: "center" },
  macroRingWrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  macroRingCenter: { position: "absolute", width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  macroRingText: { fontSize: 12, fontWeight: "900" },
  macroName: { color: TEXT, fontSize: 11, fontWeight: "900", marginTop: 7 },
  macroTarget: { color: MUTED, fontSize: 10, marginTop: 2 },
  statusBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, marginTop: 7 },
  statusText: { fontSize: 9, fontWeight: "900" },
  recommendationSection: { marginBottom: 12 },
  recommendationHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  recommendationBadge: { backgroundColor: GREEN_LIGHT, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 },
  recommendationBadgeText: { color: GREEN, fontSize: 10, fontWeight: "900" },
  successCard: { backgroundColor: GREEN_LIGHT, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  successText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  gapCard: { backgroundColor: WHITE, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: "hidden", marginBottom: 8 },
  gapStrip: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
  gapIconTile: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  gapEmoji: { fontSize: 17 },
  gapTitleWrap: { flex: 1 },
  gapTitle: { fontSize: 12, fontWeight: "900" },
  gapSubtitle: { fontSize: 10, opacity: 0.7, marginTop: 2 },
  gapBadge: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 },
  gapBadgeText: { color: WHITE, fontSize: 10, fontWeight: "900" },
  gapBody: { paddingVertical: 11, paddingHorizontal: 14 },
  suggestsLabel: { color: MUTED, fontSize: 10, fontWeight: "900", marginBottom: 8 },
  foodChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  foodChip: { backgroundColor: BG, borderRadius: 99, paddingVertical: 5, paddingHorizontal: 11 },
  foodChipText: { color: TEXT, fontSize: 11, fontWeight: "600" },
  timestampRow: { alignItems: "center", marginBottom: 4 },
  timestampText: { color: MUTED, fontSize: 10, fontWeight: "700" },
  loadingBox: { alignItems: "center", backgroundColor: BG, borderRadius: 18, paddingVertical: 24, gap: 10, marginBottom: 12 },
  loadingText: { color: MUTED, fontSize: 12 },
  placeholderCard: { backgroundColor: BG, borderRadius: 16, padding: 14, marginTop: 10 },
  placeholderText: { color: TEXT, fontSize: 12, lineHeight: 18 },
  disabledBtn: { opacity: 0.6 },
  setupBox: { backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 14, marginBottom: 12 },
  setupTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  setupText: { color: MUTED, marginTop: 4, fontSize: 12, lineHeight: 18 },
});
