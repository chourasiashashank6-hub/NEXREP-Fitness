/**
 * iOS / Android — AsyncStorage-backed auth persistence for Expo Go / native.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAuth, getReactNativePersistence, initializeAuth } from "firebase/auth";
import { getOrCreateFirebaseApp } from "./firebaseApp";

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

export const auth = getAuth(app);
export default app;
