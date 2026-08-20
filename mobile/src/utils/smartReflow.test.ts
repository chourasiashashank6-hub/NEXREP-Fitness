/**
 * Run: npx --yes tsx src/utils/smartReflow.test.ts
 * (from mobile/)
 */
import { buildSmartReflowPatches } from "./smartReflow";
import type { ReflowDaySnapshot } from "./smartReflow";
import type { WorkoutExercise, WorkoutPlanCurrent } from "../types/planner";
import { buildReflowAdaptationId } from "./reflowAcknowledgment";
import { isExerciseCompatibleWithDay, REFLOW_MAX_EXERCISES_PER_DAY } from "./reflowMuscleCompat";
import { sanitizePlannerDayDetail, plannerDayNeedsSanitization, sanitizeWorkoutPlanCurrent } from "./sanitizePlannerDay";
import {
  assessReflowTier,
  isEntirePlanPeriodMissed,
  REFLOW_TIER3_MIN_MISSED_DAYS,
} from "./smartReflowTiers";
import { isCompoundExercise } from "./exerciseCompoundLookup";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const bench: WorkoutExercise = {
  name: "Bench Press",
  sets: 4,
  reps: "8",
  muscle: "Chest",
  note: "",
  rest_seconds: 90,
};
const incline: WorkoutExercise = {
  name: "Incline Dumbbell Press",
  sets: 3,
  reps: "10",
  muscle: "Chest",
  note: "",
  rest_seconds: 60,
};
const legExtension: WorkoutExercise = {
  name: "Leg Extension",
  sets: 3,
  reps: "12",
  muscle: "Quads",
  note: "",
  rest_seconds: 60,
};
const pullUp: WorkoutExercise = {
  name: "Pull-ups",
  sets: 3,
  reps: "8",
  muscle: "Back",
  note: "",
  rest_seconds: 90,
};

function planStub(overviews: WorkoutPlanCurrent["month_overview"]): WorkoutPlanCurrent {
  return {
    plan_id: 99,
    year: 2026,
    month: 8,
    focus_muscles: [],
    generated_at: "2026-08-01T00:00:00Z",
    month_overview: overviews,
    today: null,
  };
}

function snapshot(
  day: number,
  exercises: WorkoutExercise[],
  flags: Partial<ReflowDaySnapshot> = {},
): ReflowDaySnapshot {
  return {
    day,
    split_name: flags.split_name ?? "Push",
    focus_muscles: flags.focus_muscles ?? ["Chest", "Shoulders", "Triceps"],
    is_rest_day: false,
    is_past: flags.is_past ?? false,
    is_today: flags.is_today ?? false,
    is_future: flags.is_future ?? true,
    locked: flags.locked ?? false,
    exercises,
    estimated_duration_min: 45,
  };
}

const overviewDay1 = {
  day: 1,
  is_past: true,
  is_today: false,
  is_future: false,
  is_rest_day: false,
  split_name: "Push",
};
const overviewDay21 = {
  day: 21,
  is_past: false,
  is_today: false,
  is_future: true,
  is_rest_day: false,
  split_name: "Push",
};
const overviewDay22 = {
  day: 22,
  is_past: false,
  is_today: false,
  is_future: true,
  is_rest_day: false,
  split_name: "Lower A",
};

// First visit — moves two chest exercises from day 1 to compatible push day 21.
{
  const plan = planStub([overviewDay1, overviewDay21]);
  const snapshots = [
    snapshot(1, [bench, incline], { is_past: true, is_future: false, split_name: "Push" }),
    snapshot(21, [pullUp], { is_future: true, split_name: "Push", focus_muscles: ["Chest", "Shoulders", "Triceps"] }),
  ];
  const { patches, moves } = buildSmartReflowPatches(plan, snapshots, []);
  assert(patches.length === 1, "creates one target patch");
  assert(moves.length === 2, "records two moves");
  assert(moves.every((move) => move.sourceDay === 1 && move.targetDay === 21), "moves route day 1 → 21");
}

