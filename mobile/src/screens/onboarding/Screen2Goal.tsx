import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import DateTimePicker from "@react-native-community/datetimepicker";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { TapCards } from "../../components/TapCards";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import { DIFFICULTY_OPTIONS, GOAL_OPTIONS, GOAL_PACE_OPTIONS, getImperialWeightOptions, getMetricWeightOptions } from "../../utils/onboardingOptions";

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
const SUGGESTED_STRENGTH_LIFTS = [
  { name: "Bench press", labelKey: "onboarding.screen2.suggestedLifts.benchPress" },
  { name: "Squat", labelKey: "onboarding.screen2.suggestedLifts.squat" },
  { name: "Deadlift", labelKey: "onboarding.screen2.suggestedLifts.deadlift" },
  { name: "Overhead press", labelKey: "onboarding.screen2.suggestedLifts.overheadPress" },
];

export default function Screen2Goal({ navigation }: any) {
  const { t } = useTranslation();
  const { data, updateGoal } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [warning, setWarning] = useState("");
  const [showCustomLift, setShowCustomLift] = useState(false);
  const [customLiftName, setCustomLiftName] = useState("");

  const isPaceNeeded = data.goal.type === "fat_loss" || data.goal.type === "muscle_gain";
  const isStrengthGoal = data.goal.type === "strength";
  const options = data.personal.unit_system === "metric" ? getMetricWeightOptions() : getImperialWeightOptions();
  const currentWeight = data.personal.unit_system === "metric" ? data.personal.weight_kg : data.personal.weight_lb;
  const targetWeight = data.personal.unit_system === "metric" ? data.goal.target_weight_kg : data.goal.target_weight_lb;
  const targetLifts = data.goal.target_lifts ?? [];

  const dateValue = useMemo(() => (data.goal.target_date ? new Date(data.goal.target_date) : new Date()), [data.goal.target_date]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!data.goal.type) next.goal = t("onboarding.screen2.errors.goalRequired");
    if (!data.goal.difficulty) next.difficulty = t("onboarding.screen2.errors.difficultyRequired");
    if (isPaceNeeded && !data.goal.pace) next.pace = t("onboarding.screen2.errors.paceRequired");
    if (isPaceNeeded && !targetWeight) next.target = t("onboarding.screen2.errors.targetRequired");
    if (isStrengthGoal && targetLifts.some((lift) => !lift.target_weight_kg || lift.target_weight_kg <= 0)) {
      next.target_lifts = t("onboarding.screen2.errors.targetLiftsRequired");
    }
    if (isPaceNeeded && targetWeight && currentWeight) {
      if (data.goal.type === "fat_loss" && targetWeight >= currentWeight) next.target = t("onboarding.screen2.errors.fatLossTarget");
      if (data.goal.type === "muscle_gain" && targetWeight <= currentWeight) next.target = t("onboarding.screen2.errors.muscleGainTarget");
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    navigation.navigate("Screen3Activity");
  };

  const onDateChange = (_: any, d?: Date) => {
    if (!d) return;
    setShowDatePicker(Platform.OS === "ios");
    updateGoal({ target_date: d.toISOString().slice(0, 10) });
    if (isPaceNeeded && targetWeight && currentWeight) {
      const weeks = Math.max(1, Math.ceil((d.getTime() - Date.now()) / (7 * 24 * 3600 * 1000)));
      const kgDiff = Math.abs((data.personal.unit_system === "metric" ? targetWeight : targetWeight / 2.20462) - (data.personal.unit_system === "metric" ? currentWeight : currentWeight / 2.20462));
      if (kgDiff / weeks > 1) setWarning(t("onboarding.screen2.deadlineWarning"));
      else setWarning("");
    }
  };

  const setGoalType = (type: string) => {
    updateGoal({
      type: type as any,
      target_lifts: type === "strength" ? targetLifts.slice(0, 3) : [],
    });
    setErrors({});
  };

  const addTargetLift = (exerciseName: string, exerciseId?: number | null) => {
    const cleanName = exerciseName.trim();
    if (!cleanName) return;
    const exists = targetLifts.some((lift) => lift.exercise_name.toLowerCase() === cleanName.toLowerCase());
    if (exists || targetLifts.length >= 3) return;
    updateGoal({ target_lifts: [...targetLifts, { exercise_id: exerciseId ?? null, exercise_name: cleanName, target_weight_kg: 0 }] });
  };

  const removeTargetLift = (exerciseName: string) => {
    updateGoal({
      target_lifts: targetLifts.filter((lift) => lift.exercise_name.toLowerCase() !== exerciseName.toLowerCase()),
    });
  };

  const updateTargetLiftWeight = (exerciseName: string, rawValue: string) => {
    const weight = Number(rawValue.replace(/[^0-9.]/g, ""));
    updateGoal({
      target_lifts: targetLifts.map((lift) =>
        lift.exercise_name === exerciseName ? { ...lift, target_weight_kg: Number.isFinite(weight) ? weight : 0 } : lift,
      ),
    });
  };

  return (
    <OnboardingLayout
      step={2}
      title={t("onboarding.screen2.title")}
      subtitle={t("onboarding.screen2.subtitle")}
      onBack={() => navigation.goBack()}
      onNext={validate}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <Text style={styles.label}>{t("onboarding.screen2.primaryGoal")}</Text>
      <TapCards options={GOAL_OPTIONS as any} value={data.goal.type} onChange={setGoalType} />
      {errors.goal ? <Text style={styles.error}>{errors.goal}</Text> : null}

      <View style={styles.block}>
        <Text style={styles.label}>{t("onboarding.screen2.difficulty")}</Text>
        <TapCards options={DIFFICULTY_OPTIONS as any} value={data.goal.difficulty} onChange={(v) => updateGoal({ difficulty: v as any })} />
        {errors.difficulty ? <Text style={styles.error}>{errors.difficulty}</Text> : null}
      </View>

      {isPaceNeeded ? (
        <View style={styles.block}>
          <Text style={styles.label}>{t("onboarding.screen2.goalPace")}</Text>
          <BottomSheetPicker label={t("onboarding.screen2.goalPace")} value={data.goal.pace} options={GOAL_PACE_OPTIONS} onChange={(v) => updateGoal({ pace: v as any })} placeholder={t("onboarding.screen2.goalPacePlaceholder")} error={errors.pace} />

          <Text style={[styles.label, { marginTop: 12 }]}>
            {data.goal.type === "fat_loss" ? t("onboarding.screen2.targetWeightLess", { currentWeight }) : t("onboarding.screen2.targetWeightMore", { currentWeight })}
          </Text>
          <BottomSheetPicker
            label={t("onboarding.screen2.targetWeight")}
            value={targetWeight}
            options={options}
            onChange={(v) =>
              data.personal.unit_system === "metric" ? updateGoal({ target_weight_kg: Number(v) }) : updateGoal({ target_weight_lb: Number(v) })
            }
            placeholder={t("onboarding.screen2.targetWeightPlaceholder")}
            error={errors.target}
          />
        </View>
      ) : null}

      {isStrengthGoal ? (
        <View style={styles.block}>
          <Text style={styles.label}>{t("onboarding.screen2.keyLifts")}</Text>
          <Text style={styles.helperText}>{t("onboarding.screen2.keyLiftsHelper")}</Text>
          <View style={styles.chipRow}>
            {SUGGESTED_STRENGTH_LIFTS.map((lift) => {
              const selected = targetLifts.some((item) => item.exercise_name.toLowerCase() === lift.name.toLowerCase());
              return (
                <Pressable
                  key={lift.name}
                  style={[styles.liftChip, selected ? styles.liftChipSelected : null]}
                  onPress={() => (selected ? removeTargetLift(lift.name) : addTargetLift(lift.name))}
                >
                  <Text style={[styles.liftChipText, selected ? styles.liftChipTextSelected : null]}>{t(lift.labelKey)}</Text>
                </Pressable>
              );
            })}
            <Pressable style={styles.liftChip} onPress={() => setShowCustomLift((prev) => !prev)}>
              <Text style={styles.liftChipText}>{t("onboarding.screen2.customLift")}</Text>
            </Pressable>
          </View>
          {showCustomLift ? (
            <View style={styles.customLiftRow}>
              <TextInput
                style={styles.customLiftInput}
                value={customLiftName}
                onChangeText={setCustomLiftName}
                placeholder={t("onboarding.screen2.customLiftPlaceholder")}
                placeholderTextColor={MUTED}
              />
              <Pressable
                style={styles.addLiftButton}
                onPress={() => {
                  addTargetLift(customLiftName);
                  setCustomLiftName("");
                  setShowCustomLift(false);
                }}
              >
                <Text style={styles.addLiftButtonText}>{t("onboarding.screen2.add")}</Text>
              </Pressable>
            </View>
          ) : null}
          {targetLifts.map((lift) => (
            <View key={lift.exercise_name} style={styles.targetLiftRow}>
              <View style={styles.targetLiftHeader}>
                <Text style={styles.targetLiftName}>{lift.exercise_name}</Text>
                <Text style={styles.removeLiftText} onPress={() => removeTargetLift(lift.exercise_name)}>
                  {t("onboarding.screen2.remove")}
                </Text>
              </View>
              <TextInput
                style={styles.targetLiftInput}
                value={lift.target_weight_kg ? String(lift.target_weight_kg) : ""}
                onChangeText={(value) => updateTargetLiftWeight(lift.exercise_name, value)}
                placeholder={t("onboarding.screen2.targetLiftWeightPlaceholder")}
                placeholderTextColor={MUTED}
                keyboardType="decimal-pad"
              />
            </View>
          ))}
          {errors.target_lifts ? <Text style={styles.error}>{errors.target_lifts}</Text> : null}
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>{t("onboarding.screen2.targetDate")}</Text>
        <View style={styles.dateTrigger}>
          <Text style={styles.dateText}>{data.goal.target_date || t("onboarding.screen2.selectDate")}</Text>
          <Text style={styles.dateAction} onPress={() => setShowDatePicker(true)}>{t("onboarding.screen2.pick")}</Text>
        </View>
        {showDatePicker ? <DateTimePicker value={dateValue} mode="date" display="default" onChange={onDateChange} /> : null}
        {warning ? <Text style={styles.error}>{warning}</Text> : null}
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  label: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  block: { marginTop: 12 },
  error: { marginTop: 4, fontSize: 12, color: ORANGE },
  helperText: { color: MUTED, fontSize: 13, marginBottom: 10, lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  liftChip: {
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 999,
    backgroundColor: BG,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  liftChipSelected: { borderColor: GREEN, backgroundColor: GREEN_LIGHT },
  liftChipText: { color: TEXT, fontSize: 13, fontWeight: "800" },
  liftChipTextSelected: { color: GREEN },
  customLiftRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  customLiftInput: {
    flex: 1,
    height: 46,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: BG,
    color: TEXT,
    paddingHorizontal: 12,
    fontWeight: "700",
  },
  addLiftButton: {
    height: 46,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN,
  },
  addLiftButtonText: { color: WHITE, fontWeight: "900" },
  targetLiftRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: WHITE,
    padding: 12,
  },
  targetLiftHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  targetLiftName: { color: TEXT, fontSize: 14, fontWeight: "900" },
  removeLiftText: { color: ORANGE, fontSize: 12, fontWeight: "900" },
  targetLiftInput: {
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: BG,
    color: TEXT,
    paddingHorizontal: 12,
    fontWeight: "800",
  },
  dateTrigger: { height: 48, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: BG },
  dateText: { color: TEXT, fontWeight: "700" },
  dateAction: { color: GREEN, fontWeight: "900" },
});
