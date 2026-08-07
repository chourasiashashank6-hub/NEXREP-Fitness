import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { BottomSheetPicker } from "../components/BottomSheetPicker";
import { ToggleRow } from "../components/ToggleRow";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "../api/notifications";
import {
  cancelAllNexRepNotifications,
  dismissAndroidBatteryTip,
  ensurePushRegistration,
  getNotificationPermissionState,
  openNotificationSettings,
  sendLocalTestNotification,
  shouldShowAndroidBatteryTip,
  type NotificationPermissionState,
} from "../services/notificationService";
import { sendTestPush } from "../api/notifications";

const GREEN = "#0F6E56";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#77776F";
const BORDER = "#ECEAE5";

const timeOptions = Array.from({ length: 24 * 2 }, (_, idx) => {
  const hour = Math.floor(idx / 2);
  const minute = idx % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  return { value, label: value };
});

const offsetValues = [5, 10, 15, 18, 20, 25, 30, 45, 60];

export function NotificationPreferencesScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batteryTip, setBatteryTip] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState | null>(null);
  const [testingLocal, setTestingLocal] = useState(false);
  const [testingServer, setTestingServer] = useState(false);
  const offsetOptions = useMemo(
    () => offsetValues.map((n) => ({ value: n, label: t("settings.notifications.minutesBefore", { count: n }) })),
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [remote, showTip, perm] = await Promise.all([
        getNotificationPreferences().catch(() => DEFAULT_NOTIFICATION_PREFERENCES),
        shouldShowAndroidBatteryTip().catch(() => false),
        getNotificationPermissionState().catch(() => null),
      ]);
      setPrefs(remote);
      setBatteryTip(showTip);
      setPermission(perm);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePrefs = async (next: NotificationPreferences) => {
    setPrefs(next);
    setSaving(true);
    try {
      const saved = await updateNotificationPreferences(next);
      setPrefs(saved);
      if (!saved.master_enabled) await cancelAllNexRepNotifications().catch(() => undefined);
      if (saved.master_enabled) {
        await ensurePushRegistration(true).catch(() => undefined);
        const perm = await getNotificationPermissionState().catch(() => null);
        setPermission(perm);
      }
    } finally {
      setSaving(false);
    }
  };

  const updateCategory = (key: keyof NotificationPreferences["categories"], value: boolean) =>
    savePrefs({ ...prefs, categories: { ...prefs.categories, [key]: value } });

  const permissionLabel = permission?.granted
    ? t("settings.notifications.permissionGranted")
    : permission?.blocked
      ? t("settings.notifications.permissionBlocked")
      : t("settings.notifications.permissionDenied");

  const runLocalTest = async () => {
    setTestingLocal(true);
    try {
      await sendLocalTestNotification();
      Alert.alert(t("settings.notifications.testLocalTitle"), t("settings.notifications.testLocalScheduled"));
    } catch (err) {
      Alert.alert(t("settings.notifications.testFailed"), err instanceof Error ? err.message : String(err));
    } finally {
      setTestingLocal(false);
      const perm = await getNotificationPermissionState().catch(() => null);
      setPermission(perm);
    }
  };

  const runServerTest = async () => {
    setTestingServer(true);
    try {
      const granted = await ensurePushRegistration(true);
      if (!granted) {
        throw new Error(t("settings.notifications.testServerNoToken"));
      }
      const result = await sendTestPush();
      Alert.alert(t("settings.notifications.testServerTitle"), result.detail ?? t("settings.notifications.testServerOk"));
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? (err instanceof Error ? err.message : String(err));
      Alert.alert(t("settings.notifications.testFailed"), String(detail));
    } finally {
      setTestingServer(false);
      const perm = await getNotificationPermissionState().catch(() => null);
      setPermission(perm);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t("settings.notifications.title")}</Text>
          <Text style={styles.subtitle}>{t("settings.notifications.subtitle")}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={GREEN} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {batteryTip ? (
            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>{t("settings.notifications.androidBatteryTitle")}</Text>
              <Text style={styles.tipBody}>
                {t("settings.notifications.androidBatteryBody")}
              </Text>
              <View style={styles.tipActions}>
                <Pressable style={styles.tipSecondary} onPress={() => {
                  void dismissAndroidBatteryTip();
                  setBatteryTip(false);
                }}>
                  <Text style={styles.tipSecondaryText}>{t("settings.notifications.dismiss")}</Text>
                </Pressable>
                <Pressable style={styles.tipPrimary} onPress={openNotificationSettings}>
                  <Text style={styles.tipPrimaryText}>{t("settings.notifications.openSettings")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("settings.notifications.testSection")}</Text>
            <Text style={styles.helper}>{t("settings.notifications.testSectionHelper")}</Text>
            <Text style={styles.permissionStatus}>
              {t("settings.notifications.permissionStatus", { status: permissionLabel })}
            </Text>
            {!permission?.granted ? (
              <Pressable
                style={styles.testPrimary}
                onPress={() => {
                  void ensurePushRegistration(true).then(async () => {
                    const perm = await getNotificationPermissionState().catch(() => null);
                    setPermission(perm);
                  });
                }}
              >
                <Text style={styles.testPrimaryText}>{t("settings.notifications.enableNotifications")}</Text>
              </Pressable>
            ) : null}
            <View style={styles.testActions}>
              <Pressable style={styles.testSecondary} onPress={() => void runLocalTest()} disabled={testingLocal}>
                <Text style={styles.testSecondaryText}>
                  {testingLocal ? t("settings.notifications.testing") : t("settings.notifications.testLocal")}
                </Text>
              </Pressable>
              <Pressable style={styles.testSecondary} onPress={() => void runServerTest()} disabled={testingServer}>
                <Text style={styles.testSecondaryText}>
                  {testingServer ? t("settings.notifications.testing") : t("settings.notifications.testServer")}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <ToggleRow
              label={t("settings.notifications.master")}
              subLabel={t("settings.notifications.masterSub")}
              value={prefs.master_enabled}
              onChange={(v) => void savePrefs({ ...prefs, master_enabled: v })}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("settings.notifications.categories")}</Text>
            <ToggleRow label={t("settings.notifications.workout")} subLabel={t("settings.notifications.workoutSub")} value={prefs.categories.workout} onChange={(v) => updateCategory("workout", v)} />
            <ToggleRow label={t("settings.notifications.meals")} subLabel={t("settings.notifications.mealsSub")} value={prefs.categories.meals} onChange={(v) => updateCategory("meals", v)} />
            <ToggleRow label={t("settings.notifications.macroCheckins")} subLabel={t("settings.notifications.macroCheckinsSub")} value={prefs.categories.macro_checkins} onChange={(v) => updateCategory("macro_checkins", v)} />
            <ToggleRow label={t("settings.notifications.loggingNudges")} subLabel={t("settings.notifications.loggingNudgesSub")} value={prefs.categories.logging_nudges} onChange={(v) => updateCategory("logging_nudges", v)} />
            <ToggleRow label={t("settings.notifications.motivationalQuotes")} subLabel={t("settings.notifications.motivationalQuotesSub")} value={prefs.categories.motivational_quotes} onChange={(v) => updateCategory("motivational_quotes", v)} />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("settings.notifications.quietHours")}</Text>
            <ToggleRow label={t("settings.notifications.enableQuietHours")} subLabel={t("settings.notifications.enableQuietHoursSub")} value={prefs.quiet_hours.enabled} onChange={(v) => void savePrefs({ ...prefs, quiet_hours: { ...prefs.quiet_hours, enabled: v } })} />
            <View style={styles.pickerGap}>
              <Text style={styles.pickerLabel}>{t("settings.notifications.start")}</Text>
              <BottomSheetPicker label={t("settings.notifications.quietHoursStart")} value={prefs.quiet_hours.start} options={timeOptions} placeholder={t("settings.notifications.quietStartPlaceholder")} onChange={(v) => void savePrefs({ ...prefs, quiet_hours: { ...prefs.quiet_hours, start: String(v) } })} />
            </View>
            <View style={styles.pickerGap}>
              <Text style={styles.pickerLabel}>{t("settings.notifications.end")}</Text>
              <BottomSheetPicker label={t("settings.notifications.quietHoursEnd")} value={prefs.quiet_hours.end} options={timeOptions} placeholder={t("settings.notifications.quietEndPlaceholder")} onChange={(v) => void savePrefs({ ...prefs, quiet_hours: { ...prefs.quiet_hours, end: String(v) } })} />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("settings.notifications.workoutOffsets")}</Text>
            <Text style={styles.helper}>{t("settings.notifications.workoutOffsetsHelper")}</Text>
            <View style={styles.pickerGap}>
              <Text style={styles.pickerLabel}>{t("settings.notifications.preWorkout")}</Text>
              <BottomSheetPicker label={t("settings.notifications.preWorkoutOffset")} value={prefs.offsets.pre_workout_minutes} options={offsetOptions} placeholder={t("settings.notifications.minutesBefore", { count: 20 })} onChange={(v) => void savePrefs({ ...prefs, offsets: { ...prefs.offsets, pre_workout_minutes: Number(v) } })} />
            </View>
            <View style={styles.pickerGap}>
              <Text style={styles.pickerLabel}>{t("settings.notifications.dressChange")}</Text>
              <BottomSheetPicker label={t("settings.notifications.dressChangeOffset")} value={prefs.offsets.dress_change_minutes} options={offsetOptions} placeholder={t("settings.notifications.minutesBefore", { count: 18 })} onChange={(v) => void savePrefs({ ...prefs, offsets: { ...prefs.offsets, dress_change_minutes: Number(v) } })} />
            </View>
            <View style={styles.pickerGap}>
              <Text style={styles.pickerLabel}>{t("settings.notifications.meditation")}</Text>
              <BottomSheetPicker label={t("settings.notifications.meditationOffset")} value={prefs.offsets.meditation_minutes} options={offsetOptions} placeholder={t("settings.notifications.minutesBefore", { count: 10 })} onChange={(v) => void savePrefs({ ...prefs, offsets: { ...prefs.offsets, meditation_minutes: Number(v) } })} />
            </View>
          </View>

          {saving ? <Text style={styles.saving}>{t("settings.notifications.saving")}</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, backgroundColor: WHITE },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: BG, alignItems: "center", justifyContent: "center", marginRight: 12 },
  backText: { color: TEXT, fontSize: 28, lineHeight: 30, fontWeight: "700" },
  headerText: { flex: 1 },
  title: { color: TEXT, fontSize: 20, fontWeight: "900" },
  subtitle: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 3 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 42, gap: 12 },
  card: { backgroundColor: WHITE, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 14 },
  sectionTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 10 },
  helper: { color: MUTED, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  pickerGap: { marginTop: 10 },
  pickerLabel: { color: TEXT, fontSize: 13, fontWeight: "800", marginBottom: 7 },
  saving: { alignSelf: "center", color: GREEN, fontSize: 12, fontWeight: "800" },
  tipCard: { backgroundColor: ORANGE_LIGHT, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "#F6D5CB" },
  tipTitle: { color: TEXT, fontSize: 15, fontWeight: "900" },
  tipBody: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 5 },
  tipActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  tipSecondary: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingVertical: 10, alignItems: "center", backgroundColor: WHITE },
  tipSecondaryText: { color: TEXT, fontSize: 13, fontWeight: "800" },
  tipPrimary: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center", backgroundColor: GREEN },
  tipPrimaryText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  permissionStatus: { color: MUTED, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  testActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  testPrimary: { borderRadius: 12, paddingVertical: 11, alignItems: "center", backgroundColor: GREEN, marginBottom: 10 },
  testPrimaryText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  testSecondary: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingVertical: 11, alignItems: "center", backgroundColor: BG },
  testSecondaryText: { color: TEXT, fontSize: 13, fontWeight: "800" },
});
