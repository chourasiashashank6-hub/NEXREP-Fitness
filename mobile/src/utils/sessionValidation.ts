import axios from "axios";
import { getProfile, type UserProfile } from "../api/user";
import { getFirebaseAuth } from "../config/firebase";

export type SessionValidationResult = "ok" | "mismatch" | "invalid" | "unauthorized" | "no_firebase";

export type SessionValidationOutcome = {
  status: SessionValidationResult;
  /** The profile fetched during validation, if any — callers can cache/reuse it to avoid a second GET /profile. */
  profile: UserProfile | null;
};

/**
 * When Firebase and our API JWT disagree, the app can show another user's profile/onboarding.
 * If both sessions exist, their emails must match.
 */
export async function validateStoredSessionEmail(): Promise<SessionValidationOutcome> {
  const fbEmail = getFirebaseAuth().currentUser?.email?.trim().toLowerCase();
  if (!fbEmail) return { status: "no_firebase", profile: null };

  try {
    const profile = await getProfile();
    const apiEmail = String(profile?.email || "")
      .trim()
      .toLowerCase();
    if (!apiEmail) return { status: "invalid", profile: null };
    return { status: fbEmail === apiEmail ? "ok" : "mismatch", profile };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 401) {
      return { status: "unauthorized", profile: null };
    }
    return { status: "invalid", profile: null };
  }
}
