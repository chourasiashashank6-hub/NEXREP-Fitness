import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { RequiredBadge, RequiredLabelRow } from "../../components/RequiredBadge";
import { ToggleRow } from "../../components/ToggleRow";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { StalePlanModal } from "../../components/StalePlanModal";
import { useOnboardingStalePlanCheck } from "../../hooks/useOnboardingStalePlanCheck";
import {
  getActivityLevel,
  getTdeeMultiplier,
  WORKOUTS_PER_WEEK_MAX,
  WORKOUTS_PER_WEEK_MIN,
} from "../../constants/onboarding";
import {
  focusMusclesHint,
  FOCUS_MUSCLE_UI_OPTIONS,
  getGoalFocusMuscles,
  isGoalFocusMuscleSelected,
  toggleGoalFocusMuscle,
} from "../../utils/onboardingFocusMuscles";
import type { ActivityLevel } from "../../types/onboarding";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";

const LEVEL_COPY: Record<ActivityLevel, string> = {
  sedentary: "A good starting point - we'll help you build a routine.",
  lightly_active: "Nice and steady - small consistent steps.",
  moderately_active: "Great pace for steady progress.",
  very_active: "Strong training rhythm - this fuels real results.",
  extremely_active: "Elite-level commitment - we'll fuel you to match.",
};

function workoutsLabel(count: number, t: (key: string, opts?: object) => string): string {
  if (count === 0) return t("onboarding.options.workouts.zero");
  if (count === 1) return t("onboarding.options.workouts.one");
  return t("onboarding.options.workouts.many", { count });
}

export default function Screen3Activity({ navigation }: any) {
  const { t } = useTranslation();
  const { data, updateActivity, updateGoal, updateAppSetup, isHydrating } = useOnboardingContext();
  const { saveWithCheck: saveAndExit, saving, modalProps } = useOnboardingStalePlanCheck();
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isHydrating) setErrors({});
  }, [isHydrating]);

  const selectedFocus = getGoalFocusMuscles(data.goal);
  const workoutsCount = data.activity.workouts_per_week ?? 0;
  const previewLevel = getActivityLevel(workoutsCount);

  const activityLevelLabels: Record<ActivityLevel, string> = {
    sedentary: t("onboarding.options.activity.sedentary"),
    lightly_active: t("onboarding.options.activity.lightlyActive"),
    moderately_active: t("onboarding.options.activity.moderatelyActive"),
    very_active: t("onboarding.options.activity.veryActive"),
    extremely_active: t("onboarding.options.activity.extremelyActive"),
  };

  useEffect(() => {
    const n = data.activity.workouts_per_week;
    if (n == null) return;
    const level = getActivityLevel(n);
    const tdee_multiplier = getTdeeMultiplier(n);
    if (data.activity.level !== level || data.activity.tdee_multiplier !== tdee_multiplier) {
      updateActivity({ level, tdee_multiplier });
    }
  }, [data.activity.workouts_per_week]);

  const setWorkoutsCount = (next: number) => {
    const clamped = Math.max(WORKOUTS_PER_WEEK_MIN, Math.min(WORKOUTS_PER_WEEK_MAX, next));
    updateActivity({
      workouts_per_week: clamped,
      level: getActivityLevel(clamped),
      tdee_multiplier: getTdeeMultiplier(clamped),
    });
    if (errors.workouts) setErrors((prev) => ({ ...prev, workouts: "" }));
  };

  const onNext = () => {
    const next: Record<string, string> = {};
    if (data.activity.workouts_per_week === null || data.activity.workouts_per_week < 1) {
      next.workouts = t("onboarding.screen3.errors.workoutsRequired");
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    navigation.navigate("Screen4Diet");
  };

  return (
    <>
      <OnboardingLayout
        step={3}
        title={t("onboarding.screen3.title")}
        subtitle={t("onboarding.screen3.subtitle")}
        onBack={() => navigation.goBack()}
        onNext={onNext}
        onSaveExit={saveAndExit}
        saveLoading={saving}
        saveDisabled={saving}
      >
        <RequiredLabelRow>
          <Text style={styles.labelInline}>{t("onboarding.screen3.workoutsPerWeek")}</Text>
          <RequiredBadge />
        </RequiredLabelRow>

        <View style={styles.stepperRow}>
          <Pressable
            style={[styles.stepperBtn, workoutsCount <= WORKOUTS_PER_WEEK_MIN && styles.stepperBtnDisabled]}
            onPress={() => setWorkoutsCount(workoutsCount - 1)}
            disabled={workoutsCount <= WORKOUTS_PER_WEEK_MIN}
          >
            <Text style={styles.stepperBtnText}>−</Text>
          </Pressable>
          <View style={styles.stepperValueWrap}>
            <Text style={styles.stepperValue}>{workoutsLabel(workoutsCount, t)}</Text>
          </View>
          <Pressable
            style={[styles.stepperBtn, workoutsCount >= WORKOUTS_PER_WEEK_MAX && styles.stepperBtnDisabled]}
            onPress={() => setWorkoutsCount(workoutsCount + 1)}
            disabled={workoutsCount >= WORKOUTS_PER_WEEK_MAX}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </Pressable>
        </View>
        {errors.workouts ? <Text style={styles.error}>{errors.workouts}</Text> : null}

        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>{activityLevelLabels[previewLevel]}</Text>
          <Text style={styles.previewCopy}>{LEVEL_COPY[previewLevel]}</Text>
        </View>

        <View style={styles.block}>
          <ToggleRow
            label={t("onboarding.screen3.preWorkoutEnabled")}
            subLabel={t("onboarding.screen3.preWorkoutEnabledSub")}
            value={data.app_setup.pre_workout_enabled !== false}
            onChange={(enabled) => updateAppSetup({ pre_workout_enabled: enabled })}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>{t("onboarding.screen3.muscleFocusOptional")}</Text>
          <Text style={styles.sub}>{t("onboarding.screen3.muscleFocusHelper")}</Text>
          <View style={styles.chips}>
            {FOCUS_MUSCLE_UI_OPTIONS.map((muscle) => {
              const selected = isGoalFocusMuscleSelected(data.goal, muscle);
              return (
                <Pressable
                  key={muscle}
                  style={[styles.chip, selected ? styles.chipSelected : null]}
                  onPress={() => updateGoal(toggleGoalFocusMuscle(data.goal, muscle))}
                >
                  <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{muscle}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{focusMusclesHint(selectedFocus)}</Text>
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
  sub: { color: MUTED, fontSize: 13, marginBottom: 10 },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperBtnText: { color: TEXT, fontSize: 24, fontWeight: "700", lineHeight: 28 },
  stepperValueWrap: {
    flex: 1,
    backgroundColor: BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 14,
    alignItems: "center",
  },
  stepperValue: { color: TEXT, fontSize: 18, fontWeight: "800" },
  previewCard: {
    marginTop: 16,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GREEN,
    padding: 16,
  },
  previewTitle: { color: GREEN, fontSize: 17, fontWeight: "900", marginBottom: 6 },
  previewCopy: { color: TEXT, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: BG,
    borderColor: "transparent",
    borderWidth: 1.5,
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  chipLabel: { color: MUTED, fontSize: 13, fontWeight: "700" },
  chipLabelSelected: { color: GREEN, fontWeight: "900" },
  hint: { marginTop: 8, fontSize: 12, color: MUTED },
  error: { marginTop: 4, fontSize: 12, color: ORANGE },
});
