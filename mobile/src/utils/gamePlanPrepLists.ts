import type { MealPlanMeal } from "../types/planner";

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
