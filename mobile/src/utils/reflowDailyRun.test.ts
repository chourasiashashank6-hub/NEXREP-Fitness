/**
 * Run: npx --yes tsx src/utils/reflowDailyRun.test.ts
 * (from mobile/)
 */
import { hasDailyRunForPlan } from "./reflowDailyRun";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const today = "2026-09-10";

assert(
  !hasDailyRunForPlan([], 42, today),
  "empty list is not run",
);
assert(
  hasDailyRunForPlan([{ planId: 42, localDate: today }], 42, today),
  "matches plan and day",
);
assert(
  !hasDailyRunForPlan([{ planId: 42, localDate: "2026-09-09" }], 42, today),
  "different day does not match",
);
assert(
  !hasDailyRunForPlan([{ planId: 42, localDate: today }], 99, today),
  "different plan does not match",
);

console.log("reflowDailyRun.test.ts: all assertions passed");