// Repeat visit — exercises already on day 21, so no new patches or moves.
{
  const plan = planStub([overviewDay1, overviewDay21]);
  const snapshots = [
    snapshot(1, [bench, incline], { is_past: true, is_future: false, split_name: "Push" }),
    snapshot(21, [
      pullUp,
      { ...bench, reflow_source_day: 1 },
      { ...incline, reflow_source_day: 1 },
    ], { is_future: true, split_name: "Push" }),
  ];
  const { patches, moves } = buildSmartReflowPatches(plan, snapshots, []);
  assert(patches.length === 0, "does not re-apply when destination already has moved exercises");
  assert(moves.length === 0, "does not emit duplicate move metadata");
}

// Upper-body reflow must not land on a leg-focused day.
{
  const plan = planStub([overviewDay1, overviewDay22]);
  const snapshots = [
    snapshot(1, [bench, incline], { is_past: true, is_future: false, split_name: "Push" }),
    snapshot(22, [legExtension], {
      is_future: true,
      split_name: "Lower A",
      focus_muscles: ["Quads", "Hamstrings", "Glutes", "Calves"],
    }),
  ];
  const { patches, moves } = buildSmartReflowPatches(plan, snapshots, []);
  assert(patches.length === 0, "does not place chest work on a leg day");
  assert(moves.length === 0, "records no mismatched moves");
}

// Day cap prevents overload when the target day is already full.
{
  const fullDayExercises = Array.from({ length: REFLOW_MAX_EXERCISES_PER_DAY }, (_, index) => ({
    ...legExtension,
    name: `Leg Move ${index + 1}`,
    muscle: "Quads",
  }));
  const plan = planStub([overviewDay1, overviewDay22]);
  const snapshots = [
    snapshot(1, [bench], { is_past: true, is_future: false, split_name: "Push" }),
    snapshot(22, fullDayExercises, {
      is_future: true,
      split_name: "Lower A",
      focus_muscles: ["Quads", "Hamstrings", "Glutes", "Calves"],
    }),
  ];
  const { patches, moves } = buildSmartReflowPatches(plan, snapshots, []);
  assert(patches.length === 0, "does not patch a day already at the exercise cap");
  assert(moves.length === 0, "does not move exercises when no eligible room exists");
}

// Muscle compatibility helper respects split focus.
{
  assert(
    isExerciseCompatibleWithDay(bench, {
      split_name: "Push",
      focus_muscles: ["Chest", "Shoulders", "Triceps"],
    }),
    "chest exercise fits push day",
  );
  assert(
    !isExerciseCompatibleWithDay(bench, {
      split_name: "Lower A",
      focus_muscles: ["Quads", "Hamstrings", "Glutes", "Calves"],
    }),
    "chest exercise rejected on leg day",
  );
}

// Adaptation ids are stable for the same move set.
{
  const id = buildReflowAdaptationId(99, [
    { name: "Bench Press", sourceDay: 1, targetDay: 21 },
    { name: "Incline Dumbbell Press", sourceDay: 1, targetDay: 21 },
  ]);
  assert(id.includes("99:"), "adaptation id includes plan id");
  assert(id.includes("bench press"), "adaptation id normalizes exercise names");
}

// Sanitize strips reflow-tagged additions and trims overload.
{
  const overloaded = {
    day: 21,
    is_rest_day: false,
    split_name: "Lower A",
    focus_muscles: ["Quads"],
    estimated_duration_min: 120,
    exercises: [
      ...Array.from({ length: 6 }, (_, i) => ({ ...bench, name: `Base ${i + 1}` })),
      { ...bench, name: "Incline Dumbbell Press", reflow_source_day: 1 },
      { ...bench, name: "Pull-ups", reflow_source_day: 1 },
    ],
  };
  assert(plannerDayNeedsSanitization(overloaded), "detects reflow corruption");
  const cleaned = sanitizePlannerDayDetail(overloaded);
  assert(cleaned.exercises.length === 6, "restores base exercise count");
  assert(!cleaned.exercises.some((ex) => (ex as { reflow_source_day?: number }).reflow_source_day), "removes reflow tags");
}

