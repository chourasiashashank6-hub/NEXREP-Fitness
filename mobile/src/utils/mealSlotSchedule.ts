import type { MealType } from "../api/caloriesLog";

/**
 * Mirrors server meal_engine_v3.MEAL_SLOT_SCHEDULES labels / order.
 * calorieTypes = how "Log this meal" / Calorie Log store that slot
 * (snack variants all collapse to Snack on the calorie log).
 */
export type MealSlotDef = {
  key: string;
  label: string;
  calorieTypes: MealType[];
};

const MEAL_SLOT_SCHEDULES: Record<number, MealSlotDef[]> = {
  2: [
    { key: "lunch", label: "Lunch", calorieTypes: ["Lunch"] },
    { key: "dinner", label: "Dinner", calorieTypes: ["Dinner"] },
  ],
  3: [
    { key: "breakfast", label: "Breakfast", calorieTypes: ["Breakfast"] },
    { key: "lunch", label: "Lunch", calorieTypes: ["Lunch"] },
    { key: "dinner", label: "Dinner", calorieTypes: ["Dinner"] },
  ],
  4: [
    { key: "breakfast", label: "Breakfast", calorieTypes: ["Breakfast"] },
    { key: "lunch", label: "Lunch", calorieTypes: ["Lunch"] },
    { key: "snack", label: "Snack", calorieTypes: ["Snack"] },
    { key: "dinner", label: "Dinner", calorieTypes: ["Dinner"] },
  ],
  5: [
    { key: "breakfast", label: "Breakfast", calorieTypes: ["Breakfast"] },
    { key: "mid_morning_snack", label: "Mid-Morning Snack", calorieTypes: ["Snack"] },
    { key: "lunch", label: "Lunch", calorieTypes: ["Lunch"] },
    { key: "evening_snack", label: "Evening Snack", calorieTypes: ["Snack"] },
    { key: "dinner", label: "Dinner", calorieTypes: ["Dinner"] },
  ],
  6: [
    { key: "breakfast", label: "Breakfast", calorieTypes: ["Breakfast"] },
    { key: "mid_morning_snack", label: "Mid-Morning Snack", calorieTypes: ["Snack"] },
    { key: "lunch", label: "Lunch", calorieTypes: ["Lunch"] },
    { key: "afternoon_snack", label: "Afternoon Snack", calorieTypes: ["Snack"] },
    { key: "evening_snack", label: "Evening Snack", calorieTypes: ["Snack"] },
    { key: "dinner", label: "Dinner", calorieTypes: ["Dinner"] },
  ],
};

export function clampMealsPerDay(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return Math.max(2, Math.min(6, Math.round(n)));
}

export function slotsForMealsPerDay(mealsPerDay: unknown): MealSlotDef[] {
  return MEAL_SLOT_SCHEDULES[clampMealsPerDay(mealsPerDay)];
}

export type MealLogEntry = {
  meal_id: number;
  meal_type: string;
  source_type?: "database" | "camera_ai" | "meal_planner";
};

export type MealSlotFill = {
  key: string;
  label: string;
  filled: boolean;
  sourceType?: "database" | "camera_ai" | "meal_planner";
  /** Raw meal_type for i18n on extra meals. */
  mealType?: string;
  /** Meals logged outside the user's scheduled slots (e.g. a snack on a 3-meal day). */
  isExtra?: boolean;
};

const MEAL_TYPE_LABELS: Record<string, string> = {
  Breakfast: "Breakfast",
  Lunch: "Lunch",
  Dinner: "Dinner",
  Snack: "Snack",
  Pre_Workout: "Pre-Workout",
  Post_Workout: "Post-Workout",
};

function labelForMealType(mealType: string): string {
  return MEAL_TYPE_LABELS[mealType] ?? mealType.replace(/_/g, " ");
}

/** Greedy assign today's calorie-log meals to schedule slots; append any leftovers as extras. */
export function fillMealSlots(mealsPerDay: unknown, meals: MealLogEntry[]): MealSlotFill[] {
  const slots = slotsForMealsPerDay(mealsPerDay);
  const used = new Set<number>();

  const scheduled = slots.map((slot) => {
    const match = meals.find(
      (m) => !used.has(m.meal_id) && slot.calorieTypes.includes(m.meal_type as MealType),
    );
    if (match) {
      used.add(match.meal_id);
      return {
        key: slot.key,
        label: slot.label,
        filled: true,
        sourceType: match.source_type,
      };
    }
    return { key: slot.key, label: slot.label, filled: false };
  });

  const extras: MealSlotFill[] = [];
  for (const meal of meals) {
    if (used.has(meal.meal_id)) continue;
    extras.push({
      key: `extra-${meal.meal_id}`,
      label: labelForMealType(meal.meal_type),
      mealType: meal.meal_type,
      filled: true,
      sourceType: meal.source_type,
      isExtra: true,
    });
    used.add(meal.meal_id);
  }

  return [...scheduled, ...extras];
}

/** Free tier: one milestone box per logged meal (no scheduled empty slots). */
export function buildLoggedMealMilestones(meals: MealLogEntry[]): MealSlotFill[] {
  return meals.map((meal) => ({
    key: `logged-${meal.meal_id}`,
    label: labelForMealType(meal.meal_type),
    mealType: meal.meal_type,
    filled: true,
    sourceType: meal.source_type,
    isExtra: true,
  }));
}
