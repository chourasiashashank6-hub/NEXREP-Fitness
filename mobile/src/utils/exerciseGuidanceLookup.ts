import {
  EXERCISE_GUIDANCE,
  type ExerciseGuidance,
} from "../constants/ExerciseGuidanceData";

const SELECT_PLACEHOLDERS = new Set([
  "select choice",
  "default",
  "no choice",
  "none",
  "",
]);

export function normalizeExerciseName(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findExerciseGuidance(exerciseName?: string): ExerciseGuidance | null {
  const normalizedTarget = normalizeExerciseName(exerciseName);
  if (!normalizedTarget || SELECT_PLACEHOLDERS.has(normalizedTarget)) {
    return null;
  }
  const exact = EXERCISE_GUIDANCE.find(
    (record) => normalizeExerciseName(record.exerciseName) === normalizedTarget,
  );
  if (exact) return exact;
  const partial = EXERCISE_GUIDANCE.find((record) => {
    const candidate = normalizeExerciseName(record.exerciseName);
    return (
      candidate &&
      (candidate.includes(normalizedTarget) || normalizedTarget.includes(candidate))
    );
  });
  return partial || null;
}

/** Short coaching cue for in-session display — prefers form cues, then pro tip. */
export function getExerciseCoachCue(exerciseName?: string): string | null {
  const guidance = findExerciseGuidance(exerciseName);
  if (!guidance) return null;
  const cue = guidance.formCues?.trim() || guidance.proTip?.trim();
  return cue || null;
}
