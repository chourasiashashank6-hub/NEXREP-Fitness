import type { WorkoutExercise } from "../types/planner";

/** Hard ceiling for exercises on a single plan day after Smart Reflow additions. */
export const REFLOW_MAX_EXERCISES_PER_DAY = 8;

const LEG_MUSCLES = ["legs", "quads", "hamstrings", "glutes", "calves"];
const PUSH_MUSCLES = ["chest", "shoulders", "triceps"];
const PULL_MUSCLES = ["back", "biceps", "rear delts", "lats"];
const UPPER_MUSCLES = [...PUSH_MUSCLES, ...PULL_MUSCLES, "arms"];

type SplitFamily = "push" | "pull" | "legs" | "upper" | "full_body" | "unknown";

export type ReflowDayFocus = {
  split_name: string;
  focus_muscles: string[];
};

/** Mirror server `_focus_muscles_for_split` — used when a day has no stored focus list. */
export function focusMusclesForSplit(splitName: string): string[] {
  const name = splitName.toLowerCase();
  if (name.includes("push")) return ["Chest", "Shoulders", "Triceps"];
  if (name.includes("pull")) return ["Back", "Biceps", "Rear Delts"];
  if (name.includes("leg") || name.includes("lower")) return ["Quads", "Hamstrings", "Glutes", "Calves"];
  if (name.includes("upper")) return ["Chest", "Back", "Shoulders", "Arms"];
  if (name.includes("full body") || name.includes("full-body")) return ["Full Body"];
  return ["Chest", "Shoulders", "Triceps"];
}

export function resolveDayFocusMuscles(day: ReflowDayFocus): string[] {
  if (day.focus_muscles?.length) return day.focus_muscles;
  return focusMusclesForSplit(day.split_name);
}

function splitFamily(splitName: string): SplitFamily {
  const name = splitName.toLowerCase();
  if (name.includes("push")) return "push";
  if (name.includes("pull")) return "pull";
  if (name.includes("leg") || name.includes("lower")) return "legs";
  if (name.includes("upper")) return "upper";
  if (name.includes("full body") || name.includes("full-body")) return "full_body";
  return "unknown";
}

function normalizeMuscle(value: string): string {
  return value.trim().toLowerCase();
}

function muscleMatchesAny(exerciseMuscle: string, candidates: string[]): boolean {
  const ex = normalizeMuscle(exerciseMuscle);
  if (!ex) return false;
  return candidates.some((candidate) => {
    const focus = normalizeMuscle(candidate);
    if (!focus) return false;
    if (ex === focus || ex.includes(focus) || focus.includes(ex)) return true;
    if (focus === "legs" && LEG_MUSCLES.some((leg) => ex.includes(leg) || leg.includes(ex))) return true;
    if (focus === "arms" && (ex.includes("bicep") || ex.includes("tricep") || ex === "arms")) return true;
    return false;
  });
}

function exerciseMatchesSplitFamily(exerciseMuscle: string, family: SplitFamily): boolean {
  const ex = normalizeMuscle(exerciseMuscle);
  if (!ex) return false;
  if (family === "full_body") return true;
  if (family === "legs") return LEG_MUSCLES.some((leg) => ex.includes(leg) || leg.includes(ex));
  if (family === "push") return PUSH_MUSCLES.some((muscle) => ex.includes(muscle) || muscle.includes(ex));
  if (family === "pull") return PULL_MUSCLES.some((muscle) => ex.includes(muscle) || muscle.includes(ex));
  if (family === "upper") {
    return (
      UPPER_MUSCLES.some((muscle) => ex.includes(muscle) || muscle.includes(ex)) &&
      !LEG_MUSCLES.some((leg) => ex.includes(leg) || leg.includes(ex))
    );
  }
  return false;
}

/** True when an exercise belongs on the target day's planned muscle focus. */
export function isExerciseCompatibleWithDay(exercise: WorkoutExercise, day: ReflowDayFocus): boolean {
  const focus = resolveDayFocusMuscles(day);
  if (focus.some((muscle) => normalizeMuscle(muscle) === "full body")) return true;
  if (muscleMatchesAny(exercise.muscle, focus)) return true;

  const family = splitFamily(day.split_name);
  if (family !== "unknown") {
    return exerciseMatchesSplitFamily(exercise.muscle, family);
  }

  return muscleMatchesAny(exercise.muscle, focus);
}

export function remainingReflowSlots(currentExerciseCount: number): number {
  return Math.max(0, REFLOW_MAX_EXERCISES_PER_DAY - currentExerciseCount);
}
