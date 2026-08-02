import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { MuscleGroup } from "../../types/workoutCoach";
import { MUSCLE_STATUS_CONFIG, WC_COLORS } from "../../constants/workoutCoach";

function MuscleCard({ muscle }: { muscle: MuscleGroup }) {
  const { t } = useTranslation();
  const cfg = MUSCLE_STATUS_CONFIG[muscle.status];
  return (
    <View style={[styles.muscleCard, { borderLeftColor: cfg.barColor }]}>
      <View style={styles.cardTop}>
        <Text style={styles.muscleName}>{muscle.name}</Text>
        <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      <Text style={styles.lastTrained}>{t("coach.components.last", { date: muscle.lastTrainedLabel })}</Text>
    </View>
  );
}

export default function MuscleRecoveryMap({ muscles }: { muscles: MuscleGroup[] }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text style={styles.sectionLabel}>{t("coach.components.muscleRecoveryMap")}</Text>
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
    color: WC_COLORS.MUTED,
    marginBottom: 10,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muscleCard: {
    width: "48%",
    backgroundColor: WC_COLORS.WHITE,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: WC_COLORS.BORDER,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7, gap: 6 },
  muscleName: { flex: 1, fontSize: 13, fontWeight: "700", color: WC_COLORS.TEXT },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  badgeText: { fontSize: 10, fontWeight: "600" },
  lastTrained: { fontSize: 10, color: WC_COLORS.MUTED },
});
