import { Pressable, StyleSheet, Text, View } from "react-native";
import { logicalRow } from "../utils/rtl";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../theme/colors";

const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GOLD = "#FFD700";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const SCREEN_BG = WHITE;

export const MultiChips = ({
  options,
  values,
  onChange,
}: {
  options: Array<string | { value: string; label: string }>;
  values: string[];
  onChange: (next: string[]) => void;
}) => (
  <View style={styles.wrap}>
    {options.map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;
      const selected = values.includes(value);
      return (
        <Pressable
          key={value}
          style={[styles.chip, selected ? styles.chipSelected : null]}
          onPress={() => onChange(selected ? values.filter((v) => v !== value) : [...values, value])}
        >
          <Text style={[styles.label, selected ? styles.labelSelected : null]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.78}>
            {label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  wrap: { flexDirection: logicalRow, flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: BG,
    borderColor: "transparent",
    borderWidth: 1.5,
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  chipSelected: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  label: { color: MUTED, fontSize: 13, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  labelSelected: { color: GREEN, fontWeight: "800" },
});
