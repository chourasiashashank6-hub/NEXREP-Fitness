import { StyleSheet, Text, View } from "react-native";
import type { MacroStatus } from "../../types/coach";
import { useAppTheme } from "../../theme";

const STATUS_COLORS: Record<MacroStatus, { badge: string; bar: string }> = {
  low: { badge: "#FCA5A5", bar: "#EF4444" },
  on_track: { badge: "#86EFAC", bar: "#22C55E" },
  high: { badge: "#FCD34D", bar: "#F59E0B" },
};

const STATUS_LABELS: Record<MacroStatus, string> = {
  low: "Low",
  on_track: "On track",
  high: "High",
};

type Props = {
  name: string;
  consumed: number;
  target: number;
  status: MacroStatus;
  tip: string;
};

export function MacroCard({ name, consumed, target, status, tip }: Props) {
  const { colors, radius } = useAppTheme();
  const pct = target > 0 ? Math.min(1, consumed / target) : 0;
  const tone = STATUS_COLORS[status] ?? STATUS_COLORS.on_track;

  return (
    <View style={[styles.card, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
      <Text style={[styles.values, { color: colors.muted }]}>
        {Math.round(consumed)}g / {Math.round(target)}g
      </Text>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: tone.bar }]} />
      </View>
      <View style={[styles.badge, { backgroundColor: `${tone.badge}33` }]}>
        <Text style={[styles.badgeText, { color: tone.badge }]}>{STATUS_LABELS[status]}</Text>
      </View>
      <Text style={[styles.tip, { color: colors.muted }]} numberOfLines={3}>
        {tip}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 100, borderWidth: 1, padding: 10 },
  name: { fontSize: 12, fontWeight: "700" },
  values: { fontSize: 10, marginTop: 2 },
  track: { height: 4, borderRadius: 99, marginTop: 8, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 99 },
  badge: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  tip: { fontSize: 10, marginTop: 6, lineHeight: 14 },
});
