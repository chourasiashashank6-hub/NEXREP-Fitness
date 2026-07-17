/**
 * Run: npx --yes tsx src/utils/todaysGoalRing.test.ts
 * (from mobile/)
 */
import { computeTodaysGoalProgress } from "./todaysGoalRing";

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

console.log("todaysGoalRing.test.ts: all assertions passed");
