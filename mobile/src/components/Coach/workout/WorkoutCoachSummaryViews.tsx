import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CoachCadence } from "../../../hooks/useCoachRedesign";
import { useCoachSummaryLoad } from "../../../hooks/useCoachSummaryLoad";
import { WorkoutDailyView } from "./WorkoutDailyView";
import { WorkoutMonthlyView } from "./WorkoutMonthlyView";
import { WorkoutWeeklyView } from "./WorkoutWeeklyView";
import { WC_COLORS } from "../../../constants/workoutCoach";

type Props = {
  cadence: Exclude<CoachCadence, "yearly">;
  activeCadence: CoachCadence;
  refreshToken?: number;
};

export function WorkoutCoachSummaryViews({ cadence, activeCadence, refreshToken = 0 }: Props) {
  const { t } = useTranslation();
  const { summary, loading, error, isActive, retry } = useCoachSummaryLoad(
    "workout",
    cadence,
    activeCadence,
    refreshToken,
  );

  if (!isActive && !summary) return null;

  if (loading && !summary) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={WC_COLORS.PURPLE_MID} />
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

  if (cadence === "daily") return <WorkoutDailyView summary={summary} />;
  if (cadence === "weekly") return <WorkoutWeeklyView summary={summary} />;
  return <WorkoutMonthlyView summary={summary} />;
}

const styles = StyleSheet.create({
  loadingBox: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: WC_COLORS.MUTED, fontSize: 12, fontWeight: "700" },
  errorBox: {
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
    backgroundColor: WC_COLORS.BG,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  errorText: { color: WC_COLORS.MUTED, fontSize: 12, lineHeight: 18 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: WC_COLORS.PURPLE_MID,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
});
