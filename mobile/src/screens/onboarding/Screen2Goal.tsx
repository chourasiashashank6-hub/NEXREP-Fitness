import { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
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

export default function Screen2Goal({ navigation }: any) {
  const { data, updateGoal } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [warning, setWarning] = useState("");

  const isPaceNeeded = data.goal.type === "fat_loss" || data.goal.type === "muscle_gain";
  const options = data.personal.unit_system === "metric" ? getMetricWeightOptions() : getImperialWeightOptions();
  const currentWeight = data.personal.unit_system === "metric" ? data.personal.weight_kg : data.personal.weight_lb;
  const targetWeight = data.personal.unit_system === "metric" ? data.goal.target_weight_kg : data.goal.target_weight_lb;

  const dateValue = useMemo(() => (data.goal.target_date ? new Date(data.goal.target_date) : new Date()), [data.goal.target_date]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!data.goal.type) next.goal = "Primary goal is required";
    if (!data.goal.difficulty) next.difficulty = "Difficulty is required";
    if (isPaceNeeded && !data.goal.pace) next.pace = "Goal pace is required";
    if (isPaceNeeded && !targetWeight) next.target = "Target weight is required";
    if (isPaceNeeded && targetWeight && currentWeight) {
      if (data.goal.type === "fat_loss" && targetWeight >= currentWeight) next.target = "For fat loss, target weight must be less than current weight";
      if (data.goal.type === "muscle_gain" && targetWeight <= currentWeight) next.target = "For muscle gain, target weight must be greater than current weight";
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
      if (kgDiff / weeks > 1) setWarning("Deadline may be unrealistic for safe progress (> 1 kg/week)");
      else setWarning("");
    }
  };

  return (
    <OnboardingLayout
      step={2}
      title="Your goal"
      subtitle="This determines whether you're in a deficit or surplus. Show this as tappable cards, not a dropdown."
      onBack={() => navigation.goBack()}
      onNext={validate}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <Text style={styles.label}>Primary goal</Text>
      <TapCards options={GOAL_OPTIONS as any} value={data.goal.type} onChange={(v) => updateGoal({ type: v as any })} />
      {errors.goal ? <Text style={styles.error}>{errors.goal}</Text> : null}

      <View style={styles.block}>
        <Text style={styles.label}>Difficulty</Text>
        <TapCards options={DIFFICULTY_OPTIONS as any} value={data.goal.difficulty} onChange={(v) => updateGoal({ difficulty: v as any })} />
        {errors.difficulty ? <Text style={styles.error}>{errors.difficulty}</Text> : null}
      </View>

      {isPaceNeeded ? (
        <View style={styles.block}>
          <Text style={styles.label}>Goal pace</Text>
          <BottomSheetPicker label="Goal pace" value={data.goal.pace} options={GOAL_PACE_OPTIONS} onChange={(v) => updateGoal({ pace: v as any })} placeholder="Select pace" error={errors.pace} />

          <Text style={[styles.label, { marginTop: 12 }]}>
            {data.goal.type === "fat_loss" ? `Target weight — must be less than ${currentWeight}` : `Target weight — must be more than ${currentWeight}`}
          </Text>
          <BottomSheetPicker
            label="Target weight"
            value={targetWeight}
            options={options}
            onChange={(v) =>
              data.personal.unit_system === "metric" ? updateGoal({ target_weight_kg: Number(v) }) : updateGoal({ target_weight_lb: Number(v) })
            }
            placeholder="Select target weight"
            error={errors.target}
          />
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>Target date (optional)</Text>
        <View style={styles.dateTrigger}>
          <Text style={styles.dateText}>{data.goal.target_date || "Select date"}</Text>
          <Text style={styles.dateAction} onPress={() => setShowDatePicker(true)}>Pick</Text>
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
  dateTrigger: { height: 48, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: BG },
  dateText: { color: TEXT, fontWeight: "700" },
  dateAction: { color: GREEN, fontWeight: "900" },
});
