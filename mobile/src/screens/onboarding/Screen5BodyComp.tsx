import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import { BF_METHOD_OPTIONS, BODY_FAT_OPTIONS } from "../../utils/onboardingOptions";

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
        <Text style={styles.infoText}>💡 If you enter your body fat %, we switch from Mifflin-St Jeor to Katch-McArdle — more accurate for muscular or heavier users.</Text>
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
  infoBox: { backgroundColor: GREEN_LIGHT, borderRadius: 14, padding: 14, marginBottom: 12 },
  infoText: { color: GREEN, fontSize: 13, fontWeight: "800", lineHeight: 19 },
  label: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  skip: { color: GREEN, fontSize: 13, marginBottom: 10, fontWeight: "900", textAlign: "center" },
});
