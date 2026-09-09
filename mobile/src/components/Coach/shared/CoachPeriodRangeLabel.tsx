import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { formatSummaryDateRange } from "../../../utils/coachSummaryFormat";
import { GREEN, BORDER, BG, TEXT } from "../../../theme/colors";

const MUTED = "#BBBBBB";

type Cadence = "daily" | "weekly" | "monthly" | "yearly";

type Props = {
  cadence: Cadence;
  startDate: string;
  endDate: string;
  accentColor?: string;
};

export function CoachPeriodRangeLabel({ cadence, startDate, endDate, accentColor = GREEN }: Props) {
  const { t } = useTranslation();
  const rangeLabel = formatSummaryDateRange(startDate, endDate);

  return (
    <View style={styles.wrap} accessibilityRole="text">
      <Text style={[styles.cadence, { color: accentColor }]}>{t(`coach.summary.period.${cadence}`)}</Text>
      <Text style={styles.range}>{rangeLabel}</Text>
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
  },
  cadence: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  range: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
});
