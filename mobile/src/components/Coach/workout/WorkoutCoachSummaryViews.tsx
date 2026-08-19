import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { fetchCoachSummary } from "../../../api/coachSummary";
import { todayLocal } from "../../../api/caloriesLog";
import type { CoachCadence } from "../../../hooks/useCoachRedesign";
import type { CoachSummaryResponse } from "../../../types/coachSummary";
import { WorkoutDailyView } from "./WorkoutDailyView";
import { WorkoutMonthlyView } from "./WorkoutMonthlyView";
import { WorkoutWeeklyView } from "./WorkoutWeeklyView";
import { WC_COLORS } from "../../../constants/workoutCoach";

type Props = {
  cadence: Exclude<CoachCadence, "yearly">;
  refreshToken?: number;
};

export function WorkoutCoachSummaryViews({ cadence, refreshToken = 0 }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CoachSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchCoachSummary({ domain: "workout", cadence, localDate: todayLocal() });
      setSummary(data);
    } catch (e) {
      setSummary(null);
      setError(e instanceof Error ? e.message : t("coach.summary.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [cadence, t]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  if (loading) {
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
  },
  errorText: { color: WC_COLORS.MUTED, fontSize: 12, lineHeight: 18 },
});
