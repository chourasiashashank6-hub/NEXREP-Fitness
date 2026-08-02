import { StyleSheet, Text, View } from "react-native";
import type { MealPlanItem } from "../../types/coach";
import { useAppTheme } from "../../theme";

export function MealPlanCard({ meal, items, calories, protein, carbs, fat }: MealPlanItem) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[styles.meal, { color: colors.text }]}>{meal}</Text>
      <Text style={[styles.items, { color: colors.muted }]}>{items}</Text>
      <Text style={[styles.macros, { color: colors.text }]}>
        {calories} kcal · P: {protein}g · C: {carbs}g · F: {fat}g
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 12, marginBottom: 8 },
  meal: { fontSize: 13, fontWeight: "700" },
  items: { fontSize: 12, marginTop: 6, lineHeight: 18 },
  macros: { fontSize: 11, marginTop: 8, fontWeight: "600", opacity: 0.85 },
});
