import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { fetchCoachSummary } from "../api/coachSummary";
import { todayLocal } from "../api/caloriesLog";
import type { CoachCadence } from "./useCoachRedesign";
import type { CoachSummaryResponse } from "../types/coachSummary";
import { getSessionCache, setSessionCache } from "../utils/sessionDataCache";
import { useActivityDataRefreshStore } from "../store/activityDataRefreshStore";

function coachSummaryCacheKey(domain: "nutrition" | "workout", cadence: string, localDate: string) {
  return `coach-summary:${domain}:${cadence}:${localDate}`;
}

function formatLoadError(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const detail = e.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (e.response?.status) return fallback;
  }
  if (e instanceof Error && !/network error/i.test(e.message)) return e.message;
  return fallback;
}

export function useCoachSummaryLoad(
  domain: "nutrition" | "workout",
  cadence: Exclude<CoachCadence, "yearly">,
  activeCadence: CoachCadence,
  refreshToken = 0,
) {
  const { t } = useTranslation();
  const logDate = todayLocal();
  const cacheKey = coachSummaryCacheKey(domain, cadence, logDate);
  const cached = getSessionCache<CoachSummaryResponse>(cacheKey);
  const [summary, setSummary] = useState<CoachSummaryResponse | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const lastRefreshToken = useRef(refreshToken);
  const requestId = useRef(0);
  const activityRefreshVersion = useActivityDataRefreshStore((s) => s.version);
  const isActive = activeCadence === cadence;

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!opts?.force) {
        const hit = getSessionCache<CoachSummaryResponse>(cacheKey);
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
        const data = await fetchCoachSummary({ domain, cadence, localDate: logDate });
        if (id !== requestId.current) return;
        setSessionCache(cacheKey, data);
        setSummary(data);
      } catch (e) {
        if (id !== requestId.current) return;
        setSummary(null);
        setError(formatLoadError(e, t("coach.summary.loadFailed")));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [cacheKey, cadence, domain, logDate, t],
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

  return { summary, loading, error, isActive, retry };
}
