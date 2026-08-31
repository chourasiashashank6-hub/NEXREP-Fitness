import { StyleSheet, Text, View } from "react-native";
import { BG, BORDER } from "../../../theme/colors";

const MUTED = "#BBBBBB";
type Props = {
  message: string;
};

/** Honest partial-period label — used when history is shorter than the cadence window. */
export function CoachPartialPeriodBanner({ message }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    marginTop: -4,
  },
  text: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
});
