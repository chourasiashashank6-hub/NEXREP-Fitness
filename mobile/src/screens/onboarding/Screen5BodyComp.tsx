import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { StalePlanModal } from "../../components/StalePlanModal";
import { useOnboardingStalePlanCheck } from "../../hooks/useOnboardingStalePlanCheck";
import { BF_METHOD_OPTIONS, BODY_FAT_OPTIONS } from "../../utils/onboardingOptions";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../../theme/colors";

const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GOLD = "#FFD700";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const SCREEN_BG = WHITE;

export default function Screen5BodyComp({ navigation }: any) {
  const { t } = useTranslation();
  const { data, updatePersonal } = useOnboardingContext();
  const { saveWithCheck: saveAndExit, saving, modalProps } = useOnboardingStalePlanCheck();

  return (
    <>
    <OnboardingLayout
      step={5}
      title={t("onboarding.screen5.title")}
      subtitle={t("onboarding.screen5.subtitle")}
      onBack={() => navigation.navigate("Screen4Diet")}
      onNext={() => navigation.navigate("Screen6Setup")}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
      extraFooter={
        <Pressable onPress={() => navigation.navigate("Screen6Setup")}>
          <Text style={styles.skip}>{t("onboarding.screen5.skip")}</Text>
        </Pressable>
      }
    >
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>{t("onboarding.screen5.infoBody")}</Text>
      </View>
      <Text style={styles.label}>{t("onboarding.screen5.bodyFatPercentage")}</Text>
      <BottomSheetPicker label={t("onboarding.screen5.bodyFatPercentage")} value={data.personal.body_fat_percentage} options={BODY_FAT_OPTIONS} onChange={(v) => updatePersonal({ body_fat_percentage: v as number | null, bf_measurement_method: v === null ? null : data.personal.bf_measurement_method })} placeholder={t("onboarding.screen5.bodyFatPlaceholder")} />

      {data.personal.body_fat_percentage !== null ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>{t("onboarding.screen5.measurementMethod")}</Text>
          <BottomSheetPicker label={t("onboarding.screen5.measurementMethod")} value={data.personal.bf_measurement_method} options={BF_METHOD_OPTIONS} onChange={(v) => updatePersonal({ bf_measurement_method: v as any })} placeholder={t("onboarding.screen5.measurementPlaceholder")} />
        </View>
      ) : null}
    </OnboardingLayout>
  <StalePlanModal {...modalProps} />
    </>
  );
}

const styles = StyleSheet.create({
  infoBox: { backgroundColor: GREEN_LIGHT, borderRadius: 14, padding: 14, marginBottom: 12 },
  infoText: { color: GREEN, fontSize: 13, fontWeight: "800", lineHeight: 19 },
  label: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  skip: { color: GREEN, fontSize: 13, marginBottom: 10, fontWeight: "900", textAlign: "center" },
});
