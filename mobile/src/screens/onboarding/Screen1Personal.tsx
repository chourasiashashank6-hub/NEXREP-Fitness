import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { ONBOARDING_COLORS } from "../../constants/onboarding";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import { AGE_OPTIONS, getImperialHeightOptions, getImperialWeightOptions, getMetricHeightOptions, getMetricWeightOptions, SEX_OPTIONS } from "../../utils/onboardingOptions";
import { cmToIn, inToCm, kgToLb, lbToKg, roundToNearest } from "../../utils/units";

const REQUIRED = "Required";

export default function Screen1Personal({ navigation }: any) {
  const { data, updatePersonal } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const heightOptions = useMemo(
    () => (data.personal.unit_system === "metric" ? getMetricHeightOptions() : getImperialHeightOptions()),
    [data.personal.unit_system],
  );
  const weightOptions = useMemo(
    () => (data.personal.unit_system === "metric" ? getMetricWeightOptions() : getImperialWeightOptions()),
    [data.personal.unit_system],
  );

  const handleUnitSwitch = (unit: "metric" | "imperial") => {
    if (unit === data.personal.unit_system) return;
    if (unit === "imperial") {
      const convertedIn = data.personal.height_cm ? Math.min(98, Math.max(39, Math.round(cmToIn(data.personal.height_cm)))) : null;
      const convertedLb = data.personal.weight_kg ? Math.min(660, Math.max(66, roundToNearest(kgToLb(data.personal.weight_kg), 1))) : null;
      updatePersonal({ unit_system: "imperial", height_in: convertedIn, weight_lb: convertedLb, height_cm: null, weight_kg: null });
      return;
    }
    const convertedCm = data.personal.height_in ? Math.min(250, Math.max(100, Math.round(inToCm(data.personal.height_in)))) : null;
    const convertedKg = data.personal.weight_lb ? Math.min(300, Math.max(30, roundToNearest(lbToKg(data.personal.weight_lb), 0.5))) : null;
    updatePersonal({ unit_system: "metric", height_cm: convertedCm, weight_kg: convertedKg, height_in: null, weight_lb: null });
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!data.personal.name.trim()) next.name = "Full name is required";
    if (!data.personal.age) next.age = "Age is required";
    if (!data.personal.sex) next.sex = "Biological sex is required";
    if (data.personal.unit_system === "metric") {
      if (!data.personal.height_cm) next.height = "Height is required";
      if (!data.personal.weight_kg) next.weight = "Current weight is required";
    } else {
      if (!data.personal.height_in) next.height = "Height is required";
      if (!data.personal.weight_lb) next.weight = "Current weight is required";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    navigation.navigate("Screen2Goal");
  };

  const selectedHeight = data.personal.unit_system === "metric" ? data.personal.height_cm : data.personal.height_in;
  const selectedWeight = data.personal.unit_system === "metric" ? data.personal.weight_kg : data.personal.weight_lb;

  return (
    <OnboardingLayout
      step={1}
      title="Basic info"
      subtitle="The minimum you need to calculate BMR. Every field here is required."
      hideBack
      onNext={validate}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <FieldCard title="Full name" badge={REQUIRED} type="Text input" description="Free text — used only for personalization in coach messages" error={errors.name}>
        <TextInput
          value={data.personal.name}
          onChangeText={(v) => updatePersonal({ name: v })}
          autoCapitalize="words"
          placeholder="Enter full name"
          placeholderTextColor={ONBOARDING_COLORS.textTertiary}
          style={[styles.textInput, errors.name ? styles.inputError : null]}
        />
      </FieldCard>

      <FieldCard title="Unit preference" badge={REQUIRED} type="Segmented toggle" description="Metric (kg, cm) or Imperial (lbs, ft/in) — ask this first so height/weight inputs show the right unit">
        <View style={styles.segmentWrap}>
          <Pressable style={[styles.seg, data.personal.unit_system === "metric" ? styles.segActive : null]} onPress={() => handleUnitSwitch("metric")}>
            <Text style={[styles.segText, data.personal.unit_system === "metric" ? styles.segTextActive : null]}>Metric (kg, cm)</Text>
          </Pressable>
          <Pressable style={[styles.seg, data.personal.unit_system === "imperial" ? styles.segActive : null]} onPress={() => handleUnitSwitch("imperial")}>
            <Text style={[styles.segText, data.personal.unit_system === "imperial" ? styles.segTextActive : null]}>Imperial (lbs, in)</Text>
          </Pressable>
        </View>
      </FieldCard>

      <FieldCard title="Age" badge={REQUIRED} type="Dropdown (Picker)" error={errors.age}>
        <BottomSheetPicker
          label="Age"
          value={data.personal.age}
          options={AGE_OPTIONS}
          onChange={(v) => updatePersonal({ age: Number(v) })}
          placeholder="Select age"
          error={errors.age}
        />
      </FieldCard>

      <FieldCard title="Biological sex" badge={REQUIRED} type="Dropdown (Picker)" description="Male / Female / Prefer not to say — affects BMR constant (+5 or −161)" error={errors.sex}>
        <BottomSheetPicker label="Biological sex" value={data.personal.sex} options={SEX_OPTIONS} onChange={(v) => updatePersonal({ sex: v as any })} placeholder="Select" error={errors.sex} />
      </FieldCard>

      <FieldCard title="Height" badge={REQUIRED} type="Dropdown (Picker)" error={errors.height}>
        <BottomSheetPicker
          label="Height"
          value={selectedHeight}
          options={heightOptions}
          onChange={(v) =>
            data.personal.unit_system === "metric" ? updatePersonal({ height_cm: Number(v) }) : updatePersonal({ height_in: Number(v) })
          }
          placeholder="Select height"
          error={errors.height}
        />
      </FieldCard>

      <FieldCard title="Current weight" badge={REQUIRED} type="Dropdown (Picker)" error={errors.weight}>
        <BottomSheetPicker
          label="Current weight"
          value={selectedWeight}
          options={weightOptions}
          onChange={(v) =>
            data.personal.unit_system === "metric" ? updatePersonal({ weight_kg: Number(v) }) : updatePersonal({ weight_lb: Number(v) })
          }
          placeholder="Select weight"
          error={errors.weight}
        />
      </FieldCard>
    </OnboardingLayout>
  );
}

