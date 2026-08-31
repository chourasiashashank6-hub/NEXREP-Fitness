import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { GREEN, GREEN_LIGHT, TEXT } from "../../../theme/colors";

type Props = {
  label: string;
  body: string;
  variant?: "purple" | "green" | "amber" | "coral";
};

const VARIANTS = {
  purple: { bg: "#F1EEFF", border: "#7B68CC", label: "#7B68CC" },
  green: { bg: GREEN_LIGHT, border: GREEN, label: GREEN },
  amber: { bg: "#FFF8E8", border: "#C08000", label: "#C08000" },
  coral: { bg: "#FFF1EE", border: "#D85A30", label: "#D85A30" },
};

export function CoachInsightNote({ label, body, variant = "purple" }: Props) {
  const colors = VARIANTS[variant];
  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg, borderLeftColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.label }]}>{label}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

export function CoachInsightNoteFromKey({
  noteKey,
  params,
  label,
  variant,
}: {
  noteKey: string;
  params?: Record<string, string | number>;
  label: string;
  variant?: Props["variant"];
}) {
  const { t } = useTranslation();
  return <CoachInsightNote label={label} body={t(noteKey, params)} variant={variant} />;
}

const styles = StyleSheet.create({
  wrap: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  label: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  body: {
    color: TEXT,
    fontSize: 12,
    lineHeight: 18,
  },
});
