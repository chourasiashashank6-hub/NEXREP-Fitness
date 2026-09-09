import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { todayLocal } from "../../api/caloriesLog";
import { fetchYearlyCoachSummary, type CoachYearlySummaryResponse } from "../../api/coachConfig";
import { ScreenContainer } from "../../components/ScreenContainer";
import { CoachCadenceLockedPanel } from "../../components/Coach/CoachCadenceLockedPanel";
import { CoachYearlyHistoryPanel } from "../../components/Coach/CoachYearlyHistoryPanel";
import { CoachPeriodRangeLabel } from "../../components/Coach/shared/CoachPeriodRangeLabel";
import { CADENCE_FEATURE, useCoachRedesignEnabled } from "../../hooks/useCoachRedesign";
import { useCoachHistory } from "../../hooks/useCoachHistory";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { GREEN, BG, TEXT, BORDER, WHITE } from "../../theme/colors";

const GREEN_DARK = "#0A4A3A";
const MUTED = "#BBBBBB";

export default function YearlyReviewScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { hasFeatureAccess } = useFeatureAccess();
  const { enabled: redesignEnabled } = useCoachRedesignEnabled();
  const { history } = useCoachHistory();
  const yearlyUnlocked = hasFeatureAccess(CADENCE_FEATURE.yearly);
  const [summary, setSummary] = useState<CoachYearlySummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await fetchYearlyCoachSummary(todayLocal()));
    } catch {
      setError(t("coach.redesign.yearly.loadFailed"));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (redesignEnabled && yearlyUnlocked && history.yearly_unlocked) {
      void loadSummary();
    }
  }, [history.yearly_unlocked, loadSummary, redesignEnabled, yearlyUnlocked]);

  const handleShare = async () => {
    if (!summary?.yearly) return;
    const y = summary.yearly;
    const weightDelta = y.nutrition.weight.change_kg;
    const weightLine =
      weightDelta == null
        ? t("coach.redesign.yearly.shareWeightUnknown")
        : t("coach.redesign.yearly.shareWeight", { kg: Math.abs(weightDelta).toFixed(1), direction: weightDelta <= 0 ? "down" : "up" });
    const message = t("coach.redesign.yearly.shareMessage", {
      year: summary.period.year,
      score: y.year_score,
      daysLogged: y.nutrition.days_logged,
      sessions: y.workout.sessions,
      adherence: y.nutrition.adherence_pct,
      weightLine,
    });
    await Share.share({ message });
  };

  if (redesignEnabled && !yearlyUnlocked) {
    return (
      <ScreenContainer bg={WHITE} contentStyle={styles.screenContent}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={TEXT} />
          </Pressable>
          <Text style={styles.title}>{t("coach.redesign.yearly.title")}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <CoachCadenceLockedPanel cadence="yearly" accentColor={GREEN} />
      </ScreenContainer>
    );
  }

  if (redesignEnabled && yearlyUnlocked && !history.yearly_unlocked) {
    return (
      <ScreenContainer bg={WHITE} contentStyle={styles.screenContent}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={TEXT} />
          </Pressable>
          <Text style={styles.title}>{t("coach.redesign.yearly.title")}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <CoachYearlyHistoryPanel
          daysUntil={history.days_until_yearly}
          unlockAtDays={history.yearly_unlock_at_days}
          accentColor={GREEN}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer bg={WHITE} contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>
        <Text style={styles.title}>{t("coach.redesign.yearly.title")}</Text>
        <Pressable
          style={styles.shareBtn}
          onPress={() => void handleShare()}
          disabled={!summary?.yearly}
          accessibilityRole="button"
          accessibilityLabel={t("coach.redesign.yearly.share")}
        >
          <Ionicons name="share-outline" size={16} color={summary?.yearly ? GREEN : MUTED} />
          <Text style={[styles.shareText, summary?.yearly ? styles.shareTextActive : null]}>
            {t("coach.redesign.yearly.share")}
          </Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={GREEN} style={styles.loader} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void loadSummary()}>
              <Text style={styles.retryText}>{t("coach.redesign.yearly.retry")}</Text>
            </Pressable>
          </View>
        ) : summary?.yearly ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroKicker}>{t("coach.redesign.yearly.heroKicker")}</Text>
              <Text style={styles.heroTitle}>{t("coach.redesign.yearly.recapTitle", { year: summary.period.year })}</Text>
              <Text style={styles.heroScore}>{summary.yearly.year_score}</Text>
              <Text style={styles.heroSub}>{t("coach.redesign.yearly.recapSubtitle")}</Text>
            </View>
            <CoachPeriodRangeLabel
              cadence="yearly"
              startDate={summary.period.start}
              endDate={summary.period.end}
            />
            <View style={styles.grid}>
              <StatTile label={t("coach.redesign.yearly.statDaysLogged")} value={String(summary.yearly.nutrition.days_logged)} />
              <StatTile label={t("coach.redesign.yearly.statAdherence")} value={`${summary.yearly.nutrition.adherence_pct}%`} />
              <StatTile label={t("coach.redesign.yearly.statSessions")} value={String(summary.yearly.workout.sessions)} />
              <StatTile label={t("coach.redesign.yearly.statSets")} value={String(summary.yearly.workout.total_sets)} />
            </View>
            {summary.yearly.nutrition.weight.change_kg != null ? (
              <View style={styles.weightCard}>
                <Text style={styles.weightLabel}>{t("coach.redesign.yearly.weightJourney")}</Text>
                <Text style={styles.weightValue}>
                  {summary.yearly.nutrition.weight.change_kg > 0 ? "+" : ""}
                  {summary.yearly.nutrition.weight.change_kg.toFixed(1)} kg
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>{t("coach.redesign.yearly.heroKicker")}</Text>
            <Text style={styles.heroTitle}>{t("coach.redesign.yearly.comingSoonTitle")}</Text>
            <Text style={styles.heroSub}>{t("coach.redesign.yearly.comingSoonBody")}</Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, color: TEXT, fontSize: 16, fontWeight: "900" },
  headerSpacer: { width: 72 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  shareText: { color: MUTED, fontSize: 11, fontWeight: "800" },
  shareTextActive: { color: GREEN },
  loader: { marginTop: 24 },
  errorBox: { padding: 16, gap: 10 },
  errorText: { color: "#D85A30", fontSize: 13 },
  retryBtn: { alignSelf: "flex-start" },
  retryText: { color: GREEN, fontWeight: "800", fontSize: 13 },
  hero: {
    backgroundColor: GREEN_DARK,
    borderRadius: 22,
    padding: 22,
    marginBottom: 12,
  },
  heroKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  heroTitle: { color: WHITE, fontSize: 20, fontWeight: "900", marginBottom: 8 },
  heroScore: { color: WHITE, fontSize: 42, fontWeight: "900", marginBottom: 4 },
  heroSub: { color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  statTile: {
    width: "47%",
    backgroundColor: BG,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statLabel: { color: MUTED, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  statValue: { color: TEXT, fontSize: 20, fontWeight: "900" },
  weightCard: {
    backgroundColor: WHITE,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  weightLabel: { color: MUTED, fontSize: 11, fontWeight: "800", marginBottom: 4 },
  weightValue: { color: TEXT, fontSize: 22, fontWeight: "900" },
});
