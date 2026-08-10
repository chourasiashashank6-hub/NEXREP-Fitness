import familyTemplates from "./familyTemplates.json";
import exerciseSpecs from "./exerciseSpecs.json";
import machineProfiles from "./machineProfiles.json";
import type {
  ExerciseSpecEntry,
  FamilyTemplate,
  MachineProfile,
  PoseCalibration,
  PoseCheck,
  ResolvedPoseSpec,
  TrainerView,
} from "./types";
import { DEFAULT_POSE_CALIBRATION } from "./types";
import { computePersonalizedDepthTarget } from "../../utils/calibrationMerge";

const families = familyTemplates as Record<string, FamilyTemplate>;
const specs = exerciseSpecs as ExerciseSpecEntry[];
const machines = machineProfiles as Record<string, MachineProfile>;

function normalizeKey(name?: string | null): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function scoreMatch(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  if (candidate.includes(query) || query.includes(candidate)) return 0.92;
  const qt = new Set(query.split(" ").filter(Boolean));
  const ct = new Set(candidate.split(" ").filter(Boolean));
  if (!qt.size || !ct.size) return 0;
  let shared = 0;
  for (const t of qt) if (ct.has(t)) shared += 1;
  if (!shared) return 0;
  return shared / new Set([...qt, ...ct]).size;
}

export function findExerciseSpecEntry(exerciseName?: string | null): ExerciseSpecEntry | null {
  const key = normalizeKey(exerciseName);
  if (!key) return null;

  for (const spec of specs) {
    if (normalizeKey(spec.id.replace(/_/g, " ")) === key) return spec;
    const aliases = spec.aliases || [];
    if (aliases.some((a) => normalizeKey(a) === key)) return spec;
  }

  let best: ExerciseSpecEntry | null = null;
  let bestScore = 0;
  for (const spec of specs) {
    const candidates = [spec.id.replace(/_/g, " "), ...(spec.aliases || [])];
    for (const c of candidates) {
      const s = scoreMatch(key, normalizeKey(c));
      if (s > bestScore) {
        bestScore = s;
        best = spec;
      }
    }
  }
  return bestScore >= 0.72 ? best : null;
}

function applyOverrides(
  family: FamilyTemplate,
  entry: ExerciseSpecEntry,
): Omit<ResolvedPoseSpec, "id" | "family" | "machineProfileId" | "machineProfile"> {
  const ov = entry.overrides || {};
  let view = (typeof ov.view === "string" ? ov.view : family.view) as TrainerView;
  let repJoint =
    typeof ov.repJoint === "string" ? ov.repJoint : family.repJoint;
  let repRule = { ...family.repRule };
  if (ov.repRule && typeof ov.repRule === "object") {
    repRule = { ...repRule, ...(ov.repRule as Record<string, unknown>) };
  }

  let checks: PoseCheck[] = family.checks.map((c) => ({ ...c }));

  // Per-check rule string overrides keyed like "torso_lean.rule"
  for (const [k, v] of Object.entries(ov)) {
    const m = /^([a-z0-9_]+)\.rule$/.exec(k);
    if (m && typeof v === "string") {
      checks = checks.map((c) => (c.id === m[1] ? { ...c, rule: v } : c));
    }
  }

  const disable = Array.isArray(ov.disable) ? (ov.disable as string[]) : [];
  if (disable.length) {
    checks = checks.filter((c) => !disable.includes(c.id));
  }

  if (Array.isArray(ov.add)) {
    checks = [...checks, ...(ov.add as PoseCheck[])];
  }

  if (typeof ov.kneeCap === "number") {
    checks = checks.map((c) =>
      c.id === "knee_bend_cap"
        ? { ...c, rule: `kneeAngle >= ${ov.kneeCap}` }
        : c,
    );
  }

  return {
    view,
    repJoint,
    repRule,
    checks,
    note: typeof ov.note === "string" ? ov.note : undefined,
  };
}

/** Merge family template + exercise overrides + machine occlusion disables. */
export function resolvePoseSpec(exerciseName?: string | null): ResolvedPoseSpec | null {
  const entry = findExerciseSpecEntry(exerciseName);
  if (!entry) return null;
  const family = families[entry.family];
  if (!family) return null;

  const machineId = entry.machineProfile || null;
  const machine = machineId ? machines[machineId] || null : null;
  const base = applyOverrides(family, entry);

  let checks = base.checks;
  if (machine?.disabledCheckIds?.length) {
    const blocked = new Set(machine.disabledCheckIds);
    checks = checks.filter((c) => !blocked.has(c.id));
  }

  return {
    id: entry.id,
    family: entry.family,
    machineProfileId: machineId,
    machineProfile: machine,
    ...base,
    checks,
  };
}

export function hasPoseSpec(exerciseName?: string | null): boolean {
  return resolvePoseSpec(exerciseName) != null;
}

/** Families that use calibrated squat depth for rep bottom / depth checks. */
const DEPTH_CALIBRATED_FAMILIES = new Set(["squat_lunge"]);

/** Remap calibrated depth / mobility into a resolved spec (squat/lunge only). */
export function remapSpecWithCalibration(
  spec: ResolvedPoseSpec,
  calibration: PoseCalibration | null | undefined,
): ResolvedPoseSpec {
  if (!DEPTH_CALIBRATED_FAMILIES.has(spec.family)) {
    return spec;
  }
  const entry = findExerciseSpecEntry(spec.id.replace(/_/g, " "));
  const explicitBottom =
    entry?.overrides?.repRule &&
    typeof entry.overrides.repRule === "object" &&
    typeof (entry.overrides.repRule as Record<string, unknown>).bottomAngle === "number"
      ? ((entry.overrides.repRule as Record<string, unknown>).bottomAngle as number)
      : null;

  const cal = calibration?.torsoLen ? calibration : DEFAULT_POSE_CALIBRATION;
  const standing = cal.standingKneeDeg ?? 168;
  const squatRaw = cal.squatDepthDeg ?? cal.mobility.depthTargetDeg ?? 95;
  const depth = computePersonalizedDepthTarget(squatRaw, standing);
  const effectiveBottom = explicitBottom ?? depth;
  const checks = spec.checks.map((c) => {
    if (c.id === "depth" || c.calibrated) {
      const limited = effectiveBottom >= 100;
      return {
        ...c,
        rule: `kneeAngle at bottom <= ${effectiveBottom}`,
        cue: limited ? "cue_full_range_ok" : c.cue,
      };
    }
    return c;
  });
  return {
    ...spec,
    checks,
    repRule: {
      ...spec.repRule,
      bottomAngle: effectiveBottom,
    },
    // WebView session runtime reads this for depth/ROM checks
    _depthTargetDeg: explicitBottom == null ? depth : undefined,
  } as ResolvedPoseSpec & { _depthTargetDeg?: number };
}

export function listPoseSpecIds(): string[] {
  return specs.map((s) => s.id);
}

export function getMachineProfile(id?: string | null): MachineProfile | null {
  if (!id) return null;
  return machines[id] || null;
}
