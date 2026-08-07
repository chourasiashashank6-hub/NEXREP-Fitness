import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Linking, PermissionsAndroid, Platform } from "react-native";
import i18n from "../i18n";
import { DEFAULT_NOTIFICATION_PREFERENCES, getNotificationPreferences, registerPushToken, type NotificationPreferences } from "../api/notifications";
import type { MealDayPlan, MealPlanCurrent, WorkoutPlanCurrent } from "../types/planner";

type NotificationCategory = "workout" | "meals" | "macro-checkins" | "logging-nudges" | "motivational-quotes";
type PermissionContext = "workout_schedule" | "meal_planner" | "settings";
type StoredNotificationGroups = Record<string, string[]>;

export type NotificationPermissionState = {
  granted: boolean;
  denied: boolean;
  blocked: boolean;
  canAskAgain: boolean;
  status: string;
};

const STORAGE_KEY = "nexrep_scheduled_notification_ids";
const ANDROID_13_API = 33;
const DEFAULT_WORKOUT_TIME = "18:30";
const DEFAULT_WATER_TIMES = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"];
const DEFAULT_MOTIVATION_TIME = "08:00";
const BATTERY_TIP_KEY = "nexrep_battery_tip_seen";

const CHANNELS: Record<NotificationCategory, Notifications.NotificationChannelInput> = {
  workout: {
    name: i18n.t("notifications.channels.workout"),
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0F6E56",
  },
  meals: {
    name: i18n.t("notifications.channels.meals"),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    lightColor: "#4A90D9",
  },
  "macro-checkins": {
    name: i18n.t("notifications.channels.macroCheckins"),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    lightColor: "#7B68CC",
  },
  "logging-nudges": {
    name: i18n.t("notifications.channels.loggingNudges"),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    lightColor: "#D85A30",
  },
  "motivational-quotes": {
    name: i18n.t("notifications.channels.motivationalQuotes"),
    importance: Notifications.AndroidImportance.LOW,
    sound: "default",
    lightColor: "#FBBF24",
  },
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const androidApiLevel = () => {
  const version = Platform.Version;
  return typeof version === "number" ? version : Number.parseInt(String(version), 10) || 0;
};

const FCM_SETUP_URL = "https://docs.expo.dev/push-notifications/fcm-credentials/";

/** Turn native FCM setup failures into an actionable message for settings / test UI. */
export function formatExpoPushTokenError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (
    Platform.OS === "android" &&
    (message.includes("FirebaseApp is not initialized") || message.includes("FirebaseApp.initializeApp"))
  ) {
    return new Error(i18n.t("settings.notifications.testServerFcmNotConfigured", { url: FCM_SETUP_URL }));
  }
  if (message.includes("fcm-credentials") || /firebase/i.test(message)) {
    return new Error(`${message} ${i18n.t("settings.notifications.testServerFcmGuide", { url: FCM_SETUP_URL })}`);
  }
  return err instanceof Error ? err : new Error(message);
}

const parseTime = (time: string, fallback = DEFAULT_WORKOUT_TIME) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(fallback);
  const hour = Math.min(23, Math.max(0, Number(match?.[1] ?? 18)));
  const minute = Math.min(59, Math.max(0, Number(match?.[2] ?? 30)));
  return { hour, minute };
};

const dateForPlanDay = (month: number, year: number, day: number, time: string, offsetMinutes = 0) => {
  const { hour, minute } = parseTime(time);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  date.setMinutes(date.getMinutes() + offsetMinutes);
  return date;
};

const isFuture = (date: Date) => date.getTime() > Date.now() + 30_000;

const readStoredGroups = async (): Promise<StoredNotificationGroups> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeStoredGroups = (groups: StoredNotificationGroups) => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(groups));

export async function setupNotificationChannels() {
  if (Platform.OS !== "android") return;
  await Promise.all(
    Object.entries(CHANNELS).map(([id, config]) => Notifications.setNotificationChannelAsync(id, config)),
  );
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const permissions = await Notifications.getPermissionsAsync();
  const granted = permissions.granted || permissions.status === Notifications.PermissionStatus.GRANTED;
  const denied = permissions.status === Notifications.PermissionStatus.DENIED;
  return {
    granted,
    denied,
    blocked: denied && permissions.canAskAgain === false,
    canAskAgain: permissions.canAskAgain,
    status: permissions.status,
  };
}

export async function requestNotificationPermissions(_context: PermissionContext): Promise<NotificationPermissionState> {
  await setupNotificationChannels();

  if (Platform.OS === "ios") {
    await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowSound: true,
        allowBadge: true,
      },
    });
    const state = await getNotificationPermissionState();
    if (state.granted) void registerExpoPushTokenForCurrentDevice().catch(() => undefined);
    return state;
  }

  if (Platform.OS === "android") {
    if (androidApiLevel() >= ANDROID_13_API) {
      const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      const hasPermission = await PermissionsAndroid.check(permission);
      if (!hasPermission) {
        await PermissionsAndroid.request(permission);
      }
    }
    const state = await getNotificationPermissionState();
    if (state.granted) void registerExpoPushTokenForCurrentDevice().catch(() => undefined);
    return state;
  }

  return getNotificationPermissionState();
}

