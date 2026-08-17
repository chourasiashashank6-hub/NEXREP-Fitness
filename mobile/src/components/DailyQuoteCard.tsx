import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { getDailyQuote, type MotivationalQuote, type QuoteCategory } from "../api/quotes";

type GoalLabel = "Fat Loss" | "Muscle Gain" | "Strength" | string | null | undefined;

const CATEGORY_META: Record<QuoteCategory, { labelKey: string; bg: string; text: string; avatarBg: string }> = {
  muscle_gain: {
    labelKey: "components.dailyQuote.categories.muscleGain",
    bg: "rgba(124,92,252,0.15)",
    text: "#A78BFA",
    avatarBg: "rgba(124,92,252,0.2)",
  },
  fat_loss: {
    labelKey: "components.dailyQuote.categories.fatLoss",
    bg: "rgba(252,92,92,0.15)",
    text: "#F87171",
    avatarBg: "rgba(252,92,92,0.2)",
  },
  strength: {
    labelKey: "components.dailyQuote.categories.strength",
    bg: "rgba(250,175,60,0.15)",
    text: "#FBBF24",
    avatarBg: "rgba(250,175,60,0.2)",
  },
  general: {
    labelKey: "components.dailyQuote.categories.general",
    bg: "rgba(255,255,255,0.1)",
    text: "rgba(255,255,255,0.5)",
    avatarBg: "rgba(255,255,255,0.2)",
  },
};

const goalToQuoteCategory = (goal: GoalLabel): Exclude<QuoteCategory, "general"> | undefined => {
  const normalized = String(goal || "").trim().toLowerCase();
  if (normalized === "fat loss" || normalized === "fat_loss") return "fat_loss";
  if (normalized === "muscle gain" || normalized === "muscle_gain") return "muscle_gain";
  if (normalized === "strength") return "strength";
  return undefined;
};

export function DailyQuoteCard({ goal }: { goal?: GoalLabel }) {
  const { t } = useTranslation();
  const [quote, setQuote] = useState<MotivationalQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const category = goalToQuoteCategory(goal);

  const loadQuote = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getDailyQuote(category);
      setQuote(next);
    } catch (err) {
      setQuote(null);
      const detail =
        err && typeof err === "object" && "response" in err
          ? String((err as { response?: { status?: number; data?: { detail?: string } } }).response?.status ?? "")
          : err instanceof Error
            ? err.message
            : String(err);
      const message =
        err && typeof err === "object" && "response" in err
          ? String((err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "")
          : "";
      console.warn("[DailyQuoteCard] Quote unavailable:", message || detail || "unknown error");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  const meta = CATEGORY_META[quote?.category ?? "general"];
  const authorInitial = quote?.author?.trim()?.[0]?.toUpperCase() || "?";

  return (
    <View style={styles.card}>
      <View style={[styles.accent, { backgroundColor: "#7C5CFC" }]} />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.kicker}>{t("components.dailyQuote.title")}</Text>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.badgeText, { color: meta.text }]}>{t(meta.labelKey)}</Text>
          </View>
        </View>

        {loading && !quote ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#7C5CFC" />
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, styles.skeletonShort]} />
          </View>
        ) : quote ? (
          <View>
            <Text style={styles.quoteText}>"{quote.quote}"</Text>
            <View style={styles.authorRow}>
              <View style={[styles.authorAvatar, { backgroundColor: meta.avatarBg }]}>
                <Text style={[styles.authorInitial, { color: meta.text }]}>{authorInitial}</Text>
              </View>
              <Text style={styles.authorName}>{quote.author}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.emptyText}>{t("components.dailyQuote.empty")}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#17151F",
    minHeight: 172,
  },
  accent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  content: { padding: 18, paddingLeft: 20, paddingBottom: 20 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  kicker: {
    color: "#7C5CFC",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  quoteText: { color: "#F0F0F0", fontSize: 17, lineHeight: 26, fontWeight: "600" },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  authorAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  authorInitial: { fontSize: 12, fontWeight: "900" },
  authorName: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "700", flex: 1 },
  loadingBox: { gap: 10, paddingVertical: 6 },
  skeletonLine: { height: 13, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.08)", width: "92%" },
  skeletonShort: { width: "68%" },
  emptyText: { color: "#F0F0F0", fontSize: 17, lineHeight: 26, fontWeight: "600" },
});
