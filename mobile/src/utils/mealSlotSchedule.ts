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

export type MealSlotFill = {
  key: string;
  label: string;
  filled: boolean;
};

/** Greedy assign today's calorie-log meals to schedule slots (one meal per slot). */
export function fillMealSlots(
  mealsPerDay: unknown,
  meals: Array<{ meal_id: number; meal_type: string }>,
): MealSlotFill[] {
  const slots = slotsForMealsPerDay(mealsPerDay);
  const used = new Set<number>();
  return slots.map((slot) => {
    const match = meals.find(
      (m) => !used.has(m.meal_id) && slot.calorieTypes.includes(m.meal_type as MealType),
    );
    if (match) {
      used.add(match.meal_id);
      return { key: slot.key, label: slot.label, filled: true };
    }
    return { key: slot.key, label: slot.label, filled: false };
  });
}
