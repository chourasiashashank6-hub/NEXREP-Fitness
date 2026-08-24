import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";
import {
  hasPendingOnboarding,
  migrateOnboardingStorageFromJwtKeys,
  setPendingSignupOnboarding,
} from "../storage/onboarding";
import { decodeJwtSub } from "../utils/jwt";
import type { UserProfile } from "../api/user";

type AuthState = {
  token: string | null;
  sessionUserId: string | null;
  plan_id: string;
  needsOnboarding: boolean;
  returnToProfileAfterOnboarding: boolean;
  hydrated: boolean;
  /**
   * Profile fetched once during bootstrap()'s session-email validation. Consumers (e.g.
   * OnboardingContext) should call consumeCachedProfile() to read+clear it in one step,
   * avoiding a redundant GET /profile right after bootstrap already fetched it.
   */
  cachedProfile: UserProfile | null;
  setToken: (token: string | null, opts?: { fromSignup?: boolean }) => Promise<void>;
  setPlanId: (plan: string) => void;
  setNeedsOnboarding: (value: boolean) => void;
  setReturnToProfileAfterOnboarding: (value: boolean) => void;
  bootstrap: () => Promise<void>;
  consumeCachedProfile: () => UserProfile | null;
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

const sessionIdFromToken = (token: string | null) => (token ? decodeJwtSub(token) : null);

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  sessionUserId: null,
  plan_id: "free",
  needsOnboarding: false,
  returnToProfileAfterOnboarding: false,
  hydrated: false,
  cachedProfile: null,
  setPlanId: (plan_id) => set({ plan_id }),
  consumeCachedProfile: () => {
    const profile = get().cachedProfile;
    if (profile) set({ cachedProfile: null });
    return profile;
  },
  setToken: async (token, opts) => {
    if (!token) {
      const { useSubscriptionStore } = await import("./subscriptionStore");
      useSubscriptionStore.getState().reset();
      await saveToken(null);
      set({
        token: null,
        sessionUserId: null,
        plan_id: "free",
        needsOnboarding: false,
        returnToProfileAfterOnboarding: false,
        cachedProfile: null,
      });
      return;
    }

    const prevUserId = get().sessionUserId;
    const nextUserId = sessionIdFromToken(token);
    if (prevUserId && nextUserId && prevUserId !== nextUserId) {
      const { useSubscriptionStore } = await import("./subscriptionStore");
      useSubscriptionStore.getState().reset();
    }

    await migrateOnboardingStorageFromJwtKeys();
    if (opts?.fromSignup) await setPendingSignupOnboarding(token);
    const pending = await hasPendingOnboarding(token);
    set({
      token,
      sessionUserId: nextUserId,
      needsOnboarding: pending,
      returnToProfileAfterOnboarding: false,
    });
    await saveToken(token);
    const { ensurePushRegistration, syncMotivationalQuoteReminders } = await import("../services/notificationService");
    void ensurePushRegistration(false).catch(() => undefined);
    void syncMotivationalQuoteReminders().catch(() => undefined);
  },
  setNeedsOnboarding: (value) => {
    set({ needsOnboarding: value });
  },
  setReturnToProfileAfterOnboarding: (value) => {
    set({ returnToProfileAfterOnboarding: value });
  },
  bootstrap: async () => {
    await migrateOnboardingStorageFromJwtKeys();
    let token = await loadToken();

    if (token) {
      set({ token, sessionUserId: sessionIdFromToken(token) });
      const { waitForFirebaseAuthReady } = await import("../services/authService");
      await waitForFirebaseAuthReady();

      const { validateStoredSessionEmail } = await import("../utils/sessionValidation");
      const applyValidation = async () => {
        const { status, profile } = await validateStoredSessionEmail();
        if (status === "mismatch") {
          return { signedOut: true as const };
        }
        if (status === "unauthorized" || status === "no_firebase") {
          const { renewJwtFromFirebase } = await import("../services/authService");
          const renewed = await renewJwtFromFirebase();
          if (!renewed) {
            return { signedOut: true as const };
          }
          token = renewed;
          const retry = await validateStoredSessionEmail();
          if (retry.status === "mismatch") {
            return { signedOut: true as const };
          }
          if (retry.status === "ok" && retry.profile) {
            set({ cachedProfile: retry.profile, plan_id: String(retry.profile.plan_id || "free") });
          }
          return { signedOut: false as const };
        }
        if (status === "invalid") {
          // Offline or transient error — keep stored session.
          return { signedOut: false as const };
        }
        if (profile) {
          set({ cachedProfile: profile, plan_id: String(profile.plan_id || "free") });
        }
        return { signedOut: false as const };
      };

      const result = await applyValidation();
      if (result.signedOut) {
        const { signOutSession } = await import("../services/authService");
        await signOutSession();
        token = null;
        set({ cachedProfile: null });
      }
    }

    if (!token) {
      set({
        token: null,
        sessionUserId: null,
        needsOnboarding: false,
        hydrated: true,
        returnToProfileAfterOnboarding: false,
      });
      return;
    }

    const pending = await hasPendingOnboarding(token);
    set({
      token,
      sessionUserId: sessionIdFromToken(token),
      needsOnboarding: pending,
      hydrated: true,
      returnToProfileAfterOnboarding: false,
    });
    const { ensurePushRegistration, syncMotivationalQuoteReminders } = await import("../services/notificationService");
    void ensurePushRegistration(false).catch(() => undefined);
    void syncMotivationalQuoteReminders().catch(() => undefined);
  },
}));
