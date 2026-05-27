import { getProfile } from "../api/user";
import { auth } from "../config/firebase";

export type SessionValidationResult = "ok" | "mismatch" | "invalid" | "no_firebase";

/**
 * When Firebase and our API JWT disagree, the app can show another user's profile/onboarding.
 * If both sessions exist, their emails must match.
 */
export async function validateStoredSessionEmail(): Promise<SessionValidationResult> {
  const fbEmail = auth.currentUser?.email?.trim().toLowerCase();
  if (!fbEmail) return "no_firebase";

  try {
    const profile = await getProfile();
    const apiEmail = String(profile?.email || "")
      .trim()
      .toLowerCase();
    if (!apiEmail) return "invalid";
    return fbEmail === apiEmail ? "ok" : "mismatch";
  } catch {
    return "invalid";
  }
}
