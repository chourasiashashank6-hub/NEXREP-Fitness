import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { MultiChips } from "../../components/MultiChips";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import { ALLERGY_OPTIONS, DIET_TYPE_OPTIONS, MEALS_PER_DAY_OPTIONS, REGIONAL_FOOD_STYLE_OPTIONS } from "../../utils/onboardingOptions";

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
const NO_REGIONAL_PREFERENCE = "no_preference";

export default function Screen4Diet({ navigation }: any) {
  const { t } = useTranslation();
  const { data, updateDietary } = useOnboardingContext();
  const { saveAndExit, saving } = useOnboardingSaveAndExit();
  const [regionalOpen, setRegionalOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const regionalFoodStyles = data.dietary.regional_food_styles ?? [];
  const regionalFoodStyleLabelByValue = Object.fromEntries(REGIONAL_FOOD_STYLE_OPTIONS.map((option) => [option.value, option.label]));

  const updateRegionalFoodStyles = (next: string[]) => {
    updateDietary({ regional_food_styles: next });
    if (next.length) setErrors((prev) => ({ ...prev, regional_food_styles: "" }));
  };

  const toggleRegionalFoodStyle = (option: string) => {
    const selected = regionalFoodStyles.includes(option);
    if (selected) {
      updateRegionalFoodStyles(regionalFoodStyles.filter((item) => item !== option));
      return;
    }
    if (option === NO_REGIONAL_PREFERENCE) {
      updateRegionalFoodStyles([NO_REGIONAL_PREFERENCE]);
      return;
    }
    updateRegionalFoodStyles([...regionalFoodStyles.filter((item) => item !== NO_REGIONAL_PREFERENCE), option]);
  };

  const validate = () => {
    if (!regionalFoodStyles.length) {
      setErrors({ regional_food_styles: t("onboarding.screen4.errors.regionalRequired") });
      return;
    }
    navigation.navigate("Screen5BodyComp");
  };

  const saveScreen = async () => {
    if (!regionalFoodStyles.length) {
      setErrors({ regional_food_styles: t("onboarding.screen4.errors.regionalRequired") });
      return;
    }
    await saveAndExit();
  };

  return (
    <OnboardingLayout
      step={4}
      title={t("onboarding.screen4.title")}
      subtitle={t("onboarding.screen4.subtitle")}
      onBack={() => navigation.goBack()}
      onNext={validate}
      onSaveExit={saveScreen}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <Text style={styles.label}>{t("onboarding.screen4.dietType")}</Text>
      <BottomSheetPicker label={t("onboarding.screen4.dietType")} value={data.dietary.diet_type} options={DIET_TYPE_OPTIONS} onChange={(v) => updateDietary({ diet_type: String(v) })} placeholder={t("onboarding.screen4.noPreference")} />

      <View style={styles.block}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{t("onboarding.screen4.regionalFoodStyle")}</Text>
          <Text style={styles.required}>{t("onboarding.screen4.requiredHint")}</Text>
        </View>
        <Text style={styles.helperText}>{t("onboarding.screen4.regionalHelper")}</Text>
        <Pressable
          style={[
            styles.multiTrigger,
            regionalOpen ? styles.multiTriggerOpen : null,
            errors.regional_food_styles ? styles.multiTriggerError : null,
          ]}
          onPress={() => setRegionalOpen((prev) => !prev)}
        >
          <Text style={[styles.multiTriggerText, regionalFoodStyles.length ? null : styles.placeholder]}>
            {regionalFoodStyles.length ? t("onboarding.screen4.selectedCount", { count: regionalFoodStyles.length }) : t("onboarding.screen4.selectOneOrMore")}
          </Text>
          <Text style={[styles.chevron, regionalOpen ? styles.chevronOpen : null]}>▾</Text>
        </Pressable>
        {regionalOpen ? (
          <View style={styles.multiPanel}>
            <ScrollView nestedScrollEnabled style={styles.optionsList}>
              {REGIONAL_FOOD_STYLE_OPTIONS.map((option) => {
                const selected = regionalFoodStyles.includes(option.value);
                return (
                  <Pressable key={option.value} style={styles.optionRow} onPress={() => toggleRegionalFoodStyle(option.value)}>
                    <View style={[styles.checkbox, selected ? styles.checkboxSelected : null]}>
                      {selected ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                    <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        {regionalFoodStyles.length ? (
          <View style={styles.selectedChipRow}>
            {regionalFoodStyles.map((style) => (
              <Pressable
                key={style}
                style={styles.selectedChip}
                onPress={() => updateRegionalFoodStyles(regionalFoodStyles.filter((item) => item !== style))}
              >
                <Text style={styles.selectedChipText}>{regionalFoodStyleLabelByValue[style] ?? style}</Text>
                <Text style={styles.selectedChipRemove}>×</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {errors.regional_food_styles ? <Text style={styles.error}>{errors.regional_food_styles}</Text> : null}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t("onboarding.screen4.allergies")}</Text>
        <MultiChips options={ALLERGY_OPTIONS} values={data.dietary.allergies} onChange={(v) => updateDietary({ allergies: v })} />
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t("onboarding.screen4.mealsPerDay")}</Text>
        <BottomSheetPicker label={t("onboarding.screen4.mealsPerDay")} value={data.dietary.meals_per_day} options={MEALS_PER_DAY_OPTIONS} onChange={(v) => updateDietary({ meals_per_day: Number(v) })} placeholder={t("onboarding.screen4.mealsPlaceholder")} />
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  label: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  required: { color: ORANGE, fontSize: 12, fontWeight: "900", marginBottom: 8 },
  helperText: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  multiTrigger: {
    height: 48,
    backgroundColor: BG,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  multiTriggerOpen: { borderColor: GREEN, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  multiTriggerError: { borderColor: ORANGE },
  multiTriggerText: { color: TEXT, fontSize: 15, fontWeight: "700" },
  placeholder: { color: MUTED, fontWeight: "500" },
  chevron: { color: MUTED, fontSize: 15 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  multiPanel: {
    backgroundColor: WHITE,
    borderWidth: 1.5,
    borderColor: GREEN,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  optionsList: { maxHeight: 280 },
  optionRow: {
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: WHITE,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: { borderColor: GREEN, backgroundColor: GREEN_LIGHT },
  checkboxTick: { color: GREEN, fontSize: 14, fontWeight: "900", lineHeight: 16 },
  optionText: { color: TEXT, fontSize: 15, fontWeight: "600", flex: 1 },
  optionTextSelected: { color: GREEN, fontWeight: "800" },
  selectedChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  selectedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: GREEN_LIGHT,
    borderColor: GREEN,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectedChipText: { color: GREEN, fontSize: 13, fontWeight: "800" },
  selectedChipRemove: { color: GREEN, fontSize: 14, fontWeight: "900" },
  error: { marginTop: 6, fontSize: 12, color: ORANGE },
});
