import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../theme";

type FilterValue = "all" | "water" | "food" | "log" | "move";

const items: Array<{ key: FilterValue; label: string }> = [
  { key: "all", label: "All" },
  { key: "water", label: "Water" },
  { key: "food", label: "Food" },
  { key: "log", label: "Log" },
  { key: "move", label: "Move" },
];

export function FilterRow({ value, onChange }: { value: FilterValue; onChange: (v: FilterValue) => void }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <Pressable
            key={it.key}
            style={[styles.btn, active ? [styles.active, { backgroundColor: colors.text }] : [styles.inactive, { backgroundColor: colors.cardAlt, borderColor: colors.border }]]}
            onPress={() => onChange(it.key)}
          >
            <Text style={[styles.txt, active ? [styles.activeTxt, { color: colors.background }] : [styles.inactiveTxt, { color: colors.muted }]]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 10, flexWrap: "wrap" },
  btn: { minHeight: 44, borderRadius: 99, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  active: {},
  inactive: { borderWidth: 1 },
  txt: { fontSize: 12, fontWeight: "600" },
  activeTxt: {},
  inactiveTxt: {},
});
