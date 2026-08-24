/** Matches `/api/weight/latest` and server goal-progress weight priority. */
export type WeightLatestSnapshot = {
  weight_kg?: number;
  has_logs?: boolean;
};

const DEFAULT_FALLBACK_KG = 70;

function positiveKg(value: unknown): number | null {
  const kg = Number(value);
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

/**
 * Resolve body weight for planned burn targets (warm-up + session estimates).
 *
 * Priority (same as server `/goal-progress`):
 * 1. Latest weight log when `has_logs` is true
 * 2. Profile weight (`users.weight` / `getProfile().weight`)
 * 3. Onboarding `personal.weight_kg`
 * 4. Fallback (70 kg)
 */
export function resolveBurnTargetWeightKg(opts: {
  weightLatest?: WeightLatestSnapshot | null;
  profileWeightKg?: number | null;
  onboardingWeightKg?: number | null;
  fallbackKg?: number;
}): number {
  const fallback = positiveKg(opts.fallbackKg) ?? DEFAULT_FALLBACK_KG;

  if (opts.weightLatest?.has_logs) {
    const logKg = positiveKg(opts.weightLatest.weight_kg);
    if (logKg != null) return logKg;
  }

  const profileKg = positiveKg(opts.profileWeightKg);
  if (profileKg != null) return profileKg;

  const onboardingKg = positiveKg(opts.onboardingWeightKg);
  if (onboardingKg != null) return onboardingKg;

  return fallback;
}
