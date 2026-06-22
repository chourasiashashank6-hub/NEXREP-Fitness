import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { VolumeEntry } from "../../types/workoutCoach";
import { WC_COLORS } from "../../constants/workoutCoach";

export default function WeeklyVolumeLoad({ volumes }: { volumes: VolumeEntry[] }) {
  const { t } = useTranslation();
  const maxSets = Math.max(1, ...volumes.map((v) => v.targetSets || v.sets || 0));
  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>{t("coach.components.weeklyVolumeLoad")}</Text>
      <View style={styles.bars}>
        {volumes.map((v) => {
          const pct = Math.min(Math.round((v.sets / maxSets) * 100), 100);
          const barColor = v.sets === 0 ? WC_COLORS.TRACK : v.sets >= 15 ? WC_COLORS.ORANGE : v.sets >= 8 ? WC_COLORS.BLUE : WC_COLORS.PURPLE_MID;
          const countColor = v.sets === 0 ? WC_COLORS.MUTED : barColor;
          return (
            <View key={v.muscle} style={styles.row}>
              <Text style={styles.label}>{v.muscle}</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct}%`, backgroundColor: barColor }]} />
              </View>
              <Text style={[styles.val, { color: countColor }]}>{v.sets} {t("coach.components.sets")}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: WC_COLORS.BG,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: WC_COLORS.MUTED,
    marginBottom: 12,
  },
  bars: {},
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  label: { fontSize: 11, fontWeight: "700", color: WC_COLORS.TEXT, width: 70 },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: WC_COLORS.TRACK,
    borderRadius: 99,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 99 },
  val: { fontSize: 11, fontWeight: "700", width: 40, textAlign: "right" },
});
