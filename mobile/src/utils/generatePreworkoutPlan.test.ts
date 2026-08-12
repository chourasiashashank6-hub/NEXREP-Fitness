import {
  generatePreworkoutPlan,
  isCardioGoal,
  phaseDurationTotalSec,
  selectWarmupExercises,
} from "./generatePreworkoutPlan";

describe("generatePreworkoutPlan", () => {
  const baseProfile = {
    primaryGoal: "fat_loss",
    goalPace: "moderate",
    difficulty: "intermediate",
    weightKg: 75,
  };

  it("uses cardio phases for fat loss", () => {
    const plan = generatePreworkoutPlan(baseProfile, ["Chest"]);
    expect(plan.kind).toBe("cardio");
    if (plan.kind !== "cardio") return;
    expect(plan.totalDurationMin).toBe(20);
    expect(plan.phases).toHaveLength(3);
    expect(phaseDurationTotalSec(plan.phases)).toBe(20 * 60);
    expect(plan.estimatedKcal).toBeGreaterThan(0);
    expect(plan.estimatedKcal % 5).toBe(0);
  });

  it("beginner cardio uses one continuous walk phase", () => {
    const plan = generatePreworkoutPlan({ ...baseProfile, difficulty: "beginner", goalPace: "slow" }, ["Legs"]);
    expect(plan.kind).toBe("cardio");
    if (plan.kind !== "cardio") return;
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0].type).toBe("walk");
    expect(plan.phases[0].duration_sec).toBe(15 * 60);
  });

  it("advanced cardio includes run/walk intervals and cooldown", () => {
    const plan = generatePreworkoutPlan({ ...baseProfile, difficulty: "advanced", goalPace: "aggressive" }, ["Core"]);
    expect(plan.kind).toBe("cardio");
    if (plan.kind !== "cardio") return;
    expect(plan.phases.length).toBeGreaterThan(3);
    expect(plan.phases[0].type).toBe("walk");
    expect(plan.phases[plan.phases.length - 1].type).toBe("brisk_walk");
    expect(phaseDurationTotalSec(plan.phases)).toBe(28 * 60);
  });

  it("strength goal returns ramp-up and protein guidance", () => {
    const plan = generatePreworkoutPlan(
      { ...baseProfile, primaryGoal: "strength", goalPace: "moderate" },
      ["Back", "Arms"],
    );
    expect(plan.kind).toBe("strength");
    if (plan.kind !== "strength") return;
    expect(plan.rampUpSets).toBe(3);
    expect(plan.rampUpMinutesPerSet).toBe(3);
    expect(plan.postWorkoutProteinG).toBe(30);
  });

  it("muscle_gain uses strength-style ramp-up (not cardio)", () => {
    const plan = generatePreworkoutPlan(
      { ...baseProfile, primaryGoal: "muscle_gain", goalPace: "moderate" },
      ["Chest", "Arms"],
    );
    expect(plan.kind).toBe("strength");
    if (plan.kind !== "strength") return;
    expect(plan.rampUpSets).toBe(3);
    expect(plan.postWorkoutProteinG).toBe(30);
  });

  it("endurance uses cardio phases (same as fat_loss)", () => {
    const plan = generatePreworkoutPlan(
      { ...baseProfile, primaryGoal: "endurance", goalPace: "moderate" },
      ["Legs"],
    );
    expect(plan.kind).toBe("cardio");
    if (plan.kind !== "cardio") return;
    expect(plan.phases.length).toBeGreaterThan(0);
    expect(plan.estimatedKcal).toBeGreaterThan(0);
  });

  it("recomp and maintain default to strength-style plan", () => {
    for (const primaryGoal of ["recomp", "maintain"] as const) {
      const plan = generatePreworkoutPlan({ ...baseProfile, primaryGoal }, ["Core"]);
      expect(plan.kind).toBe("strength");
    }
  });

  it("selects up to three warmup exercises and reuses same group when needed", () => {
    const exercises = selectWarmupExercises(["Chest"]);
    expect(exercises.length).toBeGreaterThanOrEqual(2);
    expect(exercises.length).toBeLessThanOrEqual(3);
    expect(exercises[0].name).toBe("Arm circles");
  });

  it("cardio calorie estimate matches phase MET math", () => {
    const plan = generatePreworkoutPlan(baseProfile, ["Shoulders"]);
    expect(plan.kind).toBe("cardio");
    if (plan.kind !== "cardio") return;
    const raw = plan.phases.reduce((sum, phase) => sum + phase.met * 75 * (phase.duration_sec / 3600), 0);
    expect(plan.estimatedKcal).toBe(Math.round(raw / 5) * 5);
  });

  it("isCardioGoal matches explicit cardio goal list", () => {
    expect(isCardioGoal("fat_loss")).toBe(true);
    expect(isCardioGoal("endurance")).toBe(true);
    expect(isCardioGoal("strength")).toBe(false);
    expect(isCardioGoal("muscle_gain")).toBe(false);
    expect(isCardioGoal("recomp")).toBe(false);
    expect(isCardioGoal("maintain")).toBe(false);
  });
});
