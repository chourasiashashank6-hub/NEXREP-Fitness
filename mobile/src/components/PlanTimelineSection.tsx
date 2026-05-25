import { StyleSheet, Text, View } from "react-native";
import { useSubscriptionStore } from "../store/subscriptionStore";
import type { PlanHistoryEntry } from "../types/subscription";
import { formatDate } from "../utils/dateFormat";

function reasonLabel(reason: PlanHistoryEntry["reason"]): string {
  const map: Record<PlanHistoryEntry["reason"], string> = {
    initial: "Started",
    upgrade: "Upgraded",
    downgrade: "Downgraded",
    renewal: "Renewed",
    cancelled: "Cancelled",
    expired: "Expired",
  };
  return map[reason] ?? reason;
}

export default function PlanTimelineSection() {
  const planHistory = useSubscriptionStore((s) => s.planHistory);

  if (planHistory.length <= 1) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Plan timeline</Text>
      {planHistory.map((entry, i) => (
        <View key={`${entry.tier}-${entry.startDate}-${i}`} style={styles.timelineRow}>
          <View style={styles.timelineLeft}>
            <View style={[styles.timelineDot, !entry.endDate && styles.timelineDotActive]} />
            {i < planHistory.length - 1 ? <View style={styles.timelineLine} /> : null}
          </View>
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTier}>
              {entry.tier} Plan{!entry.endDate ? "  (current)" : ""}
            </Text>
            <Text style={styles.timelineDate}>
              {reasonLabel(entry.reason)} · {formatDate(entry.startDate)}
              {entry.endDate ? ` → ${formatDate(entry.endDate)}` : ""}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 12 },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "rgba(226,232,228,0.35)",
    marginBottom: 8,
    fontWeight: "500",
  },
  timelineRow: { flexDirection: "row", marginBottom: 4 },
  timelineLeft: { alignItems: "center", width: 24, marginRight: 12 },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(226,232,228,0.2)",
    borderWidth: 1,
    borderColor: "rgba(226,232,228,0.3)",
  },
  timelineDotActive: { backgroundColor: "#2ECC9A", borderColor: "#2ECC9A" },
  timelineLine: { width: 1, flex: 1, minHeight: 24, backgroundColor: "rgba(255,255,255,0.07)", marginVertical: 3 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineTier: { fontSize: 13, color: "#e2e8e4", fontWeight: "500" },
  timelineDate: { fontSize: 12, color: "rgba(226,232,228,0.4)", marginTop: 2 },
});
