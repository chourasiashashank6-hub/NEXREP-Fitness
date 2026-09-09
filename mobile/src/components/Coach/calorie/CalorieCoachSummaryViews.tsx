import { useTranslation } from "react-i18next";
import type { CoachCadence } from "../../../hooks/useCoachRedesign";
import { useCoachSummaryLoad } from "../../../hooks/useCoachSummaryLoad";
import { useCanReachBackend } from "../../../hooks/useCanReachBackend";
import { CalorieDailyView } from "./CalorieDailyView";
import { CalorieMonthlyView } from "./CalorieMonthlyView";
import { CalorieWeeklyView } from "./CalorieWeeklyView";
import { StateView } from "../../StateView";

type Props = {
  cadence: Exclude<CoachCadence, "yearly">;
  activeCadence: CoachCadence;
  refreshToken?: number;
};

export function CalorieCoachSummaryViews({ cadence, activeCadence, refreshToken = 0 }: Props) {
  const { t } = useTranslation();
  const { canReach, serverWaking } = useCanReachBackend();
  const { summary, loading, error, waking, cacheSavedAt, isActive, retry } = useCoachSummaryLoad(
    "nutrition",
    cadence,
    activeCadence,
    refreshToken,
  );

  if (!isActive && !summary) return null;

  if (loading && !summary) {
    return <StateView state="loading" waking={waking || serverWaking} />;
  }

  if (error || !summary) {
    return (
      <StateView
        state="failed"
        title={t("offline.errors.genericTitle")}
        body={error ?? t("coach.summary.loadFailed")}
        waking={waking || serverWaking}
        onRetry={isActive && !waking && !serverWaking ? retry : undefined}
        retryDisabled={!canReach}
        lastUpdatedAt={cacheSavedAt}
      />
    );
  }

  if (cadence === "daily") return <CalorieDailyView summary={summary} />;
  if (cadence === "weekly") return <CalorieWeeklyView summary={summary} />;
  return <CalorieMonthlyView summary={summary} />;
}
