import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  getNotificationPermissionState,
  openNotificationSettings,
  setupNotificationChannels,
  type NotificationPermissionState,
} from "../services/notificationService";

const GREEN = "#0F6E56";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const TEXT = "#1A1A18";
const MUTED = "#77776F";
const BORDER = "#F2D4CA";

export function NotificationPermissionBanner() {
  const { t } = useTranslation();
  const [state, setState] = useState<NotificationPermissionState | null>(null);

  const refresh = useCallback(async () => {
    await setupNotificationChannels().catch(() => undefined);
    const next = await getNotificationPermissionState().catch(() => null);
    setState(next);
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (!state?.blocked) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.iconBubble}>
        <Text style={styles.iconText}>{t("components.notificationPermission.icon")}</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{t("components.notificationPermission.title")}</Text>
        <Text style={styles.body}>{t("components.notificationPermission.body")}</Text>
      </View>
      <Pressable style={styles.action} onPress={openNotificationSettings}>
        <Text style={styles.actionText}>{t("components.notificationPermission.settings")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: ORANGE_LIGHT,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  iconBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FFE3D8",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { color: ORANGE, fontSize: 15, fontWeight: "900" },
  copy: { flex: 1 },
  title: { color: TEXT, fontSize: 13, fontWeight: "900" },
  body: { color: MUTED, fontSize: 11, lineHeight: 15, marginTop: 2 },
  action: {
    borderRadius: 999,
    backgroundColor: GREEN,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
});
