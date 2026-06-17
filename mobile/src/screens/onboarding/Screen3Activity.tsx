import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { MultiChips } from "../../components/MultiChips";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { TapCards } from "../../components/TapCards";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import {
  focusMusclesHint,
  FOCUS_MUSCLE_UI_OPTIONS,
  getGoalFocusMuscles,
  isGoalFocusMuscleSelected,
  toggleGoalFocusMuscle,
} from "../../utils/onboardingFocusMuscles";
import { ACTIVITY_OPTIONS, WORKOUTS_PER_WEEK_OPTIONS, WORKOUT_TYPE_OPTIONS } from "../../utils/onboardingOptions";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GOLD = "#FFD700";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

export default function Screen3Activity({ navigation }: any) {
  const { data, updateActivity, updateGoal } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedFocus = getGoalFocusMuscles(data.goal);

  const onNext = () => {
    const next: Record<string, string> = {};
    if (!data.activity.level) next.level = "Activity level is required";
    if (data.activity.workouts_per_week === null) next.workouts = "Workouts per week is required";
    setErrors(next);
    if (Object.keys(next).length) return;
    navigation.navigate("Screen4Diet");
  };

  return (
    <OnboardingLayout
      step={3}
      title="Activity level"
      subtitle="This is the TDEE multiplier. Most users underestimate — give them concrete examples, not just labels."
      onBack={() => navigation.goBack()}
      onNext={onNext}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <Text style={styles.label}>Daily activity level</Text>
      <TapCards options={ACTIVITY_OPTIONS as any} value={data.activity.level} onChange={(v) => updateActivity({ level: v as any })} />
      {errors.level ? <Text style={styles.error}>{errors.level}</Text> : null}

      <View style={styles.block}>
        <Text style={styles.label}>Workouts per week</Text>
        <BottomSheetPicker label="Workouts per week" value={data.activity.workouts_per_week} options={WORKOUTS_PER_WEEK_OPTIONS} onChange={(v) => updateActivity({ workouts_per_week: Number(v) })} placeholder="Select" error={errors.workouts} />
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Workout types (optional)</Text>
        <MultiChips options={WORKOUT_TYPE_OPTIONS} values={data.activity.workout_types} onChange={(v) => updateActivity({ workout_types: v })} />
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Muscle Focus (Optional)</Text>
        <Text style={styles.sub}>Select one or more muscle groups — we&apos;ll add extra volume in your monthly workout plan</Text>
        <View style={styles.chips}>
          {FOCUS_MUSCLE_UI_OPTIONS.map((muscle) => {
            const selected = isGoalFocusMuscleSelected(data.goal, muscle);
            return (
              <Pressable
                key={muscle}
                style={[styles.chip, selected ? styles.chipSelected : null]}
                onPress={() => updateGoal(toggleGoalFocusMuscle(data.goal, muscle))}
              >
                <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{muscle}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>{focusMusclesHint(selectedFocus)}</Text>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  label: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  sub: { color: MUTED, fontSize: 13, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: BG,
    borderColor: "transparent",
    borderWidth: 1.5,
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  chipLabel: { color: MUTED, fontSize: 13, fontWeight: "700" },
  chipLabelSelected: { color: GREEN, fontWeight: "900" },
  hint: { marginTop: 8, fontSize: 12, color: MUTED },
  error: { marginTop: 4, fontSize: 12, color: ORANGE },
});
