/**
 * Run: npx --yes tsx src/utils/mealSlotSchedule.test.ts
 * (from mobile/)
 */
import { clampMealsPerDay, fillMealSlots, slotsForMealsPerDay, buildLoggedMealMilestones } from "./mealSlotSchedule";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const EXPECTED: Record<number, string[]> = {
  2: ["Lunch", "Dinner"],
  3: ["Breakfast", "Lunch", "Dinner"],
  4: ["Breakfast", "Lunch", "Snack", "Dinner"],
  5: ["Breakfast", "Mid-Morning Snack", "Lunch", "Evening Snack", "Dinner"],
  6: ["Breakfast", "Mid-Morning Snack", "Lunch", "Afternoon Snack", "Evening Snack", "Dinner"],
};

for (const n of [2, 3, 4, 5, 6] as const) {
  const slots = slotsForMealsPerDay(n);
  assert(slots.length === n, `meals_per_day=${n}: expected ${n} boxes, got ${slots.length}`);
  const labels = slots.map((s) => s.label);
  assert(
    JSON.stringify(labels) === JSON.stringify(EXPECTED[n]),
    `meals_per_day=${n}: labels ${JSON.stringify(labels)} !== ${JSON.stringify(EXPECTED[n])}`,
  );
}

assert(clampMealsPerDay(1) === 2, "clamp low");
assert(clampMealsPerDay(9) === 6, "clamp high");
assert(clampMealsPerDay(null) === 3, "clamp default");

// Greedy snack assignment: two Snack logs fill Mid-Morning + Evening on 5-meal day
{
  const filled = fillMealSlots(5, [
    { meal_id: 1, meal_type: "Breakfast" },
    { meal_id: 2, meal_type: "Snack" },
    { meal_id: 3, meal_type: "Snack" },
  ]);
  assert(filled[0].filled && filled[0].label === "Breakfast", "breakfast filled");
  assert(filled[1].filled && filled[1].label === "Mid-Morning Snack", "first snack → mid-morning");
  assert(!filled[2].filled && filled[2].label === "Lunch", "lunch empty");
  assert(filled[3].filled && filled[3].label === "Evening Snack", "second snack → evening");
  assert(!filled[4].filled, "dinner empty");
}

// Extra meal beyond scheduled slots (3-meal day + manual snack)
{
  const filled = fillMealSlots(3, [
    { meal_id: 1, meal_type: "Breakfast", source_type: "meal_planner" },
    { meal_id: 2, meal_type: "Lunch", source_type: "meal_planner" },
    { meal_id: 3, meal_type: "Dinner", source_type: "meal_planner" },
    { meal_id: 4, meal_type: "Snack", source_type: "database" },
  ]);
  assert(filled.length === 4, "3 scheduled slots + 1 extra");
  assert(filled[0].filled && filled[0].sourceType === "meal_planner", "breakfast planner");
  assert(filled[3].isExtra && filled[3].label === "Snack" && filled[3].sourceType === "database", "extra snack manual");
}

// Free tier: only manual / scan meals become boxes
{
  const manual = buildLoggedMealMilestones([
    { meal_id: 10, meal_type: "Snack", source_type: "database" },
    { meal_id: 11, meal_type: "Breakfast", source_type: "camera_ai" },
  ]);
  assert(manual.length === 2, "one box per logged meal");
  assert(manual.every((m) => m.filled), "all filled");
}

console.log("mealSlotSchedule.test.ts: all assertions passed");
