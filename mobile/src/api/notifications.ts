import { apiClient } from "./client";

export type NotificationPreferences = {
  master_enabled: boolean;
  categories: {
    workout: boolean;
    meals: boolean;
    macro_checkins: boolean;
    logging_nudges: boolean;
    motivational_quotes: boolean;
  };
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  offsets: {
    pre_workout_minutes: number;
    dress_change_minutes: number;
    meditation_minutes: number;
  };
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  master_enabled: true,
  categories: {
    workout: true,
    meals: true,
    macro_checkins: true,
    logging_nudges: true,
    motivational_quotes: true,
  },
  quiet_hours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
  },
  offsets: {
    pre_workout_minutes: 20,
    dress_change_minutes: 18,
    meditation_minutes: 10,
  },
};

export const registerPushToken = async (payload: {
  expo_push_token: string;
  platform: "ios" | "android" | "web";
  device_id?: string;
}) => {
  const { data } = await apiClient.post("/api/notifications/push-token", payload);
  return data;
};

export const getNotificationPreferences = async (): Promise<NotificationPreferences> => {
  const { data } = await apiClient.get<{ preferences: NotificationPreferences }>("/api/notifications/preferences");
  return data.preferences;
};

export const updateNotificationPreferences = async (
  preferences: NotificationPreferences,
): Promise<NotificationPreferences> => {
  const { data } = await apiClient.put<{ preferences: NotificationPreferences }>("/api/notifications/preferences", {
    preferences,
  });
  return data.preferences;
};
