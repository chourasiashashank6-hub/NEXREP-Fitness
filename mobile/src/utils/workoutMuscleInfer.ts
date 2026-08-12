import type { WorkoutHistoryItem } from "../api/workout";

const BASE_MUSCLES = new Set(["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"]);

export function parseBodyPartFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/body_part=([^;]+)/i);
  return m?.[1]?.trim() || null;
}

/** Parse server workout timestamps — naive ISO values are UTC (same as Home / planner sync). */
export function parseWorkoutTimestamp(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized =
    /^\d{4}-\d{2}-\d{2}T/.test(raw) && !/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? `${raw}Z` : raw;
  const ts = new Date(normalized).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Mirror server `_muscles_from_body_part` — notes/catalog body_part → muscle groups. */
export function musclesFromBodyPart(bodyPart: string | null | undefined): string[] {
  if (!bodyPart) return [];
  const lowered = bodyPart.trim().toLowerCase();
  const out: string[] = [];
  if (lowered.includes("chest")) out.push("Chest");
  if (lowered.includes("shoulder")) out.push("Shoulders");
  if (lowered.includes("back")) out.push("Back");
  if (lowered.includes("leg") || lowered.includes("quad") || lowered.includes("hamstring") || lowered.includes("glute")) {
    out.push("Legs");
  }
  if (lowered.includes("tricep")) out.push("Triceps");
  if (lowered.includes("bicep")) out.push("Biceps");
  if (lowered.includes("arm") && !out.includes("Triceps") && !out.includes("Biceps")) {
    out.push("Biceps", "Triceps");
  }
  return [...new Set(out)];
}

/** Notes/body_part first, then exercise-name heuristics — aligned with server inference. */
export function inferMusclesFromWorkout(item: Pick<WorkoutHistoryItem, "exerciseName" | "type" | "notes" | "bodyPart">): string[] {
  const fromNotes = parseBodyPartFromNotes(item.notes);
  const mapped = musclesFromBodyPart(fromNotes || item.bodyPart);
  if (mapped.length) return mapped.filter((m) => BASE_MUSCLES.has(m));

  const ex = `${item.exerciseName} ${item.type}`.toLowerCase();
  if (/(bench|press|pushup|chest)/.test(ex)) return ["Chest", "Triceps"];
  if (/(row|pull|lat|deadlift|back)/.test(ex)) return ["Back", "Biceps"];
  if (/(squat|lunge|leg|hamstring|quad|glute)/.test(ex)) return ["Legs"];
  if (/(shoulder|overhead|lateral raise)/.test(ex)) return ["Shoulders"];
  if (/bicep|curl/.test(ex)) return ["Biceps"];
  if (/tricep|dip|pushdown/.test(ex)) return ["Triceps"];
  return [];
}
