import { StyleSheet, Text, View } from "react-native";
import { formatSummaryWeekday } from "../../../utils/coachSummaryFormat";
import { useTranslation } from "react-i18next";
import type { CoachSummaryResponse } from "../../../types/coachSummary";
import { CoachInsightNoteFromKey } from "../shared/CoachInsightNote";
import { CoachNutritionHero } from "../shared/CoachNutritionHero";
import { CoachPartialPeriodBanner } from "../shared/CoachPartialPeriodBanner";
import { MacroBreakdownSection } from "../shared/MacroBreakdownSection";
import { GREEN, TEXT, BORDER, WHITE } from "../../../theme/colors";

const ORANGE = "#D85A30";
const TRACK = "#E5E4E0";
const MUTED = "#BBBBBB";
const BLUE = "#38BDF8";

type Props = {
  summary: CoachSummaryResponse;
};

function barColor(pct: number, onTarget: boolean) {
  if (!pct) return TRACK;
  if (onTarget) return GREEN;
  if (pct >= 85) return "#F59E0B";
  return ORANGE;
}

export function CalorieWeeklyView({ summary }: Props) {
  const { t } = useTranslation();
  const weekly = summary.weekly;
  if (!weekly) return null;

  const partialMessage =
    weekly.days_logged === 0
      ? t("coach.summary.partial.noDaysLoggedWeek")
      : summary.period.label_partial
        ? t("coach.summary.nutrition.weekly.partialDays", { count: weekly.days_logged, total: weekly.days_total })
        : null;

  const whatChanged = summary.notes?.find((n) => n.kind === "what_changed");
  const fixNext = summary.notes?.find((n) => n.kind === "fix_next_week");

  const macroStatuses = {
    protein:
      weekly.avg_protein_g >= summary.targets.target_protein_g * 0.8
        ? weekly.avg_protein_g > summary.targets.target_protein_g * 1.15
          ? ("high" as const)
          : ("on_track" as const)
        : ("low" as const),
    carbs:
      weekly.avg_carbs_g >= summary.targets.target_carbs_g * 0.8
        ? weekly.avg_carbs_g > summary.targets.target_carbs_g * 1.15
          ? ("high" as const)
          : ("on_track" as const)
        : ("low" as const),
    fat:
      weekly.avg_fat_g >= summary.targets.target_fat_g * 0.8
        ? weekly.avg_fat_g > summary.targets.target_fat_g * 1.15
          ? ("high" as const)
          : ("on_track" as const)
        : ("low" as const),
  };

  return (
    <View>
      <CoachNutritionHero
        score={weekly.week_score}
        title={t(weekly.hero_label_key ?? "coach.summary.nutrition.weekly.heroTitle")}
        subtitle={t("coach.summary.nutrition.weekly.heroSubtitle")}
        statLeft={{
          value: `${weekly.days_on_target}/${weekly.days_total}`,
          label: t("coach.summary.nutrition.weekly.daysOnTarget"),
        }}
        statRight={{ value: `${weekly.adherence_pct}%`, label: t("coach.summary.nutrition.weekly.adherence") }}
      />
      {partialMessage ? <CoachPartialPeriodBanner message={partialMessage} /> : null}
      {whatChanged ? (
        <CoachInsightNoteFromKey
          noteKey={whatChanged.key}
          params={whatChanged.params}
          label={t("coach.summary.nutrition.weekly.whatChangedLabel")}
          variant="purple"
        />
      ) : null}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>{t("coach.summary.nutrition.weekly.dailyAdherence")}</Text>
        {(summary.daily_breakdown ?? []).map((row) => {
          const pct = row.logged ? Math.min(150, row.adherence_pct) : 0;
          return (
            <View key={row.date} style={styles.barRow}>
              <Text style={styles.barDay}>{formatSummaryWeekday(row.date)}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: barColor(pct, row.on_target) }]} />
              </View>
              <Text style={styles.barPct}>{row.logged ? `${pct}%` : "—"}</Text>
            </View>
          );
        })}
      </View>
      {weekly.days_logged > 0 ? (
        <MacroBreakdownSection
          titleKey="coach.summary.nutrition.weekly.macroAverages"
          values={{ protein: weekly.avg_protein_g, carbs: weekly.avg_carbs_g, fat: weekly.avg_fat_g }}
          targets={{
            protein: summary.targets!.target_protein_g,
            carbs: summary.targets!.target_carbs_g,
            fat: summary.targets!.target_fat_g,
          }}
          statuses={macroStatuses}
        />
      ) : null}
      {weekly.days_logged > 0 && fixNext ? (
        <CoachInsightNoteFromKey
          noteKey={fixNext.key}
          params={fixNext.params}
          label={t("coach.summary.nutrition.weekly.fixNextLabel")}
          variant="green"
        />
      ) : null}
      {weekly.days_logged > 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t("coach.components.hydration")}</Text>
        <View style={styles.hydrationTrack}>
          <View
            style={[
              styles.hydrationFill,
              {
                width: `${Math.min(100, (weekly.avg_water_l / Math.max(summary.targets.target_water_l, 0.1)) * 100)}%`,
              },
            ]}
          />
        </View>
        <Text style={styles.hydrationStats}>
          {t("coach.summary.nutrition.weekly.hydrationAvg", {
            avg: weekly.avg_water_l.toFixed(1),
            target: summary.targets.target_water_l.toFixed(1),
          })}
        </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, marginBottom: 12 },
  sectionLabel: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 12 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  barDay: { width: 32, color: TEXT, fontSize: 11, fontWeight: "800" },
  barTrack: { flex: 1, height: 8, borderRadius: 99, backgroundColor: TRACK, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 99 },
  barPct: { width: 36, textAlign: "right", color: MUTED, fontSize: 10, fontWeight: "800" },
  hydrationTrack: { height: 8, borderRadius: 99, backgroundColor: TRACK, overflow: "hidden" },
  hydrationFill: { height: "100%", backgroundColor: BLUE, borderRadius: 99 },
  hydrationStats: { color: TEXT, fontSize: 12, fontWeight: "700", marginTop: 8 },
});
