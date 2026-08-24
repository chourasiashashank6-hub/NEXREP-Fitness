/**
 * Run: npx --yes tsx src/utils/resolveBurnTargetWeightKg.test.ts
 * (from mobile/)
 */
import { resolveBurnTargetWeightKg } from "./resolveBurnTargetWeightKg";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Latest log wins when has_logs is true
{
  const kg = resolveBurnTargetWeightKg({
    weightLatest: { weight_kg: 75, has_logs: true },
    profileWeightKg: 79,
    onboardingWeightKg: 80,
  });
  assert(kg === 75, `expected 75 from log, got ${kg}`);
}

// Profile when no logs
{
  const kg = resolveBurnTargetWeightKg({
    weightLatest: { weight_kg: 79, has_logs: false },
    profileWeightKg: 79,
    onboardingWeightKg: 80,
  });
  assert(kg === 79, `expected 79 from profile, got ${kg}`);
}

// Onboarding when no logs and no profile
{
  const kg = resolveBurnTargetWeightKg({
    weightLatest: null,
    profileWeightKg: null,
    onboardingWeightKg: 82,
  });
  assert(kg === 82, `expected 82 from onboarding, got ${kg}`);
}

// Fallback when nothing valid
{
  const kg = resolveBurnTargetWeightKg({
    weightLatest: null,
    profileWeightKg: 0,
    onboardingWeightKg: -1,
  });
  assert(kg === 70, `expected fallback 70, got ${kg}`);
}

// Log preferred over higher profile (Home vs Workout mismatch scenario)
{
  const kg = resolveBurnTargetWeightKg({
    weightLatest: { weight_kg: 74.8, has_logs: true },
    profileWeightKg: 79,
    onboardingWeightKg: 79,
  });
  assert(kg === 74.8, `expected 74.8 from log, got ${kg}`);
}

console.log("resolveBurnTargetWeightKg.test.ts: all assertions passed");
