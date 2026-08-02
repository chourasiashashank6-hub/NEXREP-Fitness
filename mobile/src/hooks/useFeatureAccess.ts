import { useCallback } from "react";
import { canAccess } from "../constants/featureTiers";
import { useAuthStore } from "../store/authStore";

export function useFeatureAccess() {
  const plan_id = useAuthStore((s) => s.plan_id) ?? "free";

  const hasFeatureAccess = useCallback(
    (feature: string) => canAccess(plan_id, feature),
    [plan_id],
  );

  return { plan_id, hasFeatureAccess };
}
