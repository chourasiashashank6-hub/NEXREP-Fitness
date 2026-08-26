import { GLOBAL_EXERCISES, type GlobalExercise } from "../constants/GlobalExercisesData";
import { inferMusclesFromWorkout, musclesFromBodyPart } from "./workoutMuscleInfer";

export const COACH_MUSCLES = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"] as const;
export type CoachMuscle = (typeof COACH_MUSCLES)[number];

const COACH_MUSCLE_SET = new Set<string>(COACH_MUSCLES);

function findGlobalExercise(exerciseName: string): GlobalExercise | undefined {
  const key = exerciseName.trim().toLowerCase();
  if (!key) return undefined;
  const exact = GLOBAL_EXERCISES.find((ex) => ex.name.trim().toLowerCase() === key);
  if (exact) return exact;
  const aliasMatch = GLOBAL_EXERCISES.find((ex) =>
    ex.aliases.some((alias) => alias.trim().toLowerCase() === key),
  );
  if (aliasMatch) return aliasMatch;

  const partialMatches = GLOBAL_EXERCISES.filter((exercise) => {
    const catalogName = exercise.name.trim().toLowerCase();
    return catalogName.includes(key) || key.includes(catalogName);
  });
  return partialMatches.length === 1 ? partialMatches[0] : undefined;
}

function mapAnatomicalMuscle(muscle: string): CoachMuscle[] {
  const m = muscle.toLowerCase();
  const out: CoachMuscle[] = [];
  if (m.includes("pectoral") || m.includes("chest")) out.push("Chest");
  if (m.includes("deltoid") || m.includes("shoulder")) out.push("Shoulders");
  if (m.includes("tricep")) out.push("Triceps");
  if (m.includes("bicep")) out.push("Biceps");
  if (
    m.includes("lat") ||
    m.includes("rhomboid") ||
    m.includes("erector") ||
    m.includes("trap") ||
    m.includes("back")
  ) {
    out.push("Back");
  }
  if (
    m.includes("glute") ||
    m.includes("hamstring") ||
    m.includes("quad") ||
    m.includes("leg") ||
    m.includes("calf") ||
    m.includes("adductor")
  ) {
    out.push("Legs");
  }
  return out;
}

function addCoachMuscles(target: Set<CoachMuscle>, muscles: string[]) {
  for (const muscle of muscles) {
    if (COACH_MUSCLE_SET.has(muscle)) {
      target.add(muscle as CoachMuscle);
    }
  }
}

/**
 * Resolve coach muscle-group chips for an exercise.
 * Uses GlobalExercises catalog first (more precise than server body_part inference),
 * then planner muscle label, then workout-name heuristics.
 */
export function resolveExerciseCoachMuscles(
  exerciseName: string,
  plannerMuscle?: string | null,
): CoachMuscle[] {
  const out = new Set<CoachMuscle>();
  const exercise = findGlobalExercise(exerciseName);

  if (exercise) {
    addCoachMuscles(out, musclesFromBodyPart(exercise.body_part));
    for (const muscle of [...exercise.muscles_primary, ...exercise.muscles_secondary]) {
      for (const mapped of mapAnatomicalMuscle(muscle)) {
        out.add(mapped);
      }
    }
  }

  if (plannerMuscle) {
    addCoachMuscles(out, musclesFromBodyPart(plannerMuscle));
  }

  if (out.size === 0) {
    addCoachMuscles(
      out,
      inferMusclesFromWorkout({
        exerciseName,
        type: "",
        notes: null,
        bodyPart: plannerMuscle ?? null,
      }),
    );
  }

  return COACH_MUSCLES.filter((muscle) => out.has(muscle));
}
