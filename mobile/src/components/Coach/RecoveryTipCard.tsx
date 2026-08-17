import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RecoveryTip, RecoveryTipIcon } from "../../types/workoutCoach";
import { WC_COLORS } from "../../constants/workoutCoach";

const TIP_META: Record<RecoveryTipIcon, { label: string; bg: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  sleep: { label: "Sleep", bg: WC_COLORS.PURPLE_LIGHT, color: WC_COLORS.PURPLE_MID, icon: "moon-outline" },
  water: { label: "Hydrate", bg: WC_COLORS.BLUE_LIGHT, color: WC_COLORS.BLUE, icon: "water-outline" },
  stretch: { label: "Stretch", bg: WC_COLORS.GREEN_LIGHT, color: WC_COLORS.GREEN, icon: "body-outline" },
  food: { label: "Fuel", bg: WC_COLORS.BG, color: WC_COLORS.MUTED, icon: "heart-outline" },
  rest: { label: "Rest", bg: WC_COLORS.BG, color: WC_COLORS.MUTED, icon: "heart-outline" },
};

export function RecoveryTipCard({ icon, title, description }: RecoveryTip) {
  const meta = TIP_META[icon] ?? TIP_META.rest;
  return (
    <View style={styles.card}>
      <View style={[styles.iconTile, { backgroundColor: meta.bg }]}>
        <Ionicons name={meta.icon} size={18} color={meta.color} />
      </View>
      <Text style={[styles.iconLabel, { color: meta.color }]}>{meta.label}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.desc}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 208,
    backgroundColor: WC_COLORS.WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
    padding: 12,
    marginRight: 10,
  },
  iconTile: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  iconLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  title: { color: WC_COLORS.TEXT, fontSize: 12, fontWeight: "700", marginTop: 6 },
  desc: { color: "#777777", fontSize: 10, marginTop: 6, lineHeight: 15 },
});