export async function registerExpoPushTokenForCurrentDevice(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  await setupNotificationChannels();
  const permission = await getNotificationPermissionState();
  if (!permission.granted) {
    if (__DEV__) {
      console.warn("[Notifications] Push token skipped — permission not granted");
    }
    return null;
  }
  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId && __DEV__) {
    console.warn("[Notifications] EXPO_PUBLIC_EAS_PROJECT_ID missing — push token may fail");
  }
  try {
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerPushToken({
      expo_push_token: token.data,
      platform: Platform.OS === "ios" ? "ios" : "android",
      device_id: Constants.sessionId ?? undefined,
    });
    if (__DEV__) {
      console.log("[Notifications] Push token registered:", token.data.slice(0, 28) + "…");
    }
    return token.data;
  } catch (err) {
    const formatted = formatExpoPushTokenError(err);
    if (__DEV__) {
      console.warn("[Notifications] Push token registration failed:", formatted.message);
    }
    throw formatted;
  }
}

/** Request permission if needed, then register the Expo push token with the server. */
export async function ensurePushRegistration(requestIfNeeded = true): Promise<string | null> {
  const state = requestIfNeeded
    ? await requestNotificationPermissions("settings")
    : await getNotificationPermissionState();
  if (!state.granted) return null;
  return registerExpoPushTokenForCurrentDevice();
}

/** Fire an immediate on-device notification (no server). Useful for permission/channel testing. */
export async function sendLocalTestNotification() {
  await setupNotificationChannels();
  const permission = await requestNotificationPermissions("settings");
  if (!permission.granted) {
    throw new Error("Notification permission not granted");
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "NexRep test",
      body: "On-device notifications are working.",
      sound: "default",
      data: { category: "logging-nudges", kind: "local_test" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
      channelId: "logging-nudges",
    },
  });
}

export function openNotificationSettings() {
  void Linking.openSettings();
}

export async function getEffectiveNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    return await getNotificationPreferences();
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

const notificationsEnabled = (prefs: NotificationPreferences, category: keyof NotificationPreferences["categories"]) =>
  prefs.master_enabled && prefs.categories[category];

const minutesFromTime = (time: string) => {
  const { hour, minute } = parseTime(time, "00:00");
  return hour * 60 + minute;
};

const isInQuietHours = (date: Date, prefs: NotificationPreferences) => {
  if (!prefs.quiet_hours.enabled) return false;
  const start = minutesFromTime(prefs.quiet_hours.start);
  const end = minutesFromTime(prefs.quiet_hours.end);
  const current = date.getHours() * 60 + date.getMinutes();
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
};

async function cancelGroup(groupKey: string) {
  const groups = await readStoredGroups();
  const ids = groups[groupKey] ?? [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  delete groups[groupKey];
  await writeStoredGroups(groups);
}

async function storeGroupIds(groupKey: string, ids: string[]) {
  const groups = await readStoredGroups();
  groups[groupKey] = ids;
  await writeStoredGroups(groups);
}

async function scheduleOne({
  title,
  body,
  date,
  category,
  data,
  prefs,
}: {
  title: string;
  body: string;
  date: Date;
  category: NotificationCategory;
  data?: Record<string, unknown>;
  prefs?: NotificationPreferences;
}) {
  if (!isFuture(date)) return null;
  if (prefs && isInQuietHours(date, prefs)) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
      data: { category, ...(data ?? {}) },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      channelId: category,
    },
  });
}

export async function scheduleRestEndNotification(
  restEndsAt: Date,
  nextExerciseName: string,
): Promise<string | null> {
  return scheduleOne({
    title: "Rest over 💪",
    body: `${nextExerciseName} is up — let's go!`,
    date: restEndsAt,
    category: "workout",
    data: { kind: "rest_end" },
  });
}

