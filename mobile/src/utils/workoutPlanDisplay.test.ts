import i18n from "i18next";
import en from "../i18n/locales/en.json";
import {
  ENGINE_SPLIT_KEYS,
  WORKOUT_SPLIT_I18N_PREFIX,
  formatWorkoutSplitName,
  workoutSplitKeyFromName,
} from "./workoutPlanDisplay";

void i18n.init({
  lng: "en",
  resources: { en: { translation: en } },
});

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

for (const key of ENGINE_SPLIT_KEYS) {
  const i18nKey = `${WORKOUT_SPLIT_I18N_PREFIX}${key}`;
  const label = i18n.t(i18nKey);
  assert(label !== i18nKey, `missing i18n label for ${i18nKey}`);
  assert(
    formatWorkoutSplitName(i18nKey, i18n.t.bind(i18n)) === label,
    `formatWorkoutSplitName failed for ${i18nKey}`,
  );
}

assert(formatWorkoutSplitName("coach.workout.split.upper", i18n.t.bind(i18n)) === "Upper Day", "upper i18n key");
assert(formatWorkoutSplitName("coach.workout.split.lower", i18n.t.bind(i18n)) === "Lower Day", "lower i18n key");
assert(formatWorkoutSplitName("upper", i18n.t.bind(i18n)) === "Upper Day", "bare upper key");
assert(formatWorkoutSplitName("Push Day", i18n.t.bind(i18n)) === "Push Day", "legacy label passthrough");
assert(workoutSplitKeyFromName("coach.workout.split.full_body_a") === "full_body_a", "full_body_a key parse");

console.log("workoutPlanDisplay.test.ts: all passed");
