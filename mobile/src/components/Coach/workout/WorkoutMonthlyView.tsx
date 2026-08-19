import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CoachSummaryResponse } from "../../../types/coachSummary";
import { isWorkoutSummary } from "../../../types/coachSummary";
import { WC_COLORS } from "../../../constants/workoutCoach";
import { CoachPartialPeriodBanner } from "../shared/CoachPartialPeriodBanner";
import { CoachInsightNoteFromKey } from "../shared/CoachInsightNote";
import { CoachNutritionHero } from "../shared/CoachNutritionHero";
import { formatSummaryMonth } from "../../../utils/coachSummaryFormat";

type Props = {
  summary: CoachSummaryResponse;
};

export function WorkoutMonthlyView({ summary }: Props) {
  const { t } = useTranslation();
  const monthly = summary.monthly;

  if (!monthly || !isWorkoutSummary(summary) || !("sessions" in monthly)) return null;

  const partialLabel = summary.period.label_partial
    ? t("coach.summary.workout.monthly.partialMonth", { day: summary.period.end_date.slice(-2) })
    : null;
  const emptyMonth = monthly.sessions === 0 ? t("coach.summary.partial.noWorkoutsMonth") : null;

  const pattern = summary.notes?.find((n) => n.kind === "recurring_pattern");
  const plateau = summary.notes?.find((n) => n.kind === "plateau");
  const biggestWin = summary.notes?.find((n) => n.kind === "biggest_win");
  const nextMonth = summary.notes?.find((n) => n.kind === "next_month");

  const maxWeekSets = Math.max(1, ...monthly.volume_by_week.map((w) => w.sets));

  return (
    <View>
      <CoachNutritionHero
        accentColor={WC_COLORS.PURPLE_MID}
        score={monthly.month_score}
        title={formatSummaryMonth(summary.period.end_date)}
        subtitle={t(monthly.hero_label_key)}
        statLeft={{ value: String(monthly.sessions), label: t("coach.summary.workout.monthly.sessions") }}
        statRight={{ value: String(monthly.total_sets), label: t("coach.summary.workout.monthly.totalSets") }}
      />
      {partialLabel ? <CoachPartialPeriodBanner message={partialLabel} /> : null}
      {emptyMonth ? <CoachPartialPeriodBanner message={emptyMonth} /> : null}
      {pattern ? (
        <CoachInsightNoteFromKey
          noteKey={pattern.key}
          params={pattern.params}
          label={t("coach.summary.workout.monthly.patternLabel")}
          variant="coral"
        />
      ) : null}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>{t("coach.summary.workout.monthly.volumeByWeek")}</Text>
        {monthly.volume_by_week.map((row) => (
          <View key={row.week} style={styles.barRow}>
            <Text style={styles.barLabel}>{t("coach.summary.workout.monthly.weekN", { n: row.week })}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.round((row.sets / maxWeekSets) * 100)}%` }]} />
            </View>
            <Text style={styles.barVal}>{row.sets}</Text>
          </View>
        ))}
      </View>
      {monthly.strength_progression.length ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t("coach.summary.workout.monthly.strengthTitle")}</Text>
          {monthly.strength_progression.map((lift) => (
            <View key={lift.label_key} style={styles.liftRow}>
              <Text style={styles.liftName}>{t(lift.label_key)}</Text>
              <Text style={styles.liftVals}>
                {lift.start_kg} kg → {lift.end_kg} kg
              </Text>
              <Text style={[styles.liftDelta, lift.delta_kg >= 0 ? styles.up : styles.down]}>
                {lift.delta_kg >= 0 ? "+" : ""}
                {lift.delta_kg} kg
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {plateau ? (
        <CoachInsightNoteFromKey
          noteKey={plateau.key}
          params={{ lift: t(String(plateau.params?.liftKey ?? "")) }}
          label={t("coach.summary.workout.monthly.plateauLabel")}
          variant="purple"
        />
      ) : null}
      {biggestWin ? (
        <View style={[styles.banner, styles.winBanner]}>
          <Text style={styles.bannerLabel}>{t("coach.summary.workout.monthly.biggestWin")}</Text>
          <Text style={styles.bannerBody}>
            {t(biggestWin.key, {
              ...biggestWin.params,
              lift: t(String(biggestWin.params?.liftKey ?? "")),
            })}
          </Text>
        </View>
      ) : null}
      {nextMonth ? (
        <View style={[styles.banner, styles.nextBanner]}>
          <Text style={[styles.bannerLabel, styles.nextLabel]}>{t("coach.summary.workout.monthly.nextMonthLabel")}</Text>
          <Text style={styles.bannerBody}>{t(nextMonth.key, nextMonth.params)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  partial: { color: WC_COLORS.MUTED, fontSize: 11, fontWeight: "700", marginBottom: 10, marginTop: -4 },
  card: {
    backgroundColor: WC_COLORS.WHITE,
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  sectionLabel: {
    color: WC_COLORS.MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  barLabel: { width: 52, color: WC_COLORS.TEXT, fontSize: 11, fontWeight: "800" },
  barTrack: { flex: 1, height: 8, borderRadius: 99, backgroundColor: WC_COLORS.TRACK, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: WC_COLORS.PURPLE_MID, borderRadius: 99 },
  barVal: { width: 28, textAlign: "right", color: WC_COLORS.MUTED, fontSize: 10, fontWeight: "800" },
  liftRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  liftName: { flex: 1, color: WC_COLORS.TEXT, fontSize: 12, fontWeight: "800" },
  liftVals: { color: WC_COLORS.MUTED, fontSize: 11, fontWeight: "700" },
  liftDelta: { fontSize: 11, fontWeight: "900" },
  up: { color: WC_COLORS.GREEN },
  down: { color: WC_COLORS.ORANGE },
  banner: { borderRadius: 14, padding: 14, marginBottom: 10 },
  winBanner: { backgroundColor: WC_COLORS.PURPLE_LIGHT },
  nextBanner: { backgroundColor: WC_COLORS.GREEN_LIGHT },
  bannerLabel: { color: WC_COLORS.PURPLE_MID, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 6 },
  nextLabel: { color: WC_COLORS.GREEN },
  bannerBody: { color: WC_COLORS.TEXT, fontSize: 12, lineHeight: 18 },
});
