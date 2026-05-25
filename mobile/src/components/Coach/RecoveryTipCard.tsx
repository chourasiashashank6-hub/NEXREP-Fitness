import { StyleSheet, Text, View } from "react-native";
import type { RecoveryTip, RecoveryTipIcon } from "../../types/workoutCoach";
import { useAppTheme } from "../../theme";

const ICON_LABEL: Record<RecoveryTipIcon, string> = {
  sleep: "Sleep",
  water: "Hydrate",
  stretch: "Stretch",
  food: "Fuel",
  rest: "Rest",
};

export function RecoveryTipCard({ icon, title, description }: RecoveryTip) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[styles.iconLabel, { color: "#34d399" }]}>{ICON_LABEL[icon] ?? "Tip"}</Text>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.desc, { color: colors.muted }]} numberOfLines={3}>
        {description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 160, borderWidth: 1, padding: 12, marginRight: 10 },
  iconLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  title: { fontSize: 13, fontWeight: "700", marginTop: 6 },
  desc: { fontSize: 11, marginTop: 6, lineHeight: 16 },
});
