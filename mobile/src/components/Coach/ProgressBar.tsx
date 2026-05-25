import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../theme";

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const { colors } = useAppTheme();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <View style={styles.wrap}>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={[styles.pct, { color: colors.muted }]}>{pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  track: {
    height: 10,
    flex: 1,
    borderRadius: 99,
    overflow: "hidden",
  },
  fill: { height: 10, backgroundColor: "#639922", borderRadius: 99 },
  pct: { fontSize: 12, fontWeight: "600", width: 40, textAlign: "right" },
});
