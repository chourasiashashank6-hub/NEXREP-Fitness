import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../theme";

type Props = {
  completed: number;
  target: number;
  percent: number;
  insight: string;
};

export function WeeklyProgressBar({ completed, target, percent, insight }: Props) {
  const { colors, radius } = useAppTheme();
  const pct = Math.max(0, Math.min(100, percent));

  return (
    <View style={[styles.wrap, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[styles.header, { color: "#60a5fa" }]}>WEEKLY PROGRESS</Text>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={[styles.stats, { color: colors.text }]}>
        {completed} / {target} sets ({pct}%)
      </Text>
      <Text style={[styles.insight, { color: colors.muted }]}>{insight}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, padding: 14 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 10 },
  track: { height: 8, borderRadius: 99, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: "#60A5FA", borderRadius: 99 },
  stats: { fontSize: 13, fontWeight: "600", marginTop: 8 },
  insight: { fontSize: 12, marginTop: 6, lineHeight: 17 },
});
