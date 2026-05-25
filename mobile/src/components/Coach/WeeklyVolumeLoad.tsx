import { StyleSheet, Text, View } from "react-native";
import type { VolumeEntry } from "../../types/workoutCoach";
import { WC_COLORS } from "../../constants/workoutCoach";

export default function WeeklyVolumeLoad({ volumes }: { volumes: VolumeEntry[] }) {
  return (
    <View>
      <Text style={styles.sectionLabel}>Weekly volume load</Text>
      <View style={styles.bars}>
        {volumes.map((v) => {
          const pct = Math.min(Math.round((v.sets / Math.max(1, v.targetSets)) * 100), 100);
          return (
            <View key={v.muscle} style={styles.row}>
              <Text style={styles.label}>{v.muscle}</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct}%`, backgroundColor: v.color }]} />
              </View>
              <Text style={styles.val}>{v.sets} sets</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: WC_COLORS.textTertiary,
    marginBottom: 8,
  },
  bars: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 11, color: WC_COLORS.textSecondary, width: 72 },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: WC_COLORS.border,
    borderRadius: 99,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 99 },
  val: { fontSize: 11, fontWeight: "700", color: WC_COLORS.textPrimary, width: 48, textAlign: "right" },
});
