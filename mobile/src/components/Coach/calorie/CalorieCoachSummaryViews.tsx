import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { fetchCoachSummary } from "../../../api/coachSummary";
import { todayLocal } from "../../../api/caloriesLog";
import type { CoachCadence } from "../../../hooks/useCoachRedesign";
import type { CoachSummaryResponse } from "../../../types/coachSummary";
import { CalorieDailyView } from "./CalorieDailyView";
import { CalorieMonthlyView } from "./CalorieMonthlyView";
import { CalorieWeeklyView } from "./CalorieWeeklyView";

const GREEN = "#0F6E56";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";
const BG = "#F7F6F3";

type Props = {
  cadence: Exclude<CoachCadence, "yearly">;
  refreshToken?: number;
};

export function CalorieCoachSummaryViews({ cadence, refreshToken = 0 }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CoachSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchCoachSummary({ domain: "nutrition", cadence, localDate: todayLocal() });
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
        <ActivityIndicator color={GREEN} />
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
  },
  errorText: { color: MUTED, fontSize: 12, lineHeight: 18 },
});
