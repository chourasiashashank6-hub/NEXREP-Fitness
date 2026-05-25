import { StyleSheet, Text, View } from "react-native";
import type { MuscleGroup } from "../../types/workoutCoach";
import { MUSCLE_STATUS_CONFIG, WC_COLORS } from "../../constants/workoutCoach";

function MuscleCard({ muscle }: { muscle: MuscleGroup }) {
  const cfg = MUSCLE_STATUS_CONFIG[muscle.status];
  return (
    <View style={styles.muscleCard}>
      <View style={styles.cardTop}>
        <Text style={styles.muscleName}>{muscle.name}</Text>
        <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${muscle.recoveryPercent}%`, backgroundColor: cfg.barColor }]} />
      </View>
      <Text style={styles.lastTrained}>Last: {muscle.lastTrainedLabel}</Text>
    </View>
  );
}

export default function MuscleRecoveryMap({ muscles }: { muscles: MuscleGroup[] }) {
  return (
    <View>
      <Text style={styles.sectionLabel}>Muscle recovery map</Text>
      <View style={styles.grid}>
        {muscles.map((m) => (
          <MuscleCard key={m.name} muscle={m} />
        ))}
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  muscleCard: {
    width: "48%",
    backgroundColor: WC_COLORS.cardBg,
    borderWidth: 1,
    borderColor: WC_COLORS.border,
    borderRadius: 10,
    padding: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  muscleName: { fontSize: 12, fontWeight: "700", color: WC_COLORS.textPrimary },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  badgeText: { fontSize: 10, fontWeight: "600" },
  barTrack: {
    height: 4,
    backgroundColor: WC_COLORS.border,
    borderRadius: 99,
    overflow: "hidden",
    marginBottom: 5,
  },
  barFill: { height: "100%", borderRadius: 99 },
  lastTrained: { fontSize: 10, color: WC_COLORS.textTertiary },
});
