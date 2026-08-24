/**
 * Run: npx --yes tsx src/utils/todaysGoalRing.test.ts
 * (from mobile/)
 */
import {
  computeTodaysGoalProgress,
  deriveTodaysGoalPendingItems,
  formatTodaysGoalPendingLabel,
  plannedBurnBreakdownFromActivities,
} from "./todaysGoalRing";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function almostEqual(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

// 1) Eat done, burn 0 → 50%, not complete (critical clamp regression)
{
  const p = computeTodaysGoalProgress(2000, 2000, 0, 400);
  assert(p.percent === 50, `expected 50, got ${p.percent}`);
  assert(p.complete === false, "expected incomplete");
  assert(almostEqual(p.eatFrac, 1) && almostEqual(p.burnFrac, 0), "fracs wrong");
}

// 2) Mirror: eat 0, burn done → 50%, not complete
{
  const p = computeTodaysGoalProgress(0, 2000, 400, 400);
  assert(p.percent === 50, `expected 50, got ${p.percent}`);
  assert(p.complete === false, "expected incomplete");
}

// 3) Both done → 100%, complete
{
  const p = computeTodaysGoalProgress(2000, 2000, 400, 400);
  assert(p.percent === 100, `expected 100, got ${p.percent}`);
  assert(p.complete === true, "expected complete");
  assert(almostEqual(p.combined, 1), "combined should be 1");
}

// 4) Overeating + burn done → still complete; eat clamp prevents combined > 1
{
  const p = computeTodaysGoalProgress(3000, 2000, 400, 400);
  assert(p.complete === true, "expected complete");
  assert(almostEqual(p.eatFrac, 1), `eatFrac should clamp to 1, got ${p.eatFrac}`);
  assert(almostEqual(p.combined, 1), `combined should be 1 after per-frac clamp, got ${p.combined}`);
  assert(p.percent === 100, `expected 100, got ${p.percent}`);
}

// Extra: overeating alone must NOT complete (200% eat + 0% burn → 50%)
{
  const p = computeTodaysGoalProgress(4000, 2000, 0, 400);
  assert(p.percent === 50, `overeating alone should be 50, got ${p.percent}`);
  assert(p.complete === false, "overeating alone must not complete");
}

// Rest day: combined === eatFrac; incidental burn never factors in
{
  const p = computeTodaysGoalProgress(1000, 2000, 400, 400, { restDayActive: true });
  assert(almostEqual(p.combined, p.eatFrac), `rest combined should equal eatFrac, got ${p.combined} vs ${p.eatFrac}`);
  assert(p.percent === 50, `rest eat-half should be 50, got ${p.percent}`);
  assert(almostEqual(p.burnFrac, 1), "burnFrac still computed but unused");
  assert(p.complete === false, "rest half-eat incomplete");
}

{
  const p = computeTodaysGoalProgress(2000, 2000, 0, 400, { restDayActive: true });
  assert(p.percent === 100, `rest eat-done should be 100, got ${p.percent}`);
  assert(p.complete === true, "rest eat-done complete");
  assert(almostEqual(p.combined, 1), "combined is eatFrac only");
}

// Best-results denominator: 0 burn vs 467 target → 0% (not skewed by old 138 min)
{
  const p = computeTodaysGoalProgress(0, 2000, 0, 467);
  assert(p.burnFrac === 0, `expected burnFrac 0, got ${p.burnFrac}`);
  assert(p.percent === 0, `expected 0% with no eat or burn, got ${p.percent}`);
}

// Hitting minimum only (138) vs best-results goal (467) → ~29.5%, not 100%
{
  const p = computeTodaysGoalProgress(0, 2000, 138, 467);
  const expectedBurnFrac = 138 / 467;
  assert(
    almostEqual(p.burnFrac, expectedBurnFrac),
    `expected burnFrac ${expectedBurnFrac}, got ${p.burnFrac}`,
  );
  assert(p.burnFrac < 0.3, "minimum-only burn must not approach 100%");
  assert(p.complete === false, "minimum burn alone must not complete ring");
  assert(p.percent === Math.round((p.eatFrac + p.burnFrac) / 2 * 100), "combined uses clamped fracs");
}

// Full best-results burn (467/467) with eat done → complete
{
  const p = computeTodaysGoalProgress(2000, 2000, 467, 467);
  assert(p.complete === true, "full eat + full best-results burn completes");
  assert(almostEqual(p.burnFrac, 1), "burnFrac at 100%");
}

const labels = {
  "warm-up": "warm-up",
  workout: "workout",
  intake: "intake",
} as const;

const planned = plannedBurnBreakdownFromActivities([
  { kind: "cardioWarmup", kcal: 175 },
  { kind: "workoutSession", kcal: 216 },
]);

// 1) Sessions logged, warm-up missing, intake short → warm-up + intake
{
  const items = deriveTodaysGoalPendingItems({
    caloriesEatenToday: 1800,
    dailyCalorieTarget: 2000,
    caloriesBurnedToday: 216,
    dailyBurnTarget: 391,
    plannedBurn: planned,
    todayBurnActuals: { warmupKcal: 0, sessionKcal: 216 },
  });
  assert(items.join(",") === "warm-up,intake", `expected warm-up,intake, got ${items.join(",")}`);
  assert(
    formatTodaysGoalPendingLabel(items, labels, "Pending: ") === "Pending: warm-up, intake",
    "formatted label mismatch",
  );
}

// 2) Only intake short
{
  const items = deriveTodaysGoalPendingItems({
    caloriesEatenToday: 1800,
    dailyCalorieTarget: 2000,
    caloriesBurnedToday: 391,
    dailyBurnTarget: 391,
    plannedBurn: planned,
    todayBurnActuals: { warmupKcal: 175, sessionKcal: 216 },
  });
  assert(items.join(",") === "intake", `expected intake only, got ${items.join(",")}`);
}

// 3) Only burn short — warm-up done, session short
{
  const items = deriveTodaysGoalPendingItems({
    caloriesEatenToday: 2000,
    dailyCalorieTarget: 2000,
    caloriesBurnedToday: 200,
    dailyBurnTarget: 391,
    plannedBurn: planned,
    todayBurnActuals: { warmupKcal: 175, sessionKcal: 25 },
  });
  assert(items.join(",") === "workout", `expected workout only, got ${items.join(",")}`);
}

// 4) Ring complete → no pending label
{
  const items = deriveTodaysGoalPendingItems({
    caloriesEatenToday: 2000,
    dailyCalorieTarget: 2000,
    caloriesBurnedToday: 391,
    dailyBurnTarget: 391,
    plannedBurn: planned,
    todayBurnActuals: { warmupKcal: 175, sessionKcal: 216 },
  });
  assert(items.length === 0, "complete ring should have no pending items");
  assert(formatTodaysGoalPendingLabel(items, labels, "Pending: ") === null, "no formatted label");
}

// 5) No planned breakdown — generic workout pending
{
  const items = deriveTodaysGoalPendingItems({
    caloriesEatenToday: 2000,
    dailyCalorieTarget: 2000,
    caloriesBurnedToday: 100,
    dailyBurnTarget: 400,
    plannedBurn: { warmupTargetKcal: 0, sessionTargetKcal: 0 },
  });
  assert(items.join(",") === "workout", `expected workout fallback, got ${items.join(",")}`);
}

console.log("todaysGoalRing.test.ts: all assertions passed");
