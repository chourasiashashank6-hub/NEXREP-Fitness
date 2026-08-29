import { getProfile } from "../api/user";
import type { PlanId } from "../constants/plans";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PaymentConfirmationPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfirmationPendingError";
  }
}

/** After Razorpay succeeds, verify may fail while the webhook still activates the plan. */
export async function pollProfileForPlanActivation(
  planId: PlanId,
  {
    attempts = 6,
    intervalMs = 2000,
  }: { attempts?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const expected = planId.toLowerCase();
  for (let i = 0; i < attempts; i += 1) {
    try {
      const profile = await getProfile();
      if (String(profile.plan_id || "free").toLowerCase() === expected) {
        return true;
      }
    } catch {
      // Transient network — keep polling.
    }
    if (i < attempts - 1) {
      await sleep(intervalMs);
    }
  }
  return false;
}
