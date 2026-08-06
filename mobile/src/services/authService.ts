import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import type { ActionCodeSettings } from "firebase/auth";
import { getFirebaseAuth } from "../config/firebase";
import { useAuthStore } from "../store/authStore";
import i18n from "../i18n";

export type AuthResult = { user: User | null; error: string | null };

export const signUp = async (name: string, email: string, password: string): Promise<AuthResult> => {
  try {
    const userCredential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    await updateProfile(userCredential.user, { displayName: name });
    return { user: userCredential.user, error: null };
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    return { user: null, error: getReadableError(code) };
  }
};

export const signIn = async (email: string, password: string): Promise<AuthResult> => {
  try {
    const userCredential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    return { user: userCredential.user, error: null };
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    return { user: null, error: getReadableError(code) };
  }
};

export const signOutFirebaseOnly = async (): Promise<{ error: string | null }> => {
  try {
    await firebaseSignOut(getFirebaseAuth());
    return { error: null };
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    return { error: getReadableError(code) };
  }
};

export const subscribeToAuthChanges = (callback: (user: User | null) => void) =>
  onAuthStateChanged(getFirebaseAuth(), callback);

/**
 * Continue URL inside the reset email — must appear under Authorized domains.
 * Default `https://<authDomain>/__/auth/action` is always valid for your Firebase project.
 */
function getPasswordResetActionCodeSettings(): ActionCodeSettings | undefined {
  const domain = getFirebaseAuth().app.options.authDomain?.trim();
  if (!domain) {
    return undefined;
  }
  const custom = process.env.EXPO_PUBLIC_FIREBASE_ACTION_CONTINUE_URL?.trim();
  const url =
    custom && custom.length > 0
      ? custom
      : `https://${domain}/__/auth/action`;
  return {
    url,
    handleCodeInApp: false,
  };
}

/** Sends Firebase password-reset email. */
export const sendPasswordReset = async (email: string): Promise<{ error: string | null }> => {
  const trimmed = email.trim();
  if (!trimmed) {
    return { error: getReadableError("auth/missing-email") };
  }
  try {
    const settings = getPasswordResetActionCodeSettings();
    const auth = getFirebaseAuth();
    if (settings) {
      await sendPasswordResetEmail(auth, trimmed, settings);
    } else {
      await sendPasswordResetEmail(auth, trimmed);
    }
    return { error: null };
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    return { error: getReadableError(code) };
  }
};

/** Clears Firebase session and the app JWT (SecureStore / web storage). */
export const signOutSession = async () => {
  try {
    await firebaseSignOut(getFirebaseAuth());
  } catch {
    /* ignore */
  }
  const { useSubscriptionStore } = await import("../store/subscriptionStore");
  useSubscriptionStore.getState().reset();
  await useAuthStore.getState().setToken(null);
};

const getReadableError = (errorCode: string): string => {
  const errorMessages: Record<string, string> = {
    "auth/email-already-in-use": i18n.t("auth.firebaseErrors.emailInUse"),
    "auth/invalid-email": i18n.t("auth.firebaseErrors.invalidEmail"),
    "auth/weak-password":
      i18n.t("auth.firebaseErrors.weakPassword"),
    "auth/user-not-found": i18n.t("auth.firebaseErrors.userNotFound"),
    "auth/wrong-password": i18n.t("auth.firebaseErrors.wrongPassword"),
    "auth/invalid-credential": i18n.t("auth.firebaseErrors.invalidCredential"),
    "auth/network-request-failed": i18n.t("auth.firebaseErrors.network"),
    "auth/too-many-requests": i18n.t("auth.firebaseErrors.tooMany"),
    "auth/missing-email": i18n.t("auth.firebaseErrors.missingEmail"),
    "auth/unauthorized-continue-uri":
      i18n.t("auth.firebaseErrors.unauthorizedContinueUri"),
  };
  return errorMessages[errorCode] || i18n.t("auth.firebaseErrors.generic");
};
