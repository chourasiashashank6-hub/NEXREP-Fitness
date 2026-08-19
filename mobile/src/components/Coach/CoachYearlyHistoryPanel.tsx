import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

const TEXT = "#1A1A18";
const MUTED = "#888888";
const BORDER = "#ECEAE5";
const BG = "#F7F6F3";
const GREEN = "#0F6E56";

type Props = {
  daysUntil: number;
  unlockAtDays: number;
  accentColor?: string;
};

/** Shown when Elite tier is unlocked but user has fewer than 90 days of history. */
export function CoachYearlyHistoryPanel({ daysUntil, unlockAtDays, accentColor = GREEN }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: `${accentColor}18` }]}>
        <Ionicons name="time-outline" size={22} color={accentColor} />
      </View>
      <Text style={styles.kicker}>{t("coach.redesign.yearly.historyKicker")}</Text>
      <Text style={styles.title}>{t("coach.redesign.yearly.historyTitle")}</Text>
      <Text style={styles.body}>
        {daysUntil > 0
          ? t("coach.redesign.yearly.historyBodyCountdown", { count: daysUntil, total: unlockAtDays })
          : t("coach.redesign.yearly.historyBodySoon", { total: unlockAtDays })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
    marginBottom: 12,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  kicker: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
});
