import AsyncStorage from "@react-native-async-storage/async-storage";
import { NutritionTargets, OnboardingData } from "../types/onboarding";
import { decodeJwtSub } from "../utils/jwt";

const PREFIX_ONBOARDING = "@fitness:onboarding:";
const PREFIX_TARGETS = "@fitness:targets:";
const PREFIX_DONE = "@fitness:onboarding_done:";

const pendingOnboardingKey = (userId: string) => `@fitness:pending_onboarding:${userId}`;

/** Stable storage scope: JWT changes every login, user id (sub) does not. */
const storageScope = (token: string): string => {
  const sub = decodeJwtSub(token);
  return sub ? `uid:${sub}` : `tok:${token}`;
};

const onboardingKey = (token: string) => `${PREFIX_ONBOARDING}${storageScope(token)}`;
const targetsKey = (token: string) => `${PREFIX_TARGETS}${storageScope(token)}`;
const doneKey = (token: string) => `${PREFIX_DONE}${storageScope(token)}`;

/** Legacy keys used the full JWT; copy into uid:* once so data survives re-login. */
export const migrateOnboardingStorageFromJwtKeys = async (): Promise<void> => {
  let keys: readonly string[];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch {
    return;
  }
  for (const key of keys) {
    let rest: string | null = null;
    let prefix: string | null = null;
    if (key.startsWith(PREFIX_ONBOARDING)) {
      prefix = PREFIX_ONBOARDING;
      rest = key.slice(PREFIX_ONBOARDING.length);
    } else if (key.startsWith(PREFIX_TARGETS)) {
      prefix = PREFIX_TARGETS;
      rest = key.slice(PREFIX_TARGETS.length);
    } else if (key.startsWith(PREFIX_DONE)) {
      prefix = PREFIX_DONE;
      rest = key.slice(PREFIX_DONE.length);
    } else {
      continue;
    }
    if (!rest || rest.startsWith("uid:") || rest.startsWith("tok:")) continue; // already scoped
    const sub = decodeJwtSub(rest);
    if (!sub) continue;
    const newKey = `${prefix}uid:${sub}`;
    const val = await AsyncStorage.getItem(key);
    if (!val) continue;
    const existing = await AsyncStorage.getItem(newKey);
    if (!existing) await AsyncStorage.setItem(newKey, val);
    await AsyncStorage.removeItem(key);
  }
};

/** Set after successful signup so only new accounts are routed through onboarding. */
export const setPendingSignupOnboarding = async (token: string) => {
  const sub = decodeJwtSub(token);
  if (sub) await AsyncStorage.setItem(pendingOnboardingKey(sub), "1");
};

export const hasPendingOnboarding = async (token: string) => {
  const sub = decodeJwtSub(token);
  if (!sub) return false;
  const raw = await AsyncStorage.getItem(pendingOnboardingKey(sub));
  return raw === "1";
};

export const clearPendingOnboarding = async (token: string) => {
  const sub = decodeJwtSub(token);
  if (sub) await AsyncStorage.removeItem(pendingOnboardingKey(sub));
};

export const saveOnboardingData = async (token: string, data: OnboardingData) => {
  await AsyncStorage.setItem(onboardingKey(token), JSON.stringify(data));
  await AsyncStorage.setItem(doneKey(token), "1");
  await clearPendingOnboarding(token);
};

export const getOnboardingData = async (token: string) => {
  const raw = await AsyncStorage.getItem(onboardingKey(token));
  return raw ? (JSON.parse(raw) as OnboardingData) : null;
};

export const saveTargets = async (token: string, targets: NutritionTargets) => {
  await AsyncStorage.setItem(targetsKey(token), JSON.stringify(targets));
};

export const getTargets = async (token: string) => {
  const raw = await AsyncStorage.getItem(targetsKey(token));
  return raw ? (JSON.parse(raw) as NutritionTargets) : null;
};
