import type { MealPlanMeal } from "../types/planner";
import { getWorkoutCatalogFiltered } from "../api/workout";

export type CatalogEquipmentRow = {
  exerciseName: string;
  defaultExerciseName?: string;
  equipment: string;
};

const sameExerciseName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Exact catalog name match only — no keyword guessing from exercise titles. */
export function resolveEquipmentForExercises(
  exerciseNames: string[],
  catalog: CatalogEquipmentRow[],
): string[] {
  const byKey = new Map<string, string>();
  for (const name of exerciseNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const match = catalog.find(
      (row) =>
        sameExerciseName(row.exerciseName, trimmed) ||
        (row.defaultExerciseName && sameExerciseName(row.defaultExerciseName, trimmed)),
    );
    const equipment = match?.equipment?.trim();
    if (!equipment) continue;
    const key = equipment.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, equipment);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** Fetch equipment rows for only the exercises shown in today's plan. */
export async function fetchEquipmentForExercises(exerciseNames: string[]): Promise<CatalogEquipmentRow[]> {
  const unique = [...new Set(exerciseNames.map((name) => name.trim()).filter(Boolean))];
  if (!unique.length) return [];

  const responses = await Promise.all(
    unique.map((exerciseName) =>
      getWorkoutCatalogFiltered({ exerciseName }).catch(() => ({ items: [] as Array<Record<string, unknown>> })),
    ),
  );

  const rows: CatalogEquipmentRow[] = [];
  for (const data of responses) {
    for (const item of data.items ?? []) {
      rows.push({
        exerciseName: String(item.exerciseName ?? ""),
        defaultExerciseName: item.defaultExerciseName ? String(item.defaultExerciseName) : undefined,
        equipment: String(item.equipment ?? ""),
      });
    }
  }
  return rows;
}

/** Ingredient names from meal-plan `recipe_items` (same embedded payload as View recipe). */
export function collectIngredientNames(meals: MealPlanMeal[]): string[] {
  const byKey = new Map<string, string>();
  for (const meal of meals) {
    for (const item of meal.recipe_items ?? []) {
      const name = String(item.label || item.food || item.key || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, name);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
