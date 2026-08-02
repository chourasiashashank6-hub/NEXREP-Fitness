import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { WC_COLORS } from "../../constants/workoutCoach";

type Props = {
  completed: number;
  target: number;
  percent: number;
  insight: string;
};

export function WeeklyProgressBar({ completed, target, percent, insight }: Props) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, percent));

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>{t("coach.components.weeklyProgress")}</Text>
        <Text style={styles.percent}>{pct}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.stats}>
          {completed} <Text style={styles.statsMuted}>/ {target} {t("coach.components.sets")}</Text>
        </Text>
        <Text style={styles.insight}>{insight}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: WC_COLORS.BG, borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  header: { color: WC_COLORS.MUTED, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  percent: { color: WC_COLORS.PURPLE, fontSize: 14, fontWeight: "800" },
  track: { height: 8, borderRadius: 99, overflow: "hidden", backgroundColor: WC_COLORS.TRACK },
  fill: { height: "100%", backgroundColor: WC_COLORS.PURPLE, borderRadius: 99 },
  footer: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 9 },
  stats: { color: WC_COLORS.TEXT, fontSize: 12, fontWeight: "800" },
  statsMuted: { color: WC_COLORS.MUTED, fontWeight: "700" },
  insight: { flex: 1, color: WC_COLORS.MUTED, fontSize: 11, lineHeight: 16, textAlign: "right" },
});
