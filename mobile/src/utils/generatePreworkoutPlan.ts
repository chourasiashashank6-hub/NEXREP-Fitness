import warmupCatalog from "../data/warmupExerciseCatalog.json";

export type WarmupPhaseType = "walk" | "run" | "brisk_walk";

export type WarmupPhase = {
  id: string;
  type: WarmupPhaseType;
  label: string;
  duration_sec: number;
  speed_kmh: number;
  incline_pct: number;
  met: number;
};

export type WarmupExercise = {
  name: string;
  cue: string;
  muscleGroup: string;
};

export type PreworkoutProfile = {
  primaryGoal: string | null;
  goalPace: string | null;
  difficulty: string | null;
  weightKg: number;
};

export type CardioPreworkoutPlan = {
  kind: "cardio";
  totalDurationMin: number;
  phases: WarmupPhase[];
  estimatedKcal: number;
  warmupExercises: WarmupExercise[];
};

export type StrengthPreworkoutPlan = {
  kind: "strength";
  rampUpSets: number;
  rampUpMinutesPerSet: number;
  postWorkoutProteinG: number;
  warmupExercises: WarmupExercise[];
};

export type PreworkoutPlan = CardioPreworkoutPlan | StrengthPreworkoutPlan;

type Catalog = Record<string, Array<{ name: string; cue: string }>>;

const CATALOG = warmupCatalog as Catalog;

const MUSCLE_TO_CATALOG_KEY: Record<string, string> = {
  chest: "chest",
  back: "back",
  shoulders: "shoulders",
  arms: "arms",
  legs: "legs",
  glutes: "glutes",
  core: "core",
};

function normalizePace(pace: string | null | undefined): "slow" | "moderate" | "aggressive" {
  const raw = String(pace || "moderate").toLowerCase();
  if (raw === "slow" || raw === "conservative") return "slow";
  if (raw === "aggressive") return "aggressive";
  return "moderate";
}

function normalizeDifficulty(difficulty: string | null | undefined): "beginner" | "intermediate" | "advanced" {
  const raw = String(difficulty || "intermediate").toLowerCase();
  if (raw === "beginner") return "beginner";
  if (raw === "advanced") return "advanced";
  return "intermediate";
}

function totalDurationSec(pace: "slow" | "moderate" | "aggressive"): number {
  if (pace === "slow") return 15 * 60;
  if (pace === "aggressive") return 28 * 60;
  return 20 * 60;
}

function speedProfile(
  pace: "slow" | "moderate" | "aggressive",
  difficulty: "beginner" | "intermediate" | "advanced",
) {
  const walkBase = pace === "slow" ? 4.5 : pace === "aggressive" ? 6.5 : 5.5;
  const runBase = pace === "slow" ? 8 : pace === "aggressive" ? 11 : 9.5;
  const adjust = difficulty === "beginner" ? -1 : difficulty === "advanced" ? 1 : 0;
  const walk = Math.max(3.5, walkBase + adjust);
  const run = Math.max(6, runBase + adjust);
  return { walk, brisk: walk + 1, run };
}

function metForPhase(type: WarmupPhaseType, speedKmh: number): number {
  if (type === "brisk_walk") return 6;
  if (type === "walk") return 4.5;
  if (speedKmh >= 10.5) return 9.5;
  if (speedKmh >= 9) return 9;
  return 8.5;
}

function roundToNearest5(value: number): number {
  return Math.round(value / 5) * 5;
}

function estimateKcal(phases: WarmupPhase[], weightKg: number): number {
  const raw = phases.reduce((sum, phase) => {
    const hours = phase.duration_sec / 3600;
    return sum + phase.met * weightKg * hours;
  }, 0);
  return roundToNearest5(raw);
}

function makePhase(
  type: WarmupPhaseType,
  label: string,
  durationSec: number,
  speedKmh: number,
  inclinePct: number,
): WarmupPhase {
  const duration = Math.max(1, Math.round(durationSec));
  return {
    id: `${type}-${label}-${duration}`,
    type,
    label,
    duration_sec: duration,
    speed_kmh: Math.round(speedKmh * 10) / 10,
    incline_pct: inclinePct,
    met: metForPhase(type, speedKmh),
  };
}

function buildBeginnerPhases(totalSec: number, speeds: ReturnType<typeof speedProfile>): WarmupPhase[] {
  return [makePhase("walk", "Continuous walk", totalSec, speeds.walk, 1)];
}

function buildIntermediatePhases(totalSec: number, speeds: ReturnType<typeof speedProfile>): WarmupPhase[] {
  const walkSec = Math.round(totalSec * 0.25);
  const runSec = Math.round(totalSec * 0.5);
  const briskSec = totalSec - walkSec - runSec;
  return [
    makePhase("walk", "Warm-up walk", walkSec, speeds.walk, 1),
    makePhase("run", "Run", runSec, speeds.run, 1),
    makePhase("brisk_walk", "Brisk walk", briskSec, speeds.brisk, 2),
  ];
}

