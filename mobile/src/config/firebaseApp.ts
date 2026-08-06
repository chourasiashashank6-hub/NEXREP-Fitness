import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";

/** Shared across `firebase.web` / `firebase.native` platform modules. */
export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
};

export function getFirebaseConfigError(): string | null {
  if (!firebaseConfig.apiKey?.trim()) {
    return "Firebase is not configured in this build (missing EXPO_PUBLIC_FIREBASE_API_KEY).";
  }
  if (!firebaseConfig.projectId?.trim()) {
    return "Firebase is not configured in this build (missing EXPO_PUBLIC_FIREBASE_PROJECT_ID).";
  }
  return null;
}

export function getOrCreateFirebaseApp(): FirebaseApp {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApp();
}
