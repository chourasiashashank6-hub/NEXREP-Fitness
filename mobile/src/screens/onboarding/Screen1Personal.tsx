import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { StalePlanModal } from "../../components/StalePlanModal";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingStalePlanCheck } from "../../hooks/useOnboardingStalePlanCheck";
import { AGE_OPTIONS, getImperialHeightOptions, getImperialWeightOptions, getMetricHeightOptions, getMetricWeightOptions, SEX_OPTIONS } from "../../utils/onboardingOptions";
import { issuesToFieldErrors, reconcileOnboarding, validateScreen1 } from "../../utils/onboardingValidator";
import { cmToIn, inToCm, kgToLb, lbToKg, roundToNearest } from "../../utils/units";
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

export default function Screen1Personal({ navigation }: any) {
  const { t } = useTranslation();
  const { data, hydrate, isHydrating } = useOnboardingContext();
  const [reconcileNote, setReconcileNote] = useState<string>("");
  const { saveWithCheck: saveAndExit, saving, saveError, modalProps } = useOnboardingStalePlanCheck(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clearError = (key: string) => {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  useEffect(() => {
    if (!isHydrating) setErrors({});
  }, [isHydrating]);

  const heightOptions = useMemo(
    () => (data.personal.unit_system === "metric" ? getMetricHeightOptions() : getImperialHeightOptions()),
    [data.personal.unit_system],
  );
  const weightOptions = useMemo(
    () => (data.personal.unit_system === "metric" ? getMetricWeightOptions() : getImperialWeightOptions()),
    [data.personal.unit_system],
  );

  const applyPersonal = (updates: Partial<typeof data.personal>) => {
    const merged = { ...data, personal: { ...data.personal, ...updates } };
    const { data: reconciled, notices } = reconcileOnboarding(merged, "personal");
    hydrate(reconciled);
    if (notices.length) {
      setReconcileNote(t("onboarding.reconcile.personalChanged"));
    } else {
      setReconcileNote("");
    }
  };

  const handleUnitSwitch = (unit: "metric" | "imperial") => {
    if (unit === data.personal.unit_system) return;
    if (unit === "imperial") {
      const convertedIn = data.personal.height_cm ? Math.min(98, Math.max(39, Math.round(cmToIn(data.personal.height_cm)))) : null;
      const convertedLb = data.personal.weight_kg ? Math.min(660, Math.max(66, roundToNearest(kgToLb(data.personal.weight_kg), 1))) : null;
      applyPersonal({ unit_system: "imperial", height_in: convertedIn, weight_lb: convertedLb, height_cm: null, weight_kg: null });
      return;
    }
    const convertedCm = data.personal.height_in ? Math.min(250, Math.max(100, Math.round(inToCm(data.personal.height_in)))) : null;
    const convertedKg = data.personal.weight_lb ? Math.min(300, Math.max(30, roundToNearest(lbToKg(data.personal.weight_lb), 0.5))) : null;
    applyPersonal({ unit_system: "metric", height_cm: convertedCm, weight_kg: convertedKg, height_in: null, weight_lb: null });
  };

  const validate = () => {
    const next = issuesToFieldErrors(t, validateScreen1(data));
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    navigation.navigate("Screen2Goal");
  };

  const selectedHeight = data.personal.unit_system === "metric" ? data.personal.height_cm : data.personal.height_in;
  const selectedWeight = data.personal.unit_system === "metric" ? data.personal.weight_kg : data.personal.weight_lb;

  return (
    <>
    <OnboardingLayout
      step={1}
      title={t("onboarding.screen1.title")}
      subtitle={t("onboarding.screen1.subtitle")}
      hideBack
      onNext={validate}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
      saveError={saveError}
    >
      <FieldCard title={t("onboarding.screen1.fullName")} badge={t("common.required")} type={t("onboarding.fieldTypes.textInput")} required description={t("onboarding.screen1.fullNameDescription")} error={errors.name}>
        <TextInput
          value={data.personal.name}
          onChangeText={(v) => {
            applyPersonal({ name: v });
            if (v.trim()) clearError("name");
          }}
          autoCapitalize="words"
          placeholder={t("onboarding.screen1.fullNamePlaceholder")}
          placeholderTextColor={MUTED}
          style={[styles.textInput, errors.name ? styles.inputError : null]}
        />
      </FieldCard>

      <FieldCard title={t("onboarding.screen1.unitPreference")} badge={t("common.required")} type={t("onboarding.fieldTypes.segmentedToggle")} required description={t("onboarding.screen1.unitPreferenceDescription")}>
        <View style={styles.segmentWrap}>
          <Pressable style={[styles.seg, data.personal.unit_system === "metric" ? styles.segActive : null]} onPress={() => handleUnitSwitch("metric")}>
            <Text style={[styles.segText, data.personal.unit_system === "metric" ? styles.segTextActive : null]}>{t("onboarding.screen1.metric")}</Text>
          </Pressable>
          <Pressable style={[styles.seg, data.personal.unit_system === "imperial" ? styles.segActive : null]} onPress={() => handleUnitSwitch("imperial")}>
            <Text style={[styles.segText, data.personal.unit_system === "imperial" ? styles.segTextActive : null]}>{t("onboarding.screen1.imperial")}</Text>
          </Pressable>
        </View>
      </FieldCard>

      <FieldCard title={t("onboarding.screen1.age")} badge={t("common.required")} type={t("onboarding.fieldTypes.dropdownPicker")} required error={errors.age}>
        <BottomSheetPicker
          label={t("onboarding.screen1.age")}
          value={data.personal.age}
          options={AGE_OPTIONS}
          onChange={(v) => {
            applyPersonal({ age: Number(v) });
            clearError("age");
          }}
          placeholder={t("onboarding.screen1.agePlaceholder")}
        />
      </FieldCard>

      <FieldCard title={t("onboarding.screen1.biologicalSex")} badge={t("common.required")} type={t("onboarding.fieldTypes.dropdownPicker")} required description={t("onboarding.screen1.biologicalSexDescription")} error={errors.sex}>
        <BottomSheetPicker label={t("onboarding.screen1.biologicalSex")} value={data.personal.sex} options={SEX_OPTIONS} onChange={(v) => { applyPersonal({ sex: v as any }); clearError("sex"); }} placeholder={t("common.select")} />
      </FieldCard>

      <FieldCard title={t("onboarding.screen1.height")} badge={t("common.required")} type={t("onboarding.fieldTypes.dropdownPicker")} required error={errors.height}>
        <BottomSheetPicker
          label={t("onboarding.screen1.height")}
          value={selectedHeight}
          options={heightOptions}
          onChange={(v) => {
            applyPersonal(data.personal.unit_system === "metric" ? { height_cm: Number(v) } : { height_in: Number(v) });
            clearError("height");
          }}
          placeholder={t("onboarding.screen1.heightPlaceholder")}
        />
      </FieldCard>

      <FieldCard title={t("onboarding.screen1.currentWeight")} badge={t("common.required")} type={t("onboarding.fieldTypes.dropdownPicker")} required error={errors.weight}>
        <BottomSheetPicker
          label={t("onboarding.screen1.currentWeight")}
          value={selectedWeight}
          options={weightOptions}
          onChange={(v) => {
            applyPersonal(data.personal.unit_system === "metric" ? { weight_kg: Number(v) } : { weight_lb: Number(v) });
            clearError("weight");
          }}
          placeholder={t("onboarding.screen1.weightPlaceholder")}
        />
      </FieldCard>
      {reconcileNote ? <Text style={styles.reconcileNote}>{reconcileNote}</Text> : null}
    </OnboardingLayout>
    <StalePlanModal {...modalProps} />
    </>
  );
}

const FieldCard = ({ title, badge, type, description, children, error, required }: any) => (
  <View style={[styles.fieldCard, error ? styles.cardError : null]}>
    <View style={styles.titleRow}>
      <Text style={styles.fieldTitle}>{title}</Text>
      <View style={[styles.badge, required ? styles.badgeRequired : styles.badgeOptional]}>
        <Text style={[styles.badgeText, required ? styles.badgeReqText : styles.badgeOptText]}>{badge}</Text>
      </View>
    </View>
    {description ? <Text style={styles.desc}>{description}</Text> : null}
    <View style={{ marginTop: 10 }}>{children}</View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  fieldCard: { backgroundColor: BG, borderRadius: 14, borderWidth: 2, borderColor: "transparent", padding: 16, marginBottom: 12 },
  cardError: { borderColor: ORANGE },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fieldTitle: { fontSize: 16, fontWeight: "800", color: TEXT },
  badge: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRequired: { backgroundColor: ORANGE_LIGHT },
  badgeOptional: { backgroundColor: GREEN_LIGHT },
  badgeText: { fontSize: 11, fontWeight: "800" },
  badgeReqText: { color: ORANGE },
  badgeOptText: { color: GREEN },
  desc: { fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 19 },
  textInput: { height: 48, borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 14, color: TEXT, backgroundColor: WHITE, fontWeight: "700" },
  inputError: { borderColor: ORANGE },
  error: { marginTop: 4, fontSize: 12, color: ORANGE },
  segmentWrap: { flexDirection: "row", gap: 8 },
  seg: { flex: 1, height: 48, borderRadius: 12, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: GREEN },
  segText: { color: MUTED, fontSize: 13, fontWeight: "800" },
  segTextActive: { color: WHITE, fontWeight: "900" },
  reconcileNote: { color: ORANGE, fontSize: 12, lineHeight: 18, marginBottom: 8 },
});
