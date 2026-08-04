import type { NutritionTargets, OnboardingData } from "../types/onboarding";
import { getOnboardingData, getTargets, saveOnboardingData, saveTargets } from "../storage/onboarding";
import { apiClient } from "./client";

export type OnboardingMeResponse = { onboarding: OnboardingData; targets: NutritionTargets };

export async function fetchOnboardingMe(): Promise<OnboardingMeResponse | null> {
  try {
    const { data } = await apiClient.get<OnboardingMeResponse>("/onboarding/me");
    return data;
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw e;
  }
}

/** Shared in-flight request so concurrent callers (e.g. OnboardingContext's own
 * fetch-on-mount effect and a screen refreshing at the same moment right after login)
 * collapse into a single GET /onboarding/me instead of firing one each. */
let inFlightOnboardingMeFetch: Promise<OnboardingMeResponse | null> | null = null;

export function fetchOnboardingMeShared(): Promise<OnboardingMeResponse | null> {
  if (!inFlightOnboardingMeFetch) {
    inFlightOnboardingMeFetch = fetchOnboardingMe().finally(() => {
      inFlightOnboardingMeFetch = null;
    });
  }
  return inFlightOnboardingMeFetch;
}

export async function upsertOnboardingMe(payload: {
  onboarding: OnboardingData;
  targets: NutritionTargets;
}): Promise<OnboardingMeResponse> {
  const { data } = await apiClient.put<OnboardingMeResponse>("/onboarding/me", payload);
  return data;
}

/** Prefer server copy; fall back to device storage for legacy/offline. */
export async function loadOnboardingWithFallback(token: string): Promise<{
  profile: OnboardingData | null;
  targets: NutritionTargets | null;
}> {
  try {
    const remote = await fetchOnboardingMe();
    if (remote?.onboarding && remote?.targets) {
      await saveOnboardingData(token, remote.onboarding);
      await saveTargets(token, remote.targets);
      return { profile: remote.onboarding, targets: remote.targets };
    }
  } catch {
    /* use local */
  }
  const [profile, targets] = await Promise.all([getOnboardingData(token), getTargets(token)]);
  return { profile, targets };
}
