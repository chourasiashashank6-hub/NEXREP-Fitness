import { Pressable, StyleSheet, Text, View } from "react-native";
import { ONBOARDING_COLORS } from "../constants/onboarding";

export const MultiChips = ({
  options,
  values,
  onChange,
}: {
  options: string[];
  values: string[];
  onChange: (next: string[]) => void;
}) => (
  <View style={styles.wrap}>
    {options.map((option) => {
      const selected = values.includes(option);
      return (
        <Pressable
          key={option}
          style={[styles.chip, selected ? styles.chipSelected : null]}
          onPress={() => onChange(selected ? values.filter((v) => v !== option) : [...values, option])}
        >
          <Text style={[styles.label, selected ? styles.labelSelected : null]}>{option}</Text>
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: ONBOARDING_COLORS.card,
    borderColor: ONBOARDING_COLORS.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: "#1E1B3A", borderColor: ONBOARDING_COLORS.primary },
  label: { color: ONBOARDING_COLORS.textPrimary, fontSize: 13 },
  labelSelected: { color: ONBOARDING_COLORS.primary },
});
