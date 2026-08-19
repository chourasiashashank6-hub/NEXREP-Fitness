import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import i18n from "../../../i18n";
import type { CoachSummaryMuscleGroup, CoachSummaryResponse, CoachSummaryWorkoutTip } from "../../../types/coachSummary";
import { isWorkoutDay, isWorkoutSummary } from "../../../types/coachSummary";
import type { DynamicCoachingTip, MuscleGroup, VolumeEntry } from "../../../types/workoutCoach";
import { READINESS_FACTOR_COLORS, WC_COLORS } from "../../../constants/workoutCoach";
import CoachingTips from "../CoachingTips";
import MuscleRecoveryMap from "../MuscleRecoveryMap";
import { RecoveryTipCard } from "../RecoveryTipCard";
import { CoachPartialPeriodBanner } from "../shared/CoachPartialPeriodBanner";
import { CoachInsightNoteFromKey } from "../shared/CoachInsightNote";
import { CoachNutritionHero } from "../shared/CoachNutritionHero";

function relativeTrainedLabel(iso: string | null): string {
  if (!iso) return i18n.t("coach.common.notTrainedRecently");
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60)));
  if (hours < 24) return i18n.t("coach.common.today");
  const days = Math.round(hours / 24);
  if (days === 1) return i18n.t("coach.common.yesterday");
  return i18n.t("coach.common.daysAgo", { count: days });
}

function toMuscleGroups(rows: CoachSummaryMuscleGroup[]): MuscleGroup[] {
  return rows.map((m) => ({
    name: m.name,
    status: m.status,
    recoveryPercent: m.recovery_percent,
    lastTrainedLabel: relativeTrainedLabel(m.last_trained_at),
  }));
}

function toCoachingTips(tips: CoachSummaryWorkoutTip[], t: (key: string, params?: Record<string, string | number>) => string): DynamicCoachingTip[] {
  return tips.map((tip) => ({
    icon: tip.icon as DynamicCoachingTip["icon"],
    title: t(tip.key, tip.params),
    body: t(`${tip.key}Body`, tip.params),
    category: tip.category as DynamicCoachingTip["category"],
    priority: tip.priority,
  }));
}

type Props = {
  summary: CoachSummaryResponse;
};

export function WorkoutDailyView({ summary }: Props) {
  const { t } = useTranslation();
  const day = summary.daily;
  const insight = summary.notes?.find((n) => n.kind === "readiness_insight");

  const muscles = useMemo(
    () => (day && isWorkoutDay(day) ? toMuscleGroups(day.muscle_groups) : []),
    [day],
  );
  const tips = useMemo(
    () => (day && isWorkoutDay(day) ? toCoachingTips(day.tips, t) : []),
    [day, t],
  );

  if (!day || !isWorkoutSummary(summary) || !isWorkoutDay(day)) return null;

  const hasHistory = day.muscle_groups.some((m) => m.last_trained_at);

  return (
    <View>
      <CoachNutritionHero
        accentColor={WC_COLORS.PURPLE_MID}
        score={day.readiness_score}
        title={t(day.readiness_label_key)}
        subtitle={t("coach.summary.workout.daily.heroSubtitle")}
        statLeft={{ value: String(day.completed_sets_week), label: t("coach.workout.setsDone") }}
        statRight={{ value: `${day.weekly_percent}%`, label: t("coach.workout.weekly") }}
      />
      {!hasHistory ? <CoachPartialPeriodBanner message={t("coach.summary.partial.noWorkoutsYet")} /> : null}
      {insight ? (
        <CoachInsightNoteFromKey
          noteKey={insight.key}
          params={insight.params}
          label={t("coach.summary.workout.daily.insightLabel")}
          variant="purple"
        />
      ) : null}
      <View style={styles.factorsCard}>
        <Text style={styles.sectionLabel}>{t("coach.components.readinessFactors")}</Text>
        <View style={styles.factors}>
          {day.readiness_factors.map((f, i) => {
            const cfg = READINESS_FACTOR_COLORS[f.type];
            return (
              <View key={`${f.label_key}-${i}`} style={[styles.factor, { backgroundColor: cfg.bg }]}>
                <Text style={[styles.factorText, { color: cfg.color }]}>{t(f.label_key, f.params)}</Text>
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.section}>
        <MuscleRecoveryMap muscles={muscles} />
      </View>
      {tips.length > 0 ? <CoachingTips tips={tips} /> : null}
      <Text style={styles.sectionLabel}>{t("coach.summary.workout.daily.recoveryTitle")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recoveryRow}>
        {day.recovery_cards.map((card) => (
          <RecoveryTipCard
            key={card.title_key}
            icon={card.icon}
            title={t(card.title_key)}
            description={t(card.body_key)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  factorsCard: {
    backgroundColor: WC_COLORS.WHITE,
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  section: { marginBottom: 12 },
  sectionLabel: {
    color: WC_COLORS.MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  factors: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  factor: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  factorText: { fontSize: 10, fontWeight: "700" },
  recoveryRow: { paddingBottom: 8, gap: 0 },
});
