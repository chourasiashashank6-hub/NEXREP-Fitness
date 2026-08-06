import AsyncStorage from "@react-native-async-storage/async-storage";
import { type Auth, getAuth, getReactNativePersistence, initializeAuth } from "firebase/auth";
import { getFirebaseConfigError, getOrCreateFirebaseApp } from "./firebaseApp";

let authInstance: Auth | null = null;

/** Lazy Firebase Auth — avoids crashing the whole app at import time. */
export function getFirebaseAuth(): Auth {
  if (authInstance) return authInstance;

  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const app = getOrCreateFirebaseApp();
  try {
    initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    if (code !== "auth/already-initialized") {
      throw e;
    }
  }

  authInstance = getAuth(app);
  return authInstance;
}