export async function rescheduleWorkoutPlanNotifications(plan: WorkoutPlanCurrent | null, workoutTime = DEFAULT_WORKOUT_TIME) {
  const groupKey = "workout-plan";
  await cancelGroup(groupKey);
  if (!plan?.month_overview?.length) return;
  const prefs = await getEffectiveNotificationPreferences();
  if (!notificationsEnabled(prefs, "workout")) return;

  const ids: string[] = [];
  for (const day of plan.month_overview) {
    if (day.is_rest_day || day.is_past) continue;
    const workoutAt = dateForPlanDay(plan.month, plan.year, day.day, workoutTime);
    const scheduleItems = [
      {
        title: i18n.t("notifications.scheduled.workoutTimeTitle"),
        body: i18n.t("notifications.scheduled.workoutTimeBody", { workout: day.split_name || i18n.t("notifications.scheduled.workoutFallback") }),
        date: workoutAt,
      },
      {
        title: i18n.t("notifications.scheduled.preWorkoutTitle"),
        body: i18n.t("notifications.scheduled.preWorkoutBody", { count: prefs.offsets.pre_workout_minutes }),
        date: dateForPlanDay(plan.month, plan.year, day.day, workoutTime, -prefs.offsets.pre_workout_minutes),
      },
      {
        title: i18n.t("notifications.scheduled.dressTitle"),
        body: i18n.t("notifications.scheduled.dressBody"),
        date: dateForPlanDay(plan.month, plan.year, day.day, workoutTime, -prefs.offsets.dress_change_minutes),
      },
      {
        title: i18n.t("notifications.scheduled.meditationTitle"),
        body: i18n.t("notifications.scheduled.meditationBody", { count: prefs.offsets.meditation_minutes }),
        date: dateForPlanDay(plan.month, plan.year, day.day, workoutTime, -prefs.offsets.meditation_minutes),
      },
    ];
    for (const item of scheduleItems) {
      const id = await scheduleOne({ ...item, category: "workout", data: { planId: plan.plan_id, day: day.day }, prefs });
      if (id) ids.push(id);
    }
  }
  await storeGroupIds(groupKey, ids);
}

export async function rescheduleMealNotifications(plan: MealPlanCurrent | null) {
  const groupKey = `meal-plan-${plan?.plan_id ?? "none"}`;
  await cancelGroup(groupKey);
  if (!plan) return;
  const prefs = await getEffectiveNotificationPreferences();
  if (!notificationsEnabled(prefs, "meals")) return;

  const embeddedDays = (plan as MealPlanCurrent & { days?: MealDayPlan[] }).days;
  const days = embeddedDays?.length ? embeddedDays : plan.today ? [plan.today] : [];
  const schedulableDays = days.filter((day) => !day.locked && day.meals?.length);
  if (!schedulableDays.length) return;

  const ids: string[] = [];
  for (const day of schedulableDays) {
    for (const meal of day.meals) {
      const date = dateForPlanDay(plan.month, plan.year, day.day, meal.time);
      const id = await scheduleOne({
        title: i18n.t("notifications.scheduled.mealTitle", { meal: meal.meal_type.replace(/_/g, " ") }),
        body: i18n.t("notifications.scheduled.mealBody", { food: meal.items?.[0]?.food ?? i18n.t("notifications.scheduled.mealFallback") }),
        date,
        category: "meals",
        data: { planId: plan.plan_id, day: day.day, mealType: meal.meal_type },
        prefs,
      });
      if (id) ids.push(id);
    }
  }
  await storeGroupIds(groupKey, ids);
}

export async function rescheduleWaterReminders(enabled: boolean, times = DEFAULT_WATER_TIMES) {
  const groupKey = "water-reminders";
  await cancelGroup(groupKey);
  if (!enabled) return;
  const prefs = await getEffectiveNotificationPreferences();
  if (!notificationsEnabled(prefs, "logging_nudges")) return;

  const ids: string[] = [];
  const today = new Date();
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const base = new Date(today);
    base.setDate(today.getDate() + dayOffset);
    for (const time of times) {
      const { hour, minute } = parseTime(time, "09:00");
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
      const id = await scheduleOne({
        title: i18n.t("notifications.scheduled.hydrationTitle"),
        body: i18n.t("notifications.scheduled.hydrationBody"),
        date,
        category: "logging-nudges",
        data: { kind: "water" },
        prefs,
      });
      if (id) ids.push(id);
    }
  }
  await storeGroupIds(groupKey, ids);
}

export async function rescheduleMotivationalQuoteReminder(enabled = true, time = DEFAULT_MOTIVATION_TIME) {
  const groupKey = "motivational-quotes";
  await cancelGroup(groupKey);
  if (!enabled) return;
  const prefs = await getEffectiveNotificationPreferences();
  if (!notificationsEnabled(prefs, "motivational_quotes")) return;
  const ids: string[] = [];
  const today = new Date();
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const base = new Date(today);
    base.setDate(today.getDate() + dayOffset);
    const { hour, minute } = parseTime(time, DEFAULT_MOTIVATION_TIME);
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
    const id = await scheduleOne({
      title: i18n.t("notifications.scheduled.dailyFuelTitle"),
      body: i18n.t("notifications.scheduled.dailyFuelBody"),
      date,
      category: "motivational-quotes",
      data: { kind: "daily_quote" },
      prefs,
    });
    if (id) ids.push(id);
  }
  await storeGroupIds(groupKey, ids);
}

export async function cancelAllNexRepNotifications() {
  const groups = await readStoredGroups();
  await Promise.all(
    Object.values(groups)
      .flat()
      .map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)),
  );
  await writeStoredGroups({});
}

export async function shouldShowAndroidBatteryTip() {
  if (Platform.OS !== "android") return false;
  const seen = await AsyncStorage.getItem(BATTERY_TIP_KEY);
  return seen !== "1";
}

export async function dismissAndroidBatteryTip() {
  await AsyncStorage.setItem(BATTERY_TIP_KEY, "1");
}
