import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { ToggleRow } from "../../components/ToggleRow";
import { ONBOARDING_COLORS } from "../../constants/onboarding";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { useOnboardingSaveAndExit } from "../../hooks/useOnboardingSaveAndExit";
import { REGION_OPTIONS, REMINDER_TIME_OPTIONS, WATER_GOAL_OPTIONS } from "../../utils/onboardingOptions";

export default function Screen6Setup({ navigation }: any) {
  const { data, updateAppSetup } = useOnboardingContext();
  const { saveAndExit } = useOnboardingSaveAndExit();
  const [saving, setSaving] = useState(false);

  const onFinish = async () => {
    setSaving(true);
    try {
      await saveAndExit();
    } catch (e: unknown) {
      // saveAndExit already shows user-facing errors.
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingLayout
      step={6}
      title="App setup"
      subtitle="Final preferences. These affect how the app behaves, not the calorie calculation."
      onBack={() => navigation.goBack()}
      onNext={onFinish}
      nextLabel="Save & exit"
      nextLoading={saving}
      nextDisabled={saving}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <ToggleRow
        label="Daily weigh-in reminder"
        subLabel="Needed for adaptive recalibration after day 14"
        value={data.app_setup.weigh_in_reminder_enabled}
        onChange={(v) => updateAppSetup({ weigh_in_reminder_enabled: v })}
      />
      {data.app_setup.weigh_in_reminder_enabled ? (
        <BottomSheetPicker label="Reminder time" value={data.app_setup.reminder_time} options={REMINDER_TIME_OPTIONS} onChange={(v) => updateAppSetup({ reminder_time: String(v) })} placeholder="7:00 AM" />
      ) : null}

      <Text style={styles.section}>Water intake goal</Text>
      <BottomSheetPicker label="Water intake goal" value={data.app_setup.water_intake_goal_liters} options={WATER_GOAL_OPTIONS} onChange={(v) => updateAppSetup({ water_intake_goal_liters: v as number | null })} placeholder="2.5 L (auto)" />

      <Text style={styles.section}>Notification preferences</Text>
      <ToggleRow label="Meal logging reminders" subLabel="Remind me to log breakfast, lunch, dinner" value={data.app_setup.notifications.meal_logging} onChange={(v) => updateAppSetup({ notifications: { ...data.app_setup.notifications, meal_logging: v } })} />
      <ToggleRow label="AI coach insights" subLabel="Daily tips based on your progress" value={data.app_setup.notifications.coach_insights} onChange={(v) => updateAppSetup({ notifications: { ...data.app_setup.notifications, coach_insights: v } })} />
      <ToggleRow label="Weekly progress summary" subLabel="Sunday recap of the week" value={data.app_setup.notifications.weekly_summary} onChange={(v) => updateAppSetup({ notifications: { ...data.app_setup.notifications, weekly_summary: v } })} />
      <ToggleRow label="Streak alerts" subLabel="Don't break your streak" value={data.app_setup.notifications.streak_alerts} onChange={(v) => updateAppSetup({ notifications: { ...data.app_setup.notifications, streak_alerts: v } })} />

      <Text style={styles.section}>Region / language</Text>
      <BottomSheetPicker label="Region / language" value={data.app_setup.region} options={REGION_OPTIONS} onChange={(v) => updateAppSetup({ region: String(v) })} placeholder="India (auto-detected)" />
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({ section: { marginTop: 12, marginBottom: 8, color: ONBOARDING_COLORS.textPrimary, fontSize: 16, fontWeight: "700" } });
