import AsyncStorage from "@react-native-async-storage/async-storage";
import { NutritionTargets, OnboardingData } from "../types/onboarding";
import { decodeJwtSub } from "../utils/jwt";

const PREFIX_ONBOARDING = "@fitness:onboarding:";
const PREFIX_TARGETS = "@fitness:targets:";
const PREFIX_DONE = "@fitness:onboarding_done:";

const pendingOnboardingKey = (userId: string) => `@fitness:pending_onboarding:${userId}`;

/** Stable storage scope: JWT changes every login, user id (sub) does not. */
const storageScope = (token: string): string | null => {
  const sub = decodeJwtSub(token);
  return sub ? `uid:${sub}` : null;
};

const onboardingKey = (token: string) => {
  const scope = storageScope(token);
  return scope ? `${PREFIX_ONBOARDING}${scope}` : null;
};
const targetsKey = (token: string) => {
  const scope = storageScope(token);
  return scope ? `${PREFIX_TARGETS}${scope}` : null;
};
const doneKey = (token: string) => {
  const scope = storageScope(token);
  return scope ? `${PREFIX_DONE}${scope}` : null;
};

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
  const oKey = onboardingKey(token);
  const dKey = doneKey(token);
  if (!oKey || !dKey) return;
  await AsyncStorage.setItem(oKey, JSON.stringify(data));
  await AsyncStorage.setItem(dKey, "1");
  await clearPendingOnboarding(token);
};

export const getOnboardingData = async (token: string) => {
  const oKey = onboardingKey(token);
  if (!oKey) return null;
  const raw = await AsyncStorage.getItem(oKey);
  return raw ? (JSON.parse(raw) as OnboardingData) : null;
};

export const saveTargets = async (token: string, targets: NutritionTargets) => {
  const tKey = targetsKey(token);
  if (!tKey) return;
  await AsyncStorage.setItem(tKey, JSON.stringify(targets));
};

export const getTargets = async (token: string) => {
  const tKey = targetsKey(token);
  if (!tKey) return null;
  const raw = await AsyncStorage.getItem(tKey);
  return raw ? (JSON.parse(raw) as NutritionTargets) : null;
};
