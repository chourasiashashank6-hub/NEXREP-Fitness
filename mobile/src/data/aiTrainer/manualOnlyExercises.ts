/**
 * Pose-spec and catalog exercises that show "manual logging only" in AI camera mode.
 *
 * Removed/unimplemented checks reference (kept for future work):
 * tempo, bar_drift, lockout_overhead, pull_depth, pull_height, kipping,
 * raise_height, elbow_bend, full_rom, hips_planted, body_line, head_neutral,
 * momentum, rom, wrist_convergence/divergence rep types, shoulder elevation reps.
 */
import { findExerciseSpecEntry, hasPoseSpec } from "./resolvePoseSpec";

/** Pose-spec entries that remain in the library but are not camera-tracked. */
export const MANUAL_ONLY_POSE_SPEC_IDS = new Set([
  "standing_calf_raise",
  "seated_calf_raise",
  "pec_deck_fly",
  "rear_delt_fly",
  "barbell_shrug",
  "straight_arm_pulldown",
  "plank",
  "crunch",
  "bicycle_crunch",
  "hanging_leg_raise",
  "cable_crunch",
  "russian_twist",
  "ab_wheel_rollout",
]);

export const MANUAL_ONLY_FAMILIES = new Set(["calf_raise", "core_hold", "core_flexion"]);

export function isPoseSpecManualOnly(exerciseName?: string | null): boolean {
  const entry = findExerciseSpecEntry(exerciseName);
  if (!entry) return false;
  if (MANUAL_ONLY_POSE_SPEC_IDS.has(entry.id)) return true;
  if (MANUAL_ONLY_FAMILIES.has(entry.family)) return true;
  return false;
}

/** Full AI camera tracking (pose spec resolved and not manual-only). */
export function hasTrackablePoseSpec(exerciseName?: string | null): boolean {
  return hasPoseSpec(exerciseName) && !isPoseSpecManualOnly(exerciseName);
}

/** All pose-spec IDs excluded from camera tracking. */
export function listManualOnlyPoseSpecIds(): string[] {
  return [...MANUAL_ONLY_POSE_SPEC_IDS];
}
