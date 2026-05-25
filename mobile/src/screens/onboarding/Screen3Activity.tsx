import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { MultiChips } from "../../components/MultiChips";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { TapCards } from "../../components/TapCards";
import { ONBOARDING_COLORS } from "../../constants/onboarding";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import type { FocusMuscle } from "../../types/onboarding";
import { ACTIVITY_OPTIONS, FOCUS_MUSCLE_OPTIONS, WORKOUTS_PER_WEEK_OPTIONS, WORKOUT_TYPE_OPTIONS } from "../../utils/onboardingOptions";
import { useState } from "react";

export default function Screen3Activity({ navigation }: any) {
  const { data, updateActivity, updateGoal } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();
  const [errors, setErrors] = useState<Record<string, string>>({});

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
        <Text style={styles.sub}>We'll add extra volume for this muscle group in your monthly workout plan</Text>
        <View style={styles.chips}>
          {FOCUS_MUSCLE_OPTIONS.map((opt) => {
            const selected = (data.goal.focus_muscle ?? null) === opt.value;
            return (
              <Pressable
                key={opt.label}
                style={[styles.chip, selected ? styles.chipSelected : null]}
                onPress={() => updateGoal({ focus_muscle: opt.value as FocusMuscle | null })}
              >
                <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  label: { color: ONBOARDING_COLORS.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  sub: { color: ONBOARDING_COLORS.textSecondary, fontSize: 13, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: ONBOARDING_COLORS.card,
    borderColor: ONBOARDING_COLORS.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: "#1E1B3A", borderColor: ONBOARDING_COLORS.primary },
  chipLabel: { color: ONBOARDING_COLORS.textPrimary, fontSize: 13 },
  chipLabelSelected: { color: ONBOARDING_COLORS.primary, fontWeight: "700" },
  error: { marginTop: 4, fontSize: 12, color: ONBOARDING_COLORS.danger },
});
