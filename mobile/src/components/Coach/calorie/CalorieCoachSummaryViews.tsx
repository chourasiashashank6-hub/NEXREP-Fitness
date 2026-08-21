import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CoachCadence } from "../../../hooks/useCoachRedesign";
import { useCoachSummaryLoad } from "../../../hooks/useCoachSummaryLoad";
import { CalorieDailyView } from "./CalorieDailyView";
import { CalorieMonthlyView } from "./CalorieMonthlyView";
import { CalorieWeeklyView } from "./CalorieWeeklyView";

const GREEN = "#0F6E56";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";
const BG = "#F7F6F3";

type Props = {
  cadence: Exclude<CoachCadence, "yearly">;
  activeCadence: CoachCadence;
  refreshToken?: number;
};

export function CalorieCoachSummaryViews({ cadence, activeCadence, refreshToken = 0 }: Props) {
  const { t } = useTranslation();
  const { summary, loading, error, isActive, retry } = useCoachSummaryLoad(
    "nutrition",
    cadence,
    activeCadence,
    refreshToken,
  );

  if (!isActive && !summary) return null;

  if (loading && !summary) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={GREEN} />
        <Text style={styles.loadingText}>{t("coach.summary.loading")}</Text>
      </View>
    );
  }

  if (error || !summary) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{error ?? t("coach.summary.loadFailed")}</Text>
        {isActive ? (
          <Pressable style={styles.retryBtn} onPress={retry}>
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (cadence === "daily") return <CalorieDailyView summary={summary} />;
  if (cadence === "weekly") return <CalorieWeeklyView summary={summary} />;
  return <CalorieMonthlyView summary={summary} />;
}

const styles = StyleSheet.create({
  loadingBox: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  errorBox: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  errorText: { color: MUTED, fontSize: 12, lineHeight: 18 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
});
