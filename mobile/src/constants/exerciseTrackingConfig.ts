/**
 * AI camera / pose tracking eligibility.
 *
 * Source of truth: MediaPipeExercisesData.json (same catalog the camera uses).
 * Seed overrides below are optional preferred configs for a few common moves.
 *
 * An exercise is trackable when we can resolve movement thresholds — either from
 * a matched MediaPipe record or the same name heuristics MediaPipeGuidanceView uses.
 */
import { isPoseSpecManualOnly, MANUAL_ONLY_POSE_SPEC_IDS, hasTrackablePoseSpec } from "../data/aiTrainer/manualOnlyExercises";

export type TrackingPrimaryJoint = "elbow" | "knee" | "hip" | "shoulder" | "ankle";

export interface ExerciseTrackingConfig {
  canonicalId: string;
  displayName: string;
  aliases: string[];
  primaryJoint: TrackingPrimaryJoint;
  downThreshold: number;
  upThreshold: number;
  downWhenAngleIsLower: boolean;
  formGoodMin: number;
  formGoodMax: number;
  correctionCue: string;
  /** Matched MediaPipe catalog name when resolved from JSON. */
  mediaPipeName?: string;
}

type MediaPipeMovementConfig = {
  primaryJoint?: string | null;
  downThreshold?: number | null;
  upThreshold?: number | null;
  downWhenAngleIsLower?: boolean | null;
};

type MediaPipeRecord = {
  exerciseName?: string;
  movementFamily?: string;
  movementConfig?: MediaPipeMovementConfig | null;
  trainerChecks?: { notes?: string };
  exerciseRule?: {
    joints?: Array<{ min?: number; max?: number }>;
  } | null;
};

/** Optional preferred configs (canonical IDs). Catalog match wins for trackability either way. */
const SEED_OVERRIDES: ExerciseTrackingConfig[] = [
  {
    canonicalId: "squat",
    displayName: "Squat",
    aliases: ["squat", "bodyweight squat", "barbell squat", "back squat", "goblet squat", "front squat"],
    primaryJoint: "knee",
    downThreshold: 105,
    upThreshold: 155,
    downWhenAngleIsLower: true,
    formGoodMin: 70,
    formGoodMax: 175,
    correctionCue: "Sink hips deeper and keep knees tracking over toes",
  },
  {
    canonicalId: "push_up",
    displayName: "Push-Up",
    aliases: ["push up", "pushup", "knee push up", "diamond push up"],
    primaryJoint: "elbow",
    downThreshold: 95,
    upThreshold: 155,
    downWhenAngleIsLower: true,
    formGoodMin: 70,
    formGoodMax: 175,
    correctionCue: "Lower chest toward the floor with elbows ~45° from torso",
  },
  {
    canonicalId: "bicep_curl",
    displayName: "Bicep Curl",
    aliases: ["bicep curl", "biceps curl", "dumbbell curl", "barbell curl", "hammer curl"],
    primaryJoint: "elbow",
    downThreshold: 155,
    upThreshold: 70,
    downWhenAngleIsLower: false,
    formGoodMin: 25,
    formGoodMax: 175,
    correctionCue: "Keep elbows pinned and curl fully without swinging",
  },
  {
    canonicalId: "overhead_press",
    displayName: "Overhead Press",
    aliases: [
      "overhead press",
      "shoulder press",
      "dumbbell shoulder press",
      "military press",
      "seated dumbbell press",
      "arnold press",
    ],
    primaryJoint: "elbow",
    downThreshold: 95,
    upThreshold: 150,
    downWhenAngleIsLower: true,
    formGoodMin: 70,
    formGoodMax: 180,
    correctionCue: "Press straight up — avoid flaring elbows excessively",
  },
];

const EQUIPMENT_TOKENS = new Set([
  "dumbbell",
  "dumbbells",
  "barbell",
  "cable",
  "machine",
  "smith",
  "ez",
  "kettlebell",
  "band",
  "banded",
  "resistance",
  "weighted",
  "bodyweight",
]);

const NOISE_TOKENS = new Set(["a", "an", "the", "with", "and", "to", "of", "for"]);

let cachedRecords: MediaPipeRecord[] | null = null;

function getMediaPipeRecords(): MediaPipeRecord[] {
  if (cachedRecords) return cachedRecords;
  try {
    const data = require("./MediaPipeExercisesData.json") as { records?: MediaPipeRecord[] };
    cachedRecords = Array.isArray(data?.records) ? data.records : [];
  } catch {
    cachedRecords = [];
  }
  return cachedRecords;
}

export function normalizeExerciseKey(name?: string | null): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(name: string): string[] {
  return normalizeExerciseKey(name)
    .split(" ")
    .filter((t) => t && !NOISE_TOKENS.has(t));
}

