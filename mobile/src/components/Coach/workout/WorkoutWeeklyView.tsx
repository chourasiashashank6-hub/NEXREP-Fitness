import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CoachSummaryResponse } from "../../../types/coachSummary";
import { isWorkoutSummary } from "../../../types/coachSummary";
import type { VolumeEntry } from "../../../types/workoutCoach";
import { WC_COLORS } from "../../../constants/workoutCoach";
import WeeklyVolumeLoad from "../WeeklyVolumeLoad";
import { WeeklyProgressBar } from "../WeeklyProgressBar";
import { CoachPartialPeriodBanner } from "../shared/CoachPartialPeriodBanner";
import { CoachInsightNoteFromKey } from "../shared/CoachInsightNote";
import { CoachNutritionHero } from "../shared/CoachNutritionHero";
import { formatSummaryWeekday } from "../../../utils/coachSummaryFormat";

const PALETTE = ["#4ADE80", "#FBBF24", "#A78BFA", "#60A5FA", "#F87171", "#2DD4BF"];

type Props = {
  summary: CoachSummaryResponse;
};

export function WorkoutWeeklyView({ summary }: Props) {
  const { t } = useTranslation();
  const weekly = summary.weekly;

  const volumes: VolumeEntry[] = useMemo(() => {
    if (!weekly || !("volume_by_muscle" in weekly)) return [];
    return weekly.volume_by_muscle.map((v, idx) => ({
      muscle: v.muscle,
      sets: v.sets,
      targetSets: v.target_sets,
      color: PALETTE[idx % PALETTE.length],
    }));
  }, [weekly]);

  if (!weekly || !isWorkoutSummary(summary) || !("hero_label_key" in weekly)) return null;

  const whatChanged = summary.notes?.find((n) => n.kind === "what_changed");
  const undertrained = summary.notes?.find((n) => n.kind === "undertrained");
  const adjustNext = summary.notes?.find((n) => n.kind === "adjust_next_week");

  const partialMessage =
    weekly.sessions === 0
      ? t("coach.summary.partial.noWorkoutsWeek")
      : summary.period.label_partial
        ? t("coach.summary.partial.trainingDaysSoFar", {
            count: weekly.sessions,
            total: summary.period.days_in_period,
          })
        : null;

  return (
    <View>
      <CoachNutritionHero
        accentColor={WC_COLORS.PURPLE_MID}
        score={weekly.week_score}
        title={t(weekly.hero_label_key)}
        subtitle={t("coach.summary.workout.weekly.heroSubtitle")}
        statLeft={{ value: String(weekly.sessions), label: t("coach.summary.workout.weekly.sessions") }}
        statRight={{ value: `${weekly.weekly_percent}%`, label: t("coach.workout.weekly") }}
      />
      {partialMessage ? <CoachPartialPeriodBanner message={partialMessage} /> : null}
      <WeeklyProgressBar
        completed={weekly.completed_sets}
        target={weekly.target_sets}
        percent={weekly.weekly_percent}
        insight={t("coach.summary.workout.weekly.progressInsight", { percent: weekly.weekly_percent })}
      />
      {whatChanged ? (
        <CoachInsightNoteFromKey
          noteKey={whatChanged.key}
          params={whatChanged.params}
          label={t("coach.summary.workout.weekly.whatChangedLabel")}
          variant="purple"
        />
      ) : null}
      <View style={styles.section}>
        <WeeklyVolumeLoad volumes={volumes} />
      </View>
      {undertrained ? (
        <CoachInsightNoteFromKey
          noteKey={undertrained.key}
          params={undertrained.params}
          label={t("coach.summary.workout.weekly.undertrainedLabel")}
          variant="coral"
        />
      ) : null}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>{t("coach.summary.workout.weekly.consistency")}</Text>
        <View style={styles.strip}>
          {weekly.consistency.map((row) => (
            <View key={row.date} style={styles.stripCol}>
              <View style={[styles.stripDot, row.trained ? styles.stripDotOn : styles.stripDotOff]} />
              <Text style={styles.stripDay}>{formatSummaryWeekday(row.date)}</Text>
            </View>
          ))}
        </View>
      </View>
      {adjustNext ? (
        <CoachInsightNoteFromKey
          noteKey={adjustNext.key}
          params={adjustNext.params}
          label={t("coach.summary.workout.weekly.adjustNextLabel")}
          variant="green"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 12 },
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
  strip: { flexDirection: "row", justifyContent: "space-between" },
  stripCol: { alignItems: "center", gap: 6, flex: 1 },
  stripDot: { width: 10, height: 10, borderRadius: 99 },
  stripDotOn: { backgroundColor: WC_COLORS.PURPLE_MID },
  stripDotOff: { backgroundColor: WC_COLORS.TRACK },
  stripDay: { color: WC_COLORS.MUTED, fontSize: 9, fontWeight: "700" },
});
