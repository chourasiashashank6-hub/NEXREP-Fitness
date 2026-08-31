/**
 * Cold-start / offline gating tests.
 * Simulates airplane mode by rejecting fetchCoachConfig (no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FALLBACK_GATES = {
  free: { calorie_logging: true, food_photo_analysis: false, coach_monthly_analysis: false },
  pro: { calorie_logging: true, food_photo_analysis: true, coach_monthly_analysis: false },
  elite: { calorie_logging: true, food_photo_analysis: true, coach_monthly_analysis: true },
} as const;

function expectGates(
  canAccess: (plan: string, feature: string) => boolean,
  plan: keyof typeof FALLBACK_GATES,
) {
  const gates = FALLBACK_GATES[plan];
  for (const [feature, allowed] of Object.entries(gates)) {
    expect(canAccess(plan, feature)).toBe(allowed);
  }
}

describe("feature tier cold start (no cached config)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses FEATURE_TIERS_FALLBACK before any network fetch", async () => {
    const { canAccess, getFeatureTiers, FEATURE_TIERS_FALLBACK } = await import("./featureTiers");
    expect(getFeatureTiers()).toBe(FEATURE_TIERS_FALLBACK);
    expectGates(canAccess, "free");
    expectGates(canAccess, "pro");
    expectGates(canAccess, "elite");
  });

  it("keeps fallback gating when /api/coach/config fails (airplane mode)", async () => {
    vi.doMock("../api/coachConfig", () => ({
      fetchCoachConfig: vi.fn().mockRejectedValue(new Error("Network Error")),
    }));

    const tiers = await import("./featureTiers");
    const { bootstrapFeatureTiers } = await import("../hooks/useCoachRedesign");

    expectGates(tiers.canAccess, "free");

    await bootstrapFeatureTiers();

    expect(tiers.getFeatureTiers()).toBe(tiers.FEATURE_TIERS_FALLBACK);
    expectGates(tiers.canAccess, "free");
    expectGates(tiers.canAccess, "pro");
    expectGates(tiers.canAccess, "elite");
  });

  it("does not block first render: gating is synchronous while bootstrap is async", async () => {
    let resolveFetch!: (value: unknown) => void;
    const pendingFetch = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    vi.doMock("../api/coachConfig", () => ({
      fetchCoachConfig: vi.fn(() => pendingFetch),
    }));

    const tiers = await import("./featureTiers");
    const { bootstrapFeatureTiers } = await import("../hooks/useCoachRedesign");

    // First paint: config fetch not finished.
    expectGates(tiers.canAccess, "free");

    const bootstrapPromise = bootstrapFeatureTiers();

    // Still on first paint window while fetch is in flight.
    expectGates(tiers.canAccess, "free");
    expect(tiers.getFeatureTiers()).toBe(tiers.FEATURE_TIERS_FALLBACK);

    resolveFetch({ redesign_enabled: false, feature_tiers: { food_photo_analysis: "elite" } });
    await bootstrapPromise;

    // After server responds, remote tiers apply (would need UI re-render to reflect drift).
    expect(tiers.canAccess("pro", "food_photo_analysis")).toBe(false);
  });
});
