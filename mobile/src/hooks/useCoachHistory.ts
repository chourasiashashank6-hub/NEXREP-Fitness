import { useCallback, useEffect, useState } from "react";
import { fetchCoachConfigMe, type CoachConfigMeResponse } from "../api/coachConfig";

const DEFAULT_HISTORY: CoachConfigMeResponse = {
  redesign_enabled: false,
  history_days: 0,
  history_days_nutrition: null,
  history_days_workout: null,
  yearly_unlocked: false,
  days_until_yearly: 90,
  yearly_unlock_at_days: 90,
};

let cached: CoachConfigMeResponse | null = null;
let inflight: Promise<CoachConfigMeResponse> | null = null;

async function loadCoachConfigMe(): Promise<CoachConfigMeResponse> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetchCoachConfigMe()
    .then((res) => {
      cached = res;
      return res;
    })
    .catch(() => DEFAULT_HISTORY)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useCoachHistory() {
  const [history, setHistory] = useState<CoachConfigMeResponse>(cached ?? DEFAULT_HISTORY);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    let cancelled = false;
    void loadCoachConfigMe().then((value) => {
      if (!cancelled) {
        setHistory(value);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    cached = null;
    setLoading(true);
    const value = await loadCoachConfigMe();
    setHistory(value);
    setLoading(false);
    return value;
  }, []);

  return { history, loading, refresh };
}
