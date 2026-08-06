import { type Auth, getAuth } from "firebase/auth";
import { getOrCreateFirebaseApp } from "./firebaseApp";

let authInstance: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getOrCreateFirebaseApp());
  }
  return authInstance;
}
