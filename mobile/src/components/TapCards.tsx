import { Pressable, StyleSheet, Text, View } from "react-native";
import { ONBOARDING_COLORS } from "../constants/onboarding";

export const TapCards = ({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string; description?: string }>;
  value: string | null;
  onChange: (v: string) => void;
}) => (
  <View style={styles.wrap}>
    {options.map((option) => {
      const selected = option.value === value;
      return (
        <Pressable key={option.value} style={[styles.card, selected ? styles.cardSelected : null]} onPress={() => onChange(option.value)}>
          <Text style={[styles.title, selected ? styles.titleSelected : null]}>{option.label}</Text>
          {option.description ? <Text style={styles.desc}>{option.description}</Text> : null}
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ONBOARDING_COLORS.border,
    backgroundColor: ONBOARDING_COLORS.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardSelected: { borderColor: ONBOARDING_COLORS.primary, backgroundColor: "#1E1B3A" },
  title: { color: ONBOARDING_COLORS.textPrimary, fontSize: 15, fontWeight: "700" },
  titleSelected: { color: ONBOARDING_COLORS.primary },
  desc: { marginTop: 3, color: ONBOARDING_COLORS.textSecondary, fontSize: 13 },
});
