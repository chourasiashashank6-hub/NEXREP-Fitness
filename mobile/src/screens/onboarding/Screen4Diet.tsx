import { StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { MultiChips } from "../../components/MultiChips";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { RequiredBadge, RequiredLabelRow } from "../../components/RequiredBadge";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { StalePlanModal } from "../../components/StalePlanModal";
import { useOnboardingStalePlanCheck } from "../../hooks/useOnboardingStalePlanCheck";
import {
  buildMealsPerDayOptions,
  getEstimatedDailyCalories,
  isMealsPerDayDisabled,
} from "../../utils/mealsPerDayConstraints";
import { ALLERGY_OPTIONS, DIET_TYPE_OPTIONS, MEALS_PER_DAY_OPTIONS } from "../../utils/onboardingOptions";
import { TEXT } from "../../theme/colors";

export default function Screen4Diet({ navigation }: any) {
  const { t } = useTranslation();
  const { data, updateDietary } = useOnboardingContext();
  const { saveWithCheck: saveAndExit, saving, modalProps } = useOnboardingStalePlanCheck();
  const [dietError, setDietError] = useState<string>("");

  const estimatedDailyCalories = useMemo(() => getEstimatedDailyCalories(data), [data]);

  const mealsPerDayOptions = useMemo(() => {
    if (estimatedDailyCalories == null) return MEALS_PER_DAY_OPTIONS;
    return buildMealsPerDayOptions(estimatedDailyCalories, MEALS_PER_DAY_OPTIONS, t);
  }, [estimatedDailyCalories, t]);

  useEffect(() => {
    if (estimatedDailyCalories == null) return;
    const current = data.dietary.meals_per_day;
    if (current == null) return;
    if (isMealsPerDayDisabled(estimatedDailyCalories, current)) {
      updateDietary({ meals_per_day: null });
    }
  }, [estimatedDailyCalories, data.dietary.meals_per_day, updateDietary]);

  const validateAndNext = () => {
    if (!String(data.dietary.diet_type || "").trim()) {
      setDietError(t("onboarding.screen4.errors.dietTypeRequired"));
      return;
    }
    setDietError("");
    navigation.navigate("Screen5BodyComp");
  };

  return (
    <>
    <OnboardingLayout
      step={4}
      title={t("onboarding.screen4.title")}
      subtitle={t("onboarding.screen4.subtitle")}
      onBack={() => navigation.goBack()}
      onNext={validateAndNext}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <RequiredLabelRow>
        <Text style={styles.labelInline}>{t("onboarding.screen4.dietType")}</Text>
        <RequiredBadge />
      </RequiredLabelRow>
      <BottomSheetPicker
        label={t("onboarding.screen4.dietType")}
        value={data.dietary.diet_type}
        options={DIET_TYPE_OPTIONS}
        onChange={(v) => {
          updateDietary({ diet_type: String(v) });
          setDietError("");
        }}
        placeholder={t("onboarding.screen4.noPreference")}
        error={dietError}
      />

      <View style={styles.block}>
        <Text style={styles.label}>{t("onboarding.screen4.allergies")}</Text>
        <MultiChips options={ALLERGY_OPTIONS} values={data.dietary.allergies} onChange={(v) => updateDietary({ allergies: v })} />
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t("onboarding.screen4.mealsPerDay")}</Text>
        <BottomSheetPicker
          label={t("onboarding.screen4.mealsPerDay")}
          value={data.dietary.meals_per_day}
          options={mealsPerDayOptions}
          onChange={(v) => updateDietary({ meals_per_day: Number(v) })}
          placeholder={t("onboarding.screen4.mealsPlaceholder")}
        />
      </View>
    </OnboardingLayout>
  <StalePlanModal {...modalProps} />
    </>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  label: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  labelInline: { color: TEXT, fontSize: 16, fontWeight: "800", flexShrink: 1 },
});
