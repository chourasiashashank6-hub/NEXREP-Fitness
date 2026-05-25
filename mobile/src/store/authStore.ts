import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";
import {
  hasPendingOnboarding,
  migrateOnboardingStorageFromJwtKeys,
  setPendingSignupOnboarding,
} from "../storage/onboarding";

type AuthState = {
  token: string | null;
  plan_id: string;
  needsOnboarding: boolean;
  returnToProfileAfterOnboarding: boolean;
  hydrated: boolean;
  setToken: (token: string | null, opts?: { fromSignup?: boolean }) => Promise<void>;
  setPlanId: (plan: string) => void;
  setNeedsOnboarding: (value: boolean) => void;
  setReturnToProfileAfterOnboarding: (value: boolean) => void;
  bootstrap: () => Promise<void>;
};

const KEY = "fitness_jwt";

const getWebStorage = () => {
  if (typeof window === "undefined") return null;
  return window.localStorage;
};

const saveToken = async (token: string | null) => {
  if (Platform.OS === "web") {
    const storage = getWebStorage();
    if (!storage) return;
    if (token) storage.setItem(KEY, token);
    else storage.removeItem(KEY);
    return;
  }
  try {
    if (token) {
      await SecureStore.setItemAsync(KEY, token);
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  } catch {
    const storage = getWebStorage();
    if (!storage) return;
    if (token) storage.setItem(KEY, token);
    else storage.removeItem(KEY);
  }
};

const loadToken = async () => {
  if (Platform.OS === "web") {
    return getWebStorage()?.getItem(KEY) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    const storage = getWebStorage();
    return storage?.getItem(KEY) ?? null;
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  plan_id: "free",
  needsOnboarding: false,
  returnToProfileAfterOnboarding: false,
  hydrated: false,
  setPlanId: (plan_id) => set({ plan_id }),
  setToken: async (token, opts) => {
    if (!token) {
      await saveToken(null);
      set({ token: null, plan_id: "free", needsOnboarding: false, returnToProfileAfterOnboarding: false });
      return;
    }
    await migrateOnboardingStorageFromJwtKeys();
    if (opts?.fromSignup) await setPendingSignupOnboarding(token);
    const pending = await hasPendingOnboarding(token);
    set({ token, needsOnboarding: pending, returnToProfileAfterOnboarding: false });
    await saveToken(token);
  },
  setNeedsOnboarding: (value) => {
    set({ needsOnboarding: value });
  },
  setReturnToProfileAfterOnboarding: (value) => {
    set({ returnToProfileAfterOnboarding: value });
  },
  bootstrap: async () => {
    await migrateOnboardingStorageFromJwtKeys();
    const token = await loadToken();
    const pending = token ? await hasPendingOnboarding(token) : false;
    set({ token, needsOnboarding: pending, hydrated: true, returnToProfileAfterOnboarding: false });
  },
}));
