import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";

/** Orange pill matching Screen 1 personal-field required markers. */
export function RequiredBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{t("common.required")}</Text>
    </View>
  );
}

export function RequiredLabelRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  badge: {
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: ORANGE_LIGHT,
  },
  text: { fontSize: 11, fontWeight: "800", color: ORANGE },
});
