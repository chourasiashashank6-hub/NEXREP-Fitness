import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../theme";

export function StreakRow({
  days,
  streak,
}: {
  days: Array<{ day: string; state: "done" | "missed" | "today" }>;
  streak: number;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.wrap}>
      <View>
        <Text style={[styles.label, { color: colors.muted }]}>Weekly streak</Text>
        <Text style={[styles.sub, { color: colors.text }]}>{streak} days</Text>
      </View>
      <View style={styles.daysRow}>
        {days.map((d) => (
          <View key={d.day} style={styles.dayItem}>
            <Text style={[styles.dayLabel, { color: colors.muted }]}>{d.day}</Text>
            <View
              style={[
                styles.pill,
                d.state === "done" ? styles.done : d.state === "today" ? styles.today : styles.missed,
              ]}
            >
              <Text style={styles.pillText}>{d.state === "done" ? "✓" : d.state === "today" ? "●" : "-"}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  label: { fontSize: 12 },
  sub: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  daysRow: { flexDirection: "row", gap: 6 },
  dayItem: { alignItems: "center" },
  dayLabel: { fontSize: 10, marginBottom: 4 },
  pill: { width: 18, height: 18, borderRadius: 99, alignItems: "center", justifyContent: "center" },
  done: { backgroundColor: "#639922" },
  today: { backgroundColor: "#3B6D11" },
  missed: { backgroundColor: "#D8D8D8" },
  pillText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