/** Drop equipment words so "Incline Dumbbell Press" ≈ "Incline Bench Press". */
function coreTokens(name: string): string[] {
  return tokens(name).filter((t) => !EQUIPMENT_TOKENS.has(t));
}

function containsAny(name: string, terms: string[]): boolean {
  return terms.some((t) => name.includes(t));
}

function isCardioOrMobility(record: MediaPipeRecord | null, name: string): boolean {
  if (record?.movementFamily === "cardio_or_mobility") return true;
  return containsAny(name, [
    "treadmill",
    "cycling",
    "elliptical",
    "rowing machine",
    "stationary",
    "brisk walking",
    "outdoor cycling",
    "stair climbing",
    "skipping",
    "shadow boxing",
    "agility ladder",
    "lateral shuffle",
    "carioca",
    "hurdle drill",
    "sprint drill",
    "reactive cone",
    "resisted sprint",
    "wall drill",
    "cat cow",
    "inchworm",
    "hip 90",
    "hip circle",
    "ankle rotation",
    "arm circle",
    "neck roll",
    "shoulder roll",
    "leg swing",
    "thoracic",
    "torso twist",
    "plank to downward",
    "band resisted hip",
    "banded pull apart",
  ]);
}

function scoreNameMatch(query: string, candidate: string): number {
  const q = normalizeExerciseKey(query);
  const c = normalizeExerciseKey(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.92;

  const qt = new Set(coreTokens(q));
  const ct = new Set(coreTokens(c));
  if (qt.size === 0 || ct.size === 0) return 0;
  let shared = 0;
  for (const t of qt) if (ct.has(t)) shared += 1;
  const jaccard = shared / new Set([...qt, ...ct]).size;
  // Require at least one shared non-equipment token and decent overlap
  if (shared === 0) return 0;
  return jaccard;
}

function findMediaPipeRecord(exerciseName?: string | null): MediaPipeRecord | null {
  const key = normalizeExerciseKey(exerciseName);
  if (!key) return null;
  const records = getMediaPipeRecords();

  const exact = records.find((r) => normalizeExerciseKey(r.exerciseName) === key);
  if (exact) return exact;

  let best: MediaPipeRecord | null = null;
  let bestScore = 0;
  for (const r of records) {
    const name = r.exerciseName || "";
    const score = scoreNameMatch(key, name);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  // 0.5 ≈ two of three core tokens (e.g. incline + press)
  return bestScore >= 0.5 ? best : null;
}

function movementFromRecord(record: MediaPipeRecord | null): {
  primaryJoint: TrackingPrimaryJoint;
  downThreshold: number;
  upThreshold: number;
  downWhenAngleIsLower: boolean;
} | null {
  const raw = record?.movementConfig;
  const joint = String(raw?.primaryJoint || "").trim().toLowerCase();
  const allowed =
    joint === "elbow" || joint === "knee" || joint === "hip" || joint === "shoulder" || joint === "ankle";
  if (
    allowed &&
    typeof raw?.downThreshold === "number" &&
    typeof raw?.upThreshold === "number" &&
    typeof raw?.downWhenAngleIsLower === "boolean"
  ) {
    return {
      primaryJoint: joint as TrackingPrimaryJoint,
      downThreshold: raw.downThreshold,
      upThreshold: raw.upThreshold,
      downWhenAngleIsLower: raw.downWhenAngleIsLower,
    };
  }
  return null;
}

/** Same heuristics as MediaPipeGuidanceView.toMovementConfig name fallbacks. */
function movementFromNameHeuristics(exerciseName?: string | null): {
  primaryJoint: TrackingPrimaryJoint;
  downThreshold: number;
  upThreshold: number;
  downWhenAngleIsLower: boolean;
} | null {
  const name = normalizeExerciseKey(exerciseName);
  if (!name) return null;
  if (containsAny(name, ["curl", "hammer", "preacher", "zottman", "spider", "barbell 21s"])) {
    return { primaryJoint: "elbow", downThreshold: 155, upThreshold: 70, downWhenAngleIsLower: false };
  }
  if (containsAny(name, ["tricep", "triceps", "pushdown", "kickback", "skull crusher"])) {
    return { primaryJoint: "elbow", downThreshold: 75, upThreshold: 150, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["squat", "lunge", "step up", "wall sit", "jump squat", "pistol", "leg press"])) {
    return { primaryJoint: "knee", downThreshold: 105, upThreshold: 155, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["deadlift", "romanian", "rack pull", "hip thrust", "glute bridge", "swing"])) {
    return { primaryJoint: "hip", downThreshold: 110, upThreshold: 165, downWhenAngleIsLower: true };
  }
  // Incline / flat / decline presses without the literal "bench press" phrase
  if (
    containsAny(name, [
      "push up",
      "bench press",
      "chest press",
      "dumbbell press",
      "incline press",
      "decline press",
      "floor press",
      "dip",
      "chest fly",
      "pec deck",
    ])
  ) {
    return { primaryJoint: "elbow", downThreshold: 95, upThreshold: 155, downWhenAngleIsLower: true };
  }
  if (
    containsAny(name, [
      "shoulder press",
      "arnold press",
      "overhead press",
      "push press",
      "thruster",
      "z press",
      "clean and press",
    ])
  ) {
    return { primaryJoint: "elbow", downThreshold: 95, upThreshold: 150, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["row", "pulldown", "pull up", "chin up", "muscle up", "face pull", "rear delt fly"])) {
    return { primaryJoint: "elbow", downThreshold: 70, upThreshold: 150, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["calf raise", "tibialis raise", "calf jump"])) {
    return { primaryJoint: "ankle", downThreshold: 150, upThreshold: 175, downWhenAngleIsLower: true };
  }
  if (containsAny(name, ["burpee", "mountain climber", "jumping jack", "tuck jump", "box jump", "depth jump"])) {
    return { primaryJoint: "knee", downThreshold: 95, upThreshold: 165, downWhenAngleIsLower: true };
  }
  return null;
}

function formRangeFromRecord(
  record: MediaPipeRecord | null,
  movement: { downThreshold: number; upThreshold: number },
): { formGoodMin: number; formGoodMax: number } {
  const joints = record?.exerciseRule?.joints || [];
  const mins = joints.map((j) => j.min).filter((n): n is number => typeof n === "number");
  const maxs = joints.map((j) => j.max).filter((n): n is number => typeof n === "number");
  if (mins.length && maxs.length) {
    return { formGoodMin: Math.min(...mins), formGoodMax: Math.max(...maxs) };
  }
  const lo = Math.min(movement.downThreshold, movement.upThreshold);
  const hi = Math.max(movement.downThreshold, movement.upThreshold);
  return { formGoodMin: Math.max(10, lo - 25), formGoodMax: Math.min(180, hi + 25) };
}

function slugFromName(name: string): string {
  return normalizeExerciseKey(name).replace(/\s+/g, "_") || "exercise";
}

function findSeedOverride(key: string): ExerciseTrackingConfig | null {
  for (const cfg of SEED_OVERRIDES) {
    if (cfg.canonicalId === key) return cfg;
    if (cfg.aliases.some((a) => a === key || key.includes(a) || a.includes(key))) return cfg;
  }
  return null;
}

/** Resolve tracking config from a planner exercise name or canonical ID. */
export function getExerciseTrackingConfig(
  exerciseNameOrId?: string | null,
): ExerciseTrackingConfig | null {
  const key = normalizeExerciseKey(exerciseNameOrId);
  if (!key) return null;

  const seed = findSeedOverride(key);
  const record = findMediaPipeRecord(exerciseNameOrId);
  if (isCardioOrMobility(record, key)) return null;

  const fromRecord = movementFromRecord(record);
  const fromHeuristic = movementFromNameHeuristics(exerciseNameOrId);
  const movement = fromRecord || fromHeuristic;
  if (!movement) return null;

  // Prefer seed thresholds when the planner name clearly maps to a seed alias
  if (seed) {
    return {
      ...seed,
      mediaPipeName: record?.exerciseName,
    };
  }

  const form = formRangeFromRecord(record, movement);
  const displayName = record?.exerciseName || exerciseNameOrId || "Exercise";
  return {
    canonicalId: slugFromName(displayName),
    displayName,
    aliases: [normalizeExerciseKey(displayName)],
    ...movement,
    ...form,
    correctionCue: String(record?.trainerChecks?.notes || "").trim() || "Maintain controlled form",
    mediaPipeName: record?.exerciseName,
  };
}

export function isExerciseTrackable(exerciseNameOrId?: string | null): boolean {
  if (isPoseSpecManualOnly(exerciseNameOrId)) return false;
  return getExerciseTrackingConfig(exerciseNameOrId) != null;
}

/** Whether AI camera session should run pose or legacy movement tracking. */
export function isCameraExerciseTrackable(exerciseNameOrId?: string | null): boolean {
  if (isPoseSpecManualOnly(exerciseNameOrId)) return false;
  if (hasTrackablePoseSpec(exerciseNameOrId)) return true;
  return getExerciseTrackingConfig(exerciseNameOrId) != null;
}

/** Exercises that resolve a pose spec but are manual-logging only in AI camera mode. */
export function listManualOnlyPoseSpecIds(): string[] {
  return [...MANUAL_ONLY_POSE_SPEC_IDS];
}

export function listTrackableExerciseIds(): string[] {
  return getMediaPipeRecords()
    .filter((r) => {
      const name = normalizeExerciseKey(r.exerciseName);
      if (!name || isCardioOrMobility(r, name)) return false;
      return movementFromRecord(r) != null || movementFromNameHeuristics(r.exerciseName) != null;
    })
    .map((r) => slugFromName(r.exerciseName || ""));
}
