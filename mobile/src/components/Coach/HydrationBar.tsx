import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../theme";

type Props = {
  currentMl: number;
  targetMl: number;
  nextAction: string;
  onQuickAdd: (ml: number) => void;
  loading?: boolean;
};

export function HydrationBar({ currentMl, targetMl, nextAction, onQuickAdd, loading }: Props) {
  const { t } = useTranslation();
  const { colors, radius } = useAppTheme();
  const pct = targetMl > 0 ? Math.min(1, currentMl / targetMl) : 0;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[styles.header, { color: "#22d3ee" }]}>{t("coach.components.hydration")}</Text>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={[styles.stats, { color: colors.text }]}>
        {currentMl} / {targetMl} ml
      </Text>
      <Text style={[styles.action, { color: colors.muted }]}>{nextAction}</Text>
      <View style={styles.row}>
        {[250, 500, 750].map((ml) => (
          <Pressable
            key={ml}
            style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.card }]}
            disabled={loading}
            onPress={() => onQuickAdd(ml)}
          >
            {loading ? <ActivityIndicator size="small" /> : <Text style={[styles.btnText, { color: colors.text }]}>+{ml}ml</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, padding: 14, marginTop: 4 },
  header: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 10 },
  track: { height: 8, borderRadius: 99, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: "#38BDF8", borderRadius: 99 },
  stats: { fontSize: 13, fontWeight: "600", marginTop: 8 },
  action: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  row: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 12, fontWeight: "600" },
});