// Current-plan payload sanitizes embedded today day.
{
  const plan = {
    plan_id: 1,
    month: 8,
    year: 2026,
    focus_muscles: [],
    month_overview: [],
    today: {
      day: 21,
      is_rest_day: false,
      split_name: "Lower A",
      focus_muscles: ["Quads"],
      estimated_duration_min: 120,
      exercises: [
        ...Array.from({ length: 6 }, (_, i) => ({ ...bench, name: `Base ${i + 1}` })),
        { ...bench, name: "Incline Dumbbell Press", reflow_source_day: 1 },
      ],
    },
  } as WorkoutPlanCurrent;
  const cleaned = sanitizeWorkoutPlanCurrent(plan);
  assert(cleaned?.today?.exercises.length === 6, "sanitizes plan.today for Home/Game Plan");
}

// Tier 1 — only compound exercises move; isolation stays on missed day.
{
  assert(!isCompoundExercise(legExtension.name), "leg extension treated as isolation for test");
  const plan = planStub([
    { ...overviewDay1, day: 1 },
    { ...overviewDay21, day: 21 },
  ]);
  const snapshots = [
    snapshot(1, [bench, legExtension], { is_past: true, is_future: false, split_name: "Push" }),
    snapshot(21, [pullUp], { is_future: true, split_name: "Push", focus_muscles: ["Chest", "Shoulders", "Triceps"] }),
  ];
  const { patches, moves, assessment } = buildSmartReflowPatches(plan, snapshots, []);
  assert(assessment.tier === 1, "single missed day is tier 1");
  assert(moves.length === 1, "only compound exercise moves");
  assert(moves[0]?.name === bench.name, "bench press is the compound candidate");
  assert(patches.length === 1, "creates one patch");
}

// Tier 2 — seven missed days classifies correctly.
{
  const missedOverviews = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    is_past: true,
    is_today: false,
    is_future: false,
    is_rest_day: false,
    split_name: "Push",
  }));
  const plan = planStub([...missedOverviews, overviewDay21]);
  const snapshots = [
    ...missedOverviews.map((overview) =>
      snapshot(overview.day, [{ ...bench, name: `Press Day ${overview.day}` }], {
        is_past: true,
        is_future: false,
        split_name: "Push",
      }),
    ),
    snapshot(21, [pullUp], { is_future: true, split_name: "Push", focus_muscles: ["Chest", "Shoulders", "Triceps"] }),
  ];
  const { assessment } = buildSmartReflowPatches(plan, snapshots, []);
  assert(assessment.tier === 2, "seven missed days is tier 2");
}

// Tier 3 — twelve missed days skips redistribution.
{
  const missedOverviews = Array.from({ length: REFLOW_TIER3_MIN_MISSED_DAYS + 2 }, (_, index) => ({
    day: index + 1,
    is_past: true,
    is_today: false,
    is_future: false,
    is_rest_day: false,
    split_name: "Push",
  }));
  const plan = planStub([...missedOverviews, overviewDay21]);
  const snapshots = [
    ...missedOverviews.map((overview) =>
      snapshot(overview.day, [bench], { is_past: true, is_future: false, split_name: "Push" }),
    ),
    snapshot(21, [pullUp], { is_future: true, split_name: "Push" }),
  ];
  const { patches, moves, assessment } = buildSmartReflowPatches(plan, snapshots, []);
  assert(assessment.tier === 3, "twelve missed days is tier 3");
  assert(patches.length === 0 && moves.length === 0, "tier 3 does not redistribute");
}

// Full-month miss — every past training day missed with no future training days.
{
  const pastTraining = [1, 2, 3, 4].map((day) => ({
    day,
    is_past: true,
    is_today: false,
    is_future: false,
    is_rest_day: false,
    split_name: "Push",
  }));
  const plan = planStub(pastTraining);
  const snapshots = pastTraining.map((overview) =>
    snapshot(overview.day, [bench], { is_past: true, is_future: false, split_name: "Push" }),
  );
  const assessment = assessReflowTier(plan, snapshots, []);
  assert(assessment.entirePlanPeriodMissed, "detects full active period missed");
  assert(
    isEntirePlanPeriodMissed(plan, assessment.missedDays.map((entry) => entry.day)),
    "helper matches assessment",
  );
}

console.log("smartReflow.test.ts: all passed");
