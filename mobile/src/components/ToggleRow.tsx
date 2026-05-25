import { StyleSheet, Switch, Text, View } from "react-native";
import { ONBOARDING_COLORS } from "../constants/onboarding";

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
    <Switch value={value} onValueChange={onChange} trackColor={{ true: ONBOARDING_COLORS.primary }} />
  </View>
);

const styles = StyleSheet.create({
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ONBOARDING_COLORS.border,
    backgroundColor: ONBOARDING_COLORS.card,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: { color: ONBOARDING_COLORS.textPrimary, fontSize: 16, fontWeight: "700" },
  sub: { marginTop: 4, color: ONBOARDING_COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
});