const FieldCard = ({ title, badge, type, description, children, error }: any) => (
  <View style={[styles.fieldCard, error ? styles.cardError : null]}>
    <View style={styles.titleRow}>
      <Text style={styles.fieldTitle}>{title}</Text>
      <View style={[styles.badge, badge === "Required" ? styles.badgeRequired : styles.badgeOptional]}>
        <Text style={[styles.badgeText, badge === "Required" ? styles.badgeReqText : styles.badgeOptText]}>{badge}</Text>
      </View>
    </View>
    <Text style={styles.type}>{type}</Text>
    {description ? <Text style={styles.desc}>{description}</Text> : null}
    <View style={{ marginTop: 10 }}>{children}</View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  fieldCard: { backgroundColor: ONBOARDING_COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: ONBOARDING_COLORS.border, padding: 16, marginBottom: 12 },
  cardError: { borderColor: ONBOARDING_COLORS.danger },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fieldTitle: { fontSize: 16, fontWeight: "700", color: ONBOARDING_COLORS.textPrimary },
  badge: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRequired: { backgroundColor: ONBOARDING_COLORS.requiredBg, borderColor: ONBOARDING_COLORS.requiredText },
  badgeOptional: { backgroundColor: ONBOARDING_COLORS.optionalBg, borderColor: ONBOARDING_COLORS.optionalText },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeReqText: { color: ONBOARDING_COLORS.requiredText },
  badgeOptText: { color: ONBOARDING_COLORS.optionalText },
  type: { fontSize: 13, color: ONBOARDING_COLORS.textTertiary, marginTop: 2 },
  desc: { fontSize: 13, color: ONBOARDING_COLORS.textSecondary, marginTop: 4, lineHeight: 19 },
  textInput: { height: 48, borderWidth: 1, borderColor: ONBOARDING_COLORS.border, borderRadius: 10, paddingHorizontal: 14, color: ONBOARDING_COLORS.textPrimary, backgroundColor: ONBOARDING_COLORS.card },
  inputError: { borderColor: ONBOARDING_COLORS.danger },
  error: { marginTop: 4, fontSize: 12, color: ONBOARDING_COLORS.danger },
  segmentWrap: { flexDirection: "row", gap: 8 },
  seg: { flex: 1, height: 48, borderRadius: 10, borderWidth: 1, borderColor: ONBOARDING_COLORS.border, alignItems: "center", justifyContent: "center" },
  segActive: { borderColor: ONBOARDING_COLORS.primary, backgroundColor: "#1E1B3A" },
  segText: { color: ONBOARDING_COLORS.textSecondary, fontSize: 13 },
  segTextActive: { color: ONBOARDING_COLORS.primary, fontWeight: "700" },
});
