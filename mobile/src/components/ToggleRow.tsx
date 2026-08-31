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

export const ToggleRow = ({
  label,
  subLabel,
  value,
  onChange,
}: {
  label: string;
  subLabel?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) => (
  <View style={styles.row}>
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      {subLabel ? <Text style={styles.sub}>{subLabel}</Text> : null}
    </View>
    <Pressable style={[styles.toggleTrack, value ? styles.toggleTrackOn : styles.toggleTrackOff]} onPress={() => onChange(!value)}>
      <View style={[styles.toggleKnob, value ? styles.toggleKnobOn : styles.toggleKnobOff]} />
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  row: {
    borderRadius: 14,
    backgroundColor: BG,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: { color: TEXT, fontSize: 15, fontWeight: "800" },
  sub: { marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 99,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: { backgroundColor: GREEN },
  toggleTrackOff: { backgroundColor: TRACK },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: WHITE },
  toggleKnobOn: { alignSelf: "flex-end" },
  toggleKnobOff: { alignSelf: "flex-start" },
});