function buildAdvancedPhases(totalSec: number, speeds: ReturnType<typeof speedProfile>): WarmupPhase[] {
  const warmupSec = Math.round(totalSec * 0.15);
  const cooldownSec = Math.round(totalSec * 0.15);
  let budget = totalSec - warmupSec - cooldownSec;
  const phases: WarmupPhase[] = [makePhase("walk", "Warm-up walk", warmupSec, speeds.walk, 1)];

  while (budget >= 180) {
    phases.push(makePhase("run", "Run interval", 120, speeds.run, 1));
    budget -= 120;
    phases.push(makePhase("walk", "Recovery walk", 60, speeds.walk, 1));
    budget -= 60;
  }

  if (budget >= 120) {
    phases.push(makePhase("run", "Run interval", 120, speeds.run, 1));
    budget -= 120;
  } else if (budget >= 60) {
    phases.push(makePhase("walk", "Recovery walk", budget, speeds.walk, 1));
    budget = 0;
  }

  if (budget > 0) {
    phases.push(makePhase("walk", "Steady walk", budget, speeds.walk, 1));
  }

  phases.push(makePhase("brisk_walk", "Cooldown", cooldownSec, speeds.brisk, 2));
  return phases;
}

export function resolveDayMuscles(focusMuscles: string[], splitName = ""): string[] {
  if (focusMuscles.length > 0) return focusMuscles;
  const split = splitName.toLowerCase();
  if (split.includes("push")) return ["Chest", "Shoulders", "Arms"];
  if (split.includes("pull")) return ["Back", "Arms"];
  if (split.includes("leg")) return ["Legs", "Core"];
  return ["Core", "Legs"];
}

export function selectWarmupExercises(dayMuscles: string[]): WarmupExercise[] {
  const muscles = resolveDayMuscles(dayMuscles);
  const picked: WarmupExercise[] = [];
  const usedNames = new Set<string>();

  const addFromGroup = (muscle: string, index = 0) => {
    const key = MUSCLE_TO_CATALOG_KEY[muscle.toLowerCase()];
    if (!key) return;
    const entries = CATALOG[key] ?? [];
    const entry = entries[index];
    if (!entry || usedNames.has(entry.name)) return;
    usedNames.add(entry.name);
    picked.push({ name: entry.name, cue: entry.cue, muscleGroup: muscle });
  };

  for (const muscle of muscles) {
    addFromGroup(muscle, 0);
    if (picked.length >= 3) break;
  }

  if (picked.length < 3) {
    for (const muscle of muscles) {
      addFromGroup(muscle, 1);
      if (picked.length >= 3) break;
      addFromGroup(muscle, 2);
      if (picked.length >= 3) break;
    }
  }

  if (picked.length < 3) {
    for (const key of Object.keys(CATALOG)) {
      const entries = CATALOG[key] ?? [];
      for (const entry of entries) {
        if (picked.length >= 3) break;
        if (usedNames.has(entry.name)) continue;
        usedNames.add(entry.name);
        picked.push({ name: entry.name, cue: entry.cue, muscleGroup: key });
      }
    }
  }

  return picked.slice(0, 3);
}

function rampUpSetsForPace(pace: "slow" | "moderate" | "aggressive"): number {
  if (pace === "slow") return 2;
  if (pace === "aggressive") return 4;
  return 3;
}

/** Goals that get the treadmill cardio program (phases + optional guided session). */
export const CARDIO_GOALS = ["fat_loss", "endurance"] as const;

/** Goals that get ramp-up sets + post-workout protein (muscle_gain, strength, recomp, maintain, etc.). */
export const STRENGTH_STYLE_GOALS = ["strength", "muscle_gain", "recomp", "maintain"] as const;

function normalizePrimaryGoal(primaryGoal: string | null | undefined): string {
  return String(primaryGoal || "").toLowerCase().trim();
}

export function isCardioGoal(primaryGoal: string | null | undefined): boolean {
  return (CARDIO_GOALS as readonly string[]).includes(normalizePrimaryGoal(primaryGoal));
}

export function generatePreworkoutPlan(profile: PreworkoutProfile, dayMuscleFocus: string[]): PreworkoutPlan {
  const pace = normalizePace(profile.goalPace);
  const difficulty = normalizeDifficulty(profile.difficulty);
  const weightKg = Math.max(40, profile.weightKg || 70);
  const warmupExercises = selectWarmupExercises(dayMuscleFocus);

  if (isCardioGoal(profile.primaryGoal)) {
    const totalSec = totalDurationSec(pace);
    const speeds = speedProfile(pace, difficulty);
    const phases =
      difficulty === "beginner"
        ? buildBeginnerPhases(totalSec, speeds)
        : difficulty === "advanced"
          ? buildAdvancedPhases(totalSec, speeds)
          : buildIntermediatePhases(totalSec, speeds);

    return {
      kind: "cardio",
      totalDurationMin: Math.round(totalSec / 60),
      phases,
      estimatedKcal: estimateKcal(phases, weightKg),
      warmupExercises,
    };
  }

  // muscle_gain, strength, recomp, maintain, and any unrecognized goal → ramp-up + protein
  return {
    kind: "strength",
    rampUpSets: rampUpSetsForPace(pace),
    rampUpMinutesPerSet: 3,
    postWorkoutProteinG: roundToNearest5(weightKg * 0.4),
    warmupExercises,
  };
}

export function phaseDurationTotalSec(phases: WarmupPhase[]): number {
  return phases.reduce((sum, phase) => sum + phase.duration_sec, 0);
}
