import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchCoachSummary } from "../api/coachSummary";
import { todayLocal } from "../api/caloriesLog";
import type { CoachCadence } from "./useCoachRedesign";
import type { CoachSummaryResponse } from "../types/coachSummary";
import { getSessionCache, setSessionCache } from "../utils/sessionDataCache";
import { useActivityDataRefreshStore } from "../store/activityDataRefreshStore";
import { useAuthStore } from "../store/authStore";
import { fetchWithRetry } from "../utils/fetchWithRetry";
import { readScreenCache, writeScreenCache } from "../utils/screenCache";
import { coachSummaryCacheKey } from "../utils/screenCacheKeys";
import { toUserMessage } from "../utils/toUserMessage";
import { useConnectivityStore } from "../store/connectivityStore";

function sessionCacheKey(domain: "nutrition" | "workout", cadence: string, localDate: string) {
  return `coach-summary:${domain}:${cadence}:${localDate}`;
}

export function useCoachSummaryLoad(
  domain: "nutrition" | "workout",
  cadence: Exclude<CoachCadence, "yearly">,
  activeCadence: CoachCadence,
  refreshToken = 0,
) {
  const { t } = useTranslation();
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const logDate = todayLocal();
  const memKey = sessionCacheKey(domain, cadence, logDate);
  const diskKey = sessionUserId ? coachSummaryCacheKey(sessionUserId, domain, cadence, logDate) : null;
  const cached = getSessionCache<CoachSummaryResponse>(memKey);
  const [summary, setSummary] = useState<CoachSummaryResponse | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const [cacheSavedAt, setCacheSavedAt] = useState<number | null>(null);
  const lastRefreshToken = useRef(refreshToken);
  const requestId = useRef(0);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const activityRefreshVersion = useActivityDataRefreshStore((s) => s.version);
  const isActive = activeCadence === cadence;

  useEffect(() => {
    if (!diskKey || cached) return;
    void readScreenCache<CoachSummaryResponse>(diskKey).then((hit) => {
      if (!hit) return;
      setSessionCache(memKey, hit.data);
      setSummary(hit.data);
      setCacheSavedAt(hit.savedAt);
      setLoading(false);
      setError(null);
    });
  }, [cached, diskKey, memKey]);

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!opts?.force) {
        const hit = getSessionCache<CoachSummaryResponse>(memKey);
        if (hit) {
          setSummary(hit);
          setLoading(false);
          setError(null);
          return;
        }
      }

      const id = requestId.current + 1;
      requestId.current = id;

      try {
        setLoading(true);
        setError(null);
        setWaking(false);
        const data = await fetchWithRetry(
          () => fetchCoachSummary({ domain, cadence, localDate: logDate }),
          { onWaking: () => setWaking(true) },
        );
        if (id !== requestId.current) return;
        setSessionCache(memKey, data);
        if (diskKey) await writeScreenCache(diskKey, data);
        setSummary(data);
        setCacheSavedAt(Date.now());
        setWaking(false);
      } catch (e) {
        if (id !== requestId.current) return;
        const hadCache = Boolean(summaryRef.current);
        if (!hadCache) setSummary(null);
        setError(toUserMessage(e, "coach.summary.loadFailed").body);
        setWaking(useConnectivityStore.getState().serverWaking);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [cadence, diskKey, domain, logDate, memKey],
  );

  useEffect(() => {
    if (!isActive) return;
    const force = refreshToken !== lastRefreshToken.current;
    lastRefreshToken.current = refreshToken;
    void load({ force });
  }, [isActive, load, refreshToken]);

  useEffect(() => {
    if (activityRefreshVersion === 0 || !isActive) return;
    void load({ force: true });
  }, [activityRefreshVersion, isActive, load]);

  const retry = useCallback(() => {
    void load({ force: true });
  }, [load]);

  return { summary, loading, error, waking, cacheSavedAt, isActive, retry };
}
