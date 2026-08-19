import { StyleSheet, Text, View } from "react-native";
import { formatSummaryMonth } from "../../../utils/coachSummaryFormat";
import { useTranslation } from "react-i18next";
import type { CoachSummaryResponse } from "../../../types/coachSummary";
import { CoachInsightNoteFromKey } from "../shared/CoachInsightNote";
import { CoachNutritionHero } from "../shared/CoachNutritionHero";
import { CoachPartialPeriodBanner } from "../shared/CoachPartialPeriodBanner";

const GREEN = "#0F6E56";
const TRACK = "#E5E4E0";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const WHITE = "#FFFFFF";
const BORDER = "#ECEAE5";
const AMBER = "#C08000";
const AMBER_LIGHT = "#FFF8E8";

type Props = {
  summary: CoachSummaryResponse;
};

export function CalorieMonthlyView({ summary }: Props) {
  const { t } = useTranslation();
  const monthly = summary.monthly;
  if (!monthly) return null;

  const partialLabel = summary.period.label_partial
    ? t("coach.summary.nutrition.monthly.partialMonth", { day: summary.period.end_date.slice(-2) })
    : null;
  const emptyMonth = monthly.days_logged === 0 ? t("coach.summary.partial.noDaysLoggedMonth") : null;

  const pattern = summary.notes?.find((n) => n.kind === "recurring_pattern");
  const biggestWin = summary.notes?.find((n) => n.kind === "biggest_win");
  const nextMonth = summary.notes?.find((n) => n.kind === "next_month");

  const weightChange =
    monthly.weight.change_kg != null
      ? `${monthly.weight.change_kg > 0 ? "+" : ""}${monthly.weight.change_kg} kg`
      : "—";

  const startKg = monthly.weight.start_kg ?? monthly.weight.end_kg;
  const endKg = monthly.weight.end_kg ?? monthly.weight.start_kg;
  const targetKg = monthly.target_weight_kg;
  const progressPct =
    startKg != null && endKg != null && targetKg != null && startKg !== targetKg
      ? Math.max(0, Math.min(100, Math.round(((startKg - endKg) / (startKg - targetKg)) * 100)))
      : null;

  return (
    <View>
      <CoachNutritionHero
        score={monthly.adherence_pct}
        title={formatSummaryMonth(summary.period.end_date)}
        subtitle={t("coach.summary.nutrition.monthly.heroSubtitle")}
        statLeft={{ value: weightChange, label: t("coach.summary.nutrition.monthly.weightDelta") }}
        statRight={{ value: `${monthly.adherence_pct}%`, label: t("coach.summary.nutrition.monthly.avgAdherence") }}
      />
      {partialLabel ? <CoachPartialPeriodBanner message={partialLabel} /> : null}
      {emptyMonth ? <CoachPartialPeriodBanner message={emptyMonth} /> : null}
      {pattern ? (
        <CoachInsightNoteFromKey
          noteKey={pattern.key}
          params={pattern.params}
          label={t("coach.summary.nutrition.monthly.patternLabel")}
          variant="coral"
        />
      ) : null}
      {startKg != null && endKg != null ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t("coach.summary.nutrition.monthly.weightTrend")}</Text>
          <View style={styles.weightRow}>
            <Text style={styles.weightLabel}>{t("coach.summary.nutrition.monthly.start")}</Text>
            <Text style={styles.weightValue}>{startKg} kg</Text>
            <Text style={styles.weightArrow}>→</Text>
            <Text style={[styles.weightValue, styles.weightNow]}>{endKg} kg</Text>
          </View>
          {targetKg != null ? (
            <>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${progressPct ?? 0}%` }]} />
              </View>
              <Text style={styles.pacing}>
                {monthly.pacing_key
                  ? t(`coach.summary.nutrition.monthly.pacing.${monthly.pacing_key}`, {
                      target: targetKg,
                      defaultValue: t("coach.summary.nutrition.monthly.pacingDefault", { target: targetKg }),
                    })
                  : t("coach.summary.nutrition.monthly.pacingDefault", { target: targetKg })}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
      {monthly.mom?.comparable ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t("coach.summary.nutrition.monthly.momLabel")}</Text>
          <MomRow
            label={t("coach.summary.nutrition.monthly.momAdherence")}
            prev={`${monthly.mom.adherence_pct}%`}
            curr={`${monthly.adherence_pct}%`}
            up={monthly.mom.adherence_pct_delta >= 0}
          />
          <MomRow
            label={t("coach.summary.nutrition.monthly.momProtein")}
            prev={`${Math.round(monthly.mom.avg_protein_g)}g`}
            curr={`${Math.round(monthly.avg_protein_g)}g`}
            up={monthly.mom.avg_protein_g_delta >= 0}
          />
          <MomRow
            label={t("coach.summary.nutrition.monthly.momDaysLogged")}
            prev={String(monthly.mom.days_logged)}
            curr={String(monthly.days_logged)}
            up={monthly.mom.days_logged_delta >= 0}
          />
        </View>
      ) : null}
      {biggestWin ? (
        <View style={[styles.banner, styles.winBanner]}>
          <Text style={styles.bannerLabel}>{t("coach.summary.nutrition.monthly.biggestWin")}</Text>
          <Text style={styles.bannerBody}>{t(biggestWin.key, biggestWin.params)}</Text>
        </View>
      ) : null}
      {nextMonth ? (
        <View style={[styles.banner, styles.nextBanner]}>
          <Text style={[styles.bannerLabel, styles.nextLabel]}>{t("coach.summary.nutrition.monthly.nextMonth")}</Text>
          <Text style={styles.bannerBody}>{t(nextMonth.key, nextMonth.params)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function MomRow({ label, prev, curr, up }: { label: string; prev: string; curr: string; up: boolean }) {
  return (
    <View style={styles.momRow}>
      <Text style={styles.momLabel}>{label}</Text>
      <Text style={styles.momPrev}>{prev}</Text>
      <Text style={styles.momArrow}>→</Text>
      <Text style={[styles.momCurr, up ? styles.up : styles.down]}>{curr}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  partial: { color: MUTED, fontSize: 11, fontWeight: "700", marginBottom: 10, marginTop: -4 },
  card: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, marginBottom: 12 },
  sectionLabel: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 12 },
  weightRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  weightLabel: { color: MUTED, fontSize: 11, fontWeight: "700" },
  weightValue: { color: TEXT, fontSize: 14, fontWeight: "900" },
  weightNow: { color: GREEN },
  weightArrow: { color: MUTED, fontSize: 12 },
  track: { height: 8, borderRadius: 99, backgroundColor: TRACK, overflow: "hidden", marginTop: 12 },
  fill: { height: "100%", backgroundColor: GREEN, borderRadius: 99 },
  pacing: { color: MUTED, fontSize: 11, marginTop: 8, lineHeight: 16 },
  momRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  momLabel: { flex: 1, color: TEXT, fontSize: 12, fontWeight: "700" },
  momPrev: { color: MUTED, fontSize: 12, fontWeight: "700" },
  momArrow: { color: MUTED, fontSize: 11 },
  momCurr: { fontSize: 12, fontWeight: "900" },
  up: { color: GREEN },
  down: { color: "#D85A30" },
  banner: { borderRadius: 14, padding: 14, marginBottom: 10 },
  winBanner: { backgroundColor: AMBER_LIGHT },
  nextBanner: { backgroundColor: "#E8F5EE" },
  bannerLabel: { color: AMBER, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 6 },
  nextLabel: { color: GREEN },
  bannerBody: { color: TEXT, fontSize: 12, lineHeight: 18 },
});
