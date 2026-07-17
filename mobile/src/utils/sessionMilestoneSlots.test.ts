/**
 * Run: npx --yes tsx src/utils/sessionMilestoneSlots.test.ts
 */
import { fillSessionSlots } from "./sessionMilestoneSlots";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Rest / empty plan → zero boxes
assert(fillSessionSlots([], []).length === 0, "empty plan");
assert(fillSessionSlots(null, ["Pull-Up"]).length === 0, "null plan");

// Box count = plan exercise count (not hardcoded 6)
{
  const three = fillSessionSlots([{ name: "A" }, { name: "B" }, { name: "C" }], ["B"]);
  assert(three.length === 3, "3-exercise day");
  assert(three.map((s) => s.label).join("|") === "A|B|C", "labels from plan");
  assert(!three[0].filled && three[1].filled && !three[2].filled, "only B filled");
}

{
  const six = fillSessionSlots(
    ["Pull-Up", "Leg Press Calf Raise", "Row", "Press", "Curl", "Plank"].map((name) => ({ name })),
    ["pull-up", "Curl"],
  );
  assert(six.length === 6, "6-exercise day");
  assert(six[0].filled, "case-insensitive match");
  assert(six[4].filled, "Curl filled");
  assert(six.filter((s) => s.filled).length === 2, "two filled");
}

console.log("sessionMilestoneSlots.test.ts: all assertions passed");
