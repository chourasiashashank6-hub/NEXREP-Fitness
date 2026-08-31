import { useCallback, useEffect, useState } from "react";
import { fetchCoachConfig } from "../api/coachConfig";
import { setRemoteFeatureTiers } from "../constants/featureTiers";

let bootstrapInflight: Promise<void> | null = null;

/** Load server-authoritative feature tiers (falls back to local copy offline). */
export function bootstrapFeatureTiers(): Promise<void> {
  if (bootstrapInflight) return bootstrapInflight;
  bootstrapInflight = fetchCoachConfig()
    .then((res) => {
      setRemoteFeatureTiers(res.feature_tiers);
    })
    .catch(() => undefined)
    .finally(() => {
      bootstrapInflight = null;
    });
  return bootstrapInflight;
}

let cachedRedesignEnabled: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function loadRedesignFlag(): Promise<boolean> {
  if (cachedRedesignEnabled !== null) return cachedRedesignEnabled;
  if (inflight) return inflight;
  inflight = fetchCoachConfig()
    .then((res) => {
      cachedRedesignEnabled = Boolean(res.redesign_enabled);
      setRemoteFeatureTiers(res.feature_tiers);
      return cachedRedesignEnabled;
    })
    .catch(() => {
      cachedRedesignEnabled = false;
      return false;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Reads COACH_REDESIGN_ENABLED from the server (default false). */
export function useCoachRedesignEnabled() {
  const [enabled, setEnabled] = useState(cachedRedesignEnabled ?? false);
  const [loading, setLoading] = useState(cachedRedesignEnabled === null);

  useEffect(() => {
    let cancelled = false;
    void loadRedesignFlag().then((value) => {
      if (!cancelled) {
        setEnabled(value);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    cachedRedesignEnabled = null;
    setLoading(true);
    const value = await loadRedesignFlag();
    setEnabled(value);
    setLoading(false);
    return value;
  }, []);

  return { enabled, loading, refresh };
}

export type CoachCadence = "daily" | "weekly" | "monthly" | "yearly";

export const CADENCE_FEATURE: Record<CoachCadence, string> = {
  daily: "coach_daily_analysis",
  weekly: "coach_weekly_analysis",
  monthly: "coach_monthly_analysis",
  yearly: "coach_yearly_analysis",
};
