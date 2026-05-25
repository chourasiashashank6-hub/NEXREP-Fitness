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
import { auth } from "../config/firebase";
import { useAuthStore } from "../store/authStore";

export { auth };

export type AuthResult = { user: User | null; error: string | null };

export const signUp = async (name: string, email: string, password: string): Promise<AuthResult> => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });
    return { user: userCredential.user, error: null };
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    return { user: null, error: getReadableError(code) };
  }
};

export const signIn = async (email: string, password: string): Promise<AuthResult> => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { user: userCredential.user, error: null };
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    return { user: null, error: getReadableError(code) };
  }
};

export const signOutFirebaseOnly = async (): Promise<{ error: string | null }> => {
  try {
    await firebaseSignOut(auth);
    return { error: null };
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    return { error: getReadableError(code) };
  }
};

export const subscribeToAuthChanges = (callback: (user: User | null) => void) => onAuthStateChanged(auth, callback);

/**
 * Continue URL inside the reset email — must appear under Authorized domains.
 * Default `https://<authDomain>/__/auth/action` is always valid for your Firebase project.
 */
function getPasswordResetActionCodeSettings(): ActionCodeSettings | undefined {
  const domain = auth.app.options.authDomain?.trim();
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
    await firebaseSignOut(auth);
  } catch {
    /* ignore */
  }
  await useAuthStore.getState().setToken(null);
};

const getReadableError = (errorCode: string): string => {
  const errorMessages: Record<string, string> = {
    "auth/email-already-in-use": "This email is already registered.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password":
      "Password does not meet requirements (8–16 characters with upper & lowercase, number, and special character).",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/missing-email": "Please enter your email address.",
    "auth/unauthorized-continue-uri":
      "Reset link URL is not authorized. In Firebase Console → Authentication → Settings, add your domain under Authorized domains (include localhost for Expo web). Or set EXPO_PUBLIC_FIREBASE_ACTION_CONTINUE_URL to https://YOUR_PROJECT.firebaseapp.com/__/auth/action",
  };
  return errorMessages[errorCode] || "Something went wrong. Please try again.";
};
