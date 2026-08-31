import { Pressable, StyleSheet, Text, View } from "react-native";
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
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: BG,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  cardSelected: { borderColor: GREEN, backgroundColor: GREEN_LIGHT },
  title: { color: TEXT, fontSize: 15, fontWeight: "800" },
  titleSelected: { color: GREEN },
  desc: { marginTop: 3, color: MUTED, fontSize: 13 },
});
