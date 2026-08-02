/**
 * Client-side onboarding diff for the "stale plan" confirmation modal.
 *
 * This mirrors the server-side snapshot logic in plan_snapshot.py but is
 * used only for the proactive pre-save modal — NOT as the source of truth
 * for the planner banner (that comes from the server-computed stale_fields).
 */

import type { OnboardingData } from "../types/onboarding";

type PlannerKey = "meal" | "workout";

interface FieldImpact {
  meal: boolean;
  workout: boolean;
}

/** Which planners each onboarding field affects. */
const FIELD_IMPACT: Record<string, FieldImpact> = {
  age:                  { meal: true,  workout: false },
  biological_sex:       { meal: true,  workout: false },
  height_cm:            { meal: true,  workout: false },
  current_weight_kg:    { meal: true,  workout: true  },
  primary_goal:         { meal: true,  workout: true  },
  goal_pace:            { meal: true,  workout: false },
  target_weight_kg:     { meal: true,  workout: false },
  daily_activity_level: { meal: true,  workout: false },
  diet_type:            { meal: true,  workout: false },
  food_allergies:       { meal: true,  workout: false },
  meals_per_day:        { meal: true,  workout: false },
  difficulty:           { meal: false, workout: true  },
  body_type:            { meal: false, workout: true  },
  workouts_per_week:    { meal: false, workout: true  },
  workout_types:        { meal: false, workout: true  },
  muscle_focus:         { meal: false, workout: true  },
};

/** Extract a flat comparable value for a field from onboarding data. */
function extractValue(data: OnboardingData, field: string): unknown {
  const { personal, goal, activity, dietary } = data;
  switch (field) {
    case "age":                  return personal.age;
    case "biological_sex":       return personal.biological_sex;
    case "height_cm":            return personal.height_cm;
    case "current_weight_kg":    return personal.weight_kg;
    case "primary_goal":         return goal.type;
    case "goal_pace":            return goal.pace;
    case "target_weight_kg":     return goal.target_weight_kg ?? goal.target_weight_lb;
    case "daily_activity_level": return activity.level;
    case "diet_type":            return dietary.diet_type;
    case "food_allergies":       return JSON.stringify((dietary.allergies ?? []).slice().sort());
    case "meals_per_day":        return dietary.meals_per_day;
    case "difficulty":           return goal.difficulty;
    case "body_type":            return JSON.stringify(data.body_type ?? {});
    case "workouts_per_week":    return activity.workouts_per_week;
    case "workout_types":        return JSON.stringify((activity.workout_types ?? []).slice().sort());
    case "muscle_focus":         return JSON.stringify((goal.focus_muscles ?? (goal.focus_muscle ? [goal.focus_muscle] : [])).slice().sort());
    default:                     return undefined;
  }
}

function valEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Compare `prev` (server-stored) onboarding against `next` (edited) onboarding.
 * Returns which planners have at least one changed field.
 */
export function detectAffectedPlanners(
  prev: OnboardingData,
  next: OnboardingData,
): PlannerKey[] {
  const affected = new Set<PlannerKey>();
  for (const [field, impact] of Object.entries(FIELD_IMPACT)) {
    const prevVal = extractValue(prev, field);
    const nextVal = extractValue(next, field);
    if (!valEq(prevVal, nextVal)) {
      if (impact.meal)    affected.add("meal");
      if (impact.workout) affected.add("workout");
    }
  }
  return Array.from(affected);
}
