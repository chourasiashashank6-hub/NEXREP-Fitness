import { StyleSheet, Text, View } from "react-native";
import type { PasswordPolicyChecks } from "../utils/passwordPolicy";
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN, analyzePasswordPolicy } from "../utils/passwordPolicy";
import { useAppTheme } from "../theme";

type Props = { password: string };

const Row = ({
  met,
  label,
  mutedColor,
  okColor,
}: {
  met: boolean;
  label: string;
  mutedColor: string;
  okColor: string;
}) => (
  <View style={styles.row}>
    <Text style={[styles.bullet, { color: met ? okColor : mutedColor }]}>{met ? "✓" : "○"}</Text>
    <Text style={[styles.label, { color: met ? okColor : mutedColor }]}>{label}</Text>
  </View>
);

export function PasswordRequirementsChecklist({ password }: Props) {
  const { colors } = useAppTheme();
  const c: PasswordPolicyChecks = analyzePasswordPolicy(password);

  return (
    <View style={[styles.wrap, { borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Password requirements</Text>
      <Row
        met={c.lengthRange}
        label={`${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} characters`}
        mutedColor={colors.muted}
        okColor={colors.authBorderGreen}
      />
      <Row met={c.uppercase} label="One uppercase letter" mutedColor={colors.muted} okColor={colors.authBorderGreen} />
      <Row met={c.lowercase} label="One lowercase letter" mutedColor={colors.muted} okColor={colors.authBorderGreen} />
      <Row met={c.numeric} label="One number" mutedColor={colors.muted} okColor={colors.authBorderGreen} />
      <Row met={c.special} label="One special character (e.g. ! @ # $)" mutedColor={colors.muted} okColor={colors.authBorderGreen} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  title: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  bullet: { fontSize: 14, width: 18, fontWeight: "700" },
  label: { fontSize: 13, flex: 1, lineHeight: 18 },
});
