import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { ONBOARDING_COLORS } from "../../constants/onboarding";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import { BF_METHOD_OPTIONS, BODY_FAT_OPTIONS } from "../../utils/onboardingOptions";

export default function Screen5BodyComp({ navigation }: any) {
  const { data, updatePersonal } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();

  return (
    <OnboardingLayout
      step={5}
      title="Body composition"
      subtitle="Optional — but unlocks a more accurate calorie formula."
      onBack={() => navigation.goBack()}
      onNext={() => navigation.navigate("Screen6Setup")}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
      extraFooter={
        <Pressable onPress={() => navigation.navigate("Screen6Setup")}>
          <Text style={styles.skip}>Skip this step →</Text>
        </Pressable>
      }
    >
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>If you enter your body fat %, we switch from Mifflin-St Jeor to Katch-McArdle — more accurate for muscular or heavier users.</Text>
      </View>
      <Text style={styles.label}>Body fat percentage</Text>
      <BottomSheetPicker label="Body fat percentage" value={data.personal.body_fat_percentage} options={BODY_FAT_OPTIONS} onChange={(v) => updatePersonal({ body_fat_percentage: v as number | null, bf_measurement_method: v === null ? null : data.personal.bf_measurement_method })} placeholder="Skip — I don't know" />

      {data.personal.body_fat_percentage !== null ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>How did you measure it?</Text>
          <BottomSheetPicker label="How did you measure it?" value={data.personal.bf_measurement_method} options={BF_METHOD_OPTIONS} onChange={(v) => updatePersonal({ bf_measurement_method: v as any })} placeholder="Select method" />
        </View>
      ) : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  infoBox: { backgroundColor: "#1E1B3A", borderRadius: 10, padding: 14, marginBottom: 12 },
  infoText: { color: "#AFA9EC", fontSize: 13 },
  label: { color: ONBOARDING_COLORS.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  skip: { color: ONBOARDING_COLORS.textSecondary, fontSize: 13, marginBottom: 10 },
});
