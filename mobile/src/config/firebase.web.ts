/**
 * Web / Expo web — use default browser persistence (IndexedDB). Do not use
 * getReactNativePersistence here (not in the web SDK; breaks the bundle).
 */
import { getAuth } from "firebase/auth";
import { getOrCreateFirebaseApp } from "./firebaseApp";

const app = getOrCreateFirebaseApp();
export const auth = getAuth(app);
export default app;
