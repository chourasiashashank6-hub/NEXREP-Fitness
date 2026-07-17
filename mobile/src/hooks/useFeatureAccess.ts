import { useCallback } from "react";
import { canAccess } from "../constants/featureTiers";
import { auth } from "../services/authService";
import { useAuthStore } from "../store/authStore";

/** Dev bypass for planner features — keep in sync with Coach home gating. */
const PLANNER_GATE_BYPASS_EMAILS = new Set(["shashank1@gmail.com"]);
const PLANNER_GATE_BYPASS_USER_IDS = new Set(["2"]);
const PLANNER_GATE_BYPASS_FEATURES = new Set(["meal_plan_generation", "workout_plan_generation"]);

export function useFeatureAccess() {
  const plan_id = useAuthStore((s) => s.plan_id) ?? "free";
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const signedInEmail = String(auth.currentUser?.email || "")
    .trim()
    .toLowerCase();
  const plannerGateBypassEnabled =
    PLANNER_GATE_BYPASS_EMAILS.has(signedInEmail) ||
    (sessionUserId ? PLANNER_GATE_BYPASS_USER_IDS.has(sessionUserId) : false);

  const hasFeatureAccess = useCallback(
    (feature: string) =>
      canAccess(plan_id, feature) ||
      (plannerGateBypassEnabled && PLANNER_GATE_BYPASS_FEATURES.has(feature)),
    [plan_id, plannerGateBypassEnabled],
  );

  return { plan_id, hasFeatureAccess };
}
