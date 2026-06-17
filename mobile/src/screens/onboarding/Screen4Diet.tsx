import { StyleSheet, Text, View } from "react-native";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { MultiChips } from "../../components/MultiChips";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import { ALLERGY_OPTIONS, DIET_TYPE_OPTIONS, MEALS_PER_DAY_OPTIONS } from "../../utils/onboardingOptions";

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

export default function Screen4Diet({ navigation }: any) {
  const { data, updateDietary } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();

  return (
    <OnboardingLayout
      step={4}
      title="Diet preferences"
      subtitle="Not required for calorie math, but critical for the AI coach to give relevant food suggestions. Keep this light — max 3 questions."
      onBack={() => navigation.goBack()}
      onNext={() => navigation.navigate("Screen5BodyComp")}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <Text style={styles.label}>Diet type</Text>
      <BottomSheetPicker label="Diet type" value={data.dietary.diet_type} options={DIET_TYPE_OPTIONS} onChange={(v) => updateDietary({ diet_type: String(v) })} placeholder="No preference" />

      <View style={styles.block}>
        <Text style={styles.label}>Food allergies / intolerances</Text>
        <MultiChips options={ALLERGY_OPTIONS} values={data.dietary.allergies} onChange={(v) => updateDietary({ allergies: v })} />
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Meals per day</Text>
        <BottomSheetPicker label="Meals per day" value={data.dietary.meals_per_day} options={MEALS_PER_DAY_OPTIONS} onChange={(v) => updateDietary({ meals_per_day: Number(v) })} placeholder="3 meals" />
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  label: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
});
