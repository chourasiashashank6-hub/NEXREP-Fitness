import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheetPicker } from "../../components/BottomSheetPicker";
import { OnboardingLayout } from "../../components/OnboardingLayout";
import { ToggleRow } from "../../components/ToggleRow";
import { useOnboardingContext } from "../../hooks/OnboardingContext";
import { StalePlanModal } from "../../components/StalePlanModal";
import { useOnboardingStalePlanCheck } from "../../hooks/useOnboardingStalePlanCheck";
import {
  requestNotificationPermissions,
  rescheduleMotivationalQuoteReminder,
  rescheduleWaterReminders,
} from "../../services/notificationService";
import { REGION_OPTIONS, REMINDER_TIME_OPTIONS, WATER_GOAL_OPTIONS } from "../../utils/onboardingOptions";

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

export default function Screen6Setup({ navigation }: any) {
  const { t } = useTranslation();
  const { data, updateAppSetup } = useOnboardingContext();
  const { saveWithCheck: saveAndExit, saving: _saving, modalProps } = useOnboardingStalePlanCheck(navigation);
  const [saving, setSaving] = useState(false);

  const onFinish = async () => {
    setSaving(true);
    try {
      if (data.app_setup.notifications.meal_logging || data.app_setup.water_intake_goal_liters) {
        await requestNotificationPermissions("settings").catch(() => undefined);
      }
      await rescheduleWaterReminders(Boolean(data.app_setup.water_intake_goal_liters)).catch(() => undefined);
      await rescheduleMotivationalQuoteReminder(Boolean(data.app_setup.notifications.coach_insights)).catch(() => undefined);
      await saveAndExit();
    } catch (e: unknown) {
      // saveAndExit already shows user-facing errors.
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <OnboardingLayout
      step={6}
      title={t("onboarding.screen6.title")}
      subtitle={t("onboarding.screen6.subtitle")}
      onBack={() => navigation.goBack()}
      onNext={onFinish}
      nextLabel={t("onboarding.screen6.saveAndExit")}
      nextLoading={saving}
      nextDisabled={saving}
      onSaveExit={saveAndExit}
      saveLoading={saving}
      saveDisabled={saving}
    >
      <ToggleRow
        label={t("onboarding.screen6.dailyWeighIn")}
        subLabel={t("onboarding.screen6.dailyWeighInSub")}
        value={data.app_setup.weigh_in_reminder_enabled}
        onChange={(v) => updateAppSetup({ weigh_in_reminder_enabled: v })}
      />
      {data.app_setup.weigh_in_reminder_enabled ? (
        <BottomSheetPicker label={t("onboarding.screen6.reminderTime")} value={data.app_setup.reminder_time} options={REMINDER_TIME_OPTIONS} onChange={(v) => updateAppSetup({ reminder_time: String(v) })} placeholder={t("onboarding.screen6.reminderPlaceholder")} />
      ) : null}

      <Text style={styles.section}>{t("onboarding.screen6.waterGoal")}</Text>
      <BottomSheetPicker
        label={t("onboarding.screen6.waterGoal")}
        value={data.app_setup.water_intake_goal_liters}
        options={WATER_GOAL_OPTIONS}
        onChange={(v) => {
          updateAppSetup({ water_intake_goal_liters: v as number | null });
          if (v != null) void requestNotificationPermissions("settings");
        }}
        placeholder={t("onboarding.screen6.waterGoalPlaceholder")}
      />

      <Text style={styles.section}>{t("onboarding.screen6.notifications")}</Text>
      <ToggleRow
        label={t("onboarding.screen6.mealLogging")}
        subLabel={t("onboarding.screen6.mealLoggingSub")}
        value={data.app_setup.notifications.meal_logging}
        onChange={(v) => {
          updateAppSetup({ notifications: { ...data.app_setup.notifications, meal_logging: v } });
          if (v) void requestNotificationPermissions("meal_planner");
        }}
      />
      <ToggleRow
        label={t("onboarding.screen6.coachInsights")}
        subLabel={t("onboarding.screen6.coachInsightsSub")}
        value={data.app_setup.notifications.coach_insights}
        onChange={(v) => {
          updateAppSetup({ notifications: { ...data.app_setup.notifications, coach_insights: v } });
          if (v) void requestNotificationPermissions("settings");
        }}
      />
      <ToggleRow label={t("onboarding.screen6.weeklySummary")} subLabel={t("onboarding.screen6.weeklySummarySub")} value={data.app_setup.notifications.weekly_summary} onChange={(v) => updateAppSetup({ notifications: { ...data.app_setup.notifications, weekly_summary: v } })} />
      <ToggleRow label={t("onboarding.screen6.streakAlerts")} subLabel={t("onboarding.screen6.streakAlertsSub")} value={data.app_setup.notifications.streak_alerts} onChange={(v) => updateAppSetup({ notifications: { ...data.app_setup.notifications, streak_alerts: v } })} />

      <Text style={styles.section}>{t("onboarding.screen6.regionLanguage")}</Text>
      <BottomSheetPicker label={t("onboarding.screen6.regionLanguage")} value={data.app_setup.region} options={REGION_OPTIONS} onChange={(v) => updateAppSetup({ region: String(v) })} placeholder={t("onboarding.screen6.regionPlaceholder")} />
    </OnboardingLayout>
  <StalePlanModal {...modalProps} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 12, marginBottom: 8, color: TEXT, fontSize: 16, fontWeight: "800" },
});
