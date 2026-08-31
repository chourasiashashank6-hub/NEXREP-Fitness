import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { PasswordPolicyChecks } from "../utils/passwordPolicy";
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN, analyzePasswordPolicy } from "../utils/passwordPolicy";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../theme/colors";

type Props = { password: string };

const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const Row = ({
  met,
  label,
}: {
  met: boolean;
  label: string;
}) => (
  <View style={styles.row}>
    <View style={[styles.checkCircle, met ? styles.checkCircleMet : styles.checkCircleIdle]}>
      <Ionicons name="checkmark" size={10} color={met ? WHITE : MUTED} />
    </View>
    <Text style={[styles.label, met ? styles.labelMet : styles.labelIdle]}>{label}</Text>
  </View>
);

export function PasswordRequirementsChecklist({ password }: Props) {
  const { t } = useTranslation();
  const c: PasswordPolicyChecks = analyzePasswordPolicy(password);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t("components.passwordRequirements.title")}</Text>
      <Row
        met={c.lengthRange}
        label={t("components.passwordRequirements.length", { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN })}
      />
      <Row met={c.uppercase} label={t("components.passwordRequirements.uppercase")} />
      <Row met={c.lowercase} label={t("components.passwordRequirements.lowercase")} />
      <Row met={c.numeric} label={t("components.passwordRequirements.number")} />
      <Row met={c.special} label={t("components.passwordRequirements.special")} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: BG,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  title: { color: TEXT, fontSize: 11, fontWeight: "900", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  checkCircle: { width: 16, height: 16, borderRadius: 99, alignItems: "center", justifyContent: "center" },
  checkCircleMet: { backgroundColor: GREEN },
  checkCircleIdle: { backgroundColor: TRACK },
  label: { fontSize: 11, flex: 1, lineHeight: 16 },
  labelMet: { color: GREEN, fontWeight: "500" },
  labelIdle: { color: MUTED },
});
