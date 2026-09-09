import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useConnectivityStore } from "../store/connectivityStore";

export function OfflineBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const serverReachable = useConnectivityStore((s) => s.serverReachable);
  const serverWaking = useConnectivityStore((s) => s.serverWaking);

  if (isOnline && serverReachable) return null;

  const message = !isOnline
    ? t("offline.banner.offline")
    : serverWaking
      ? t("offline.banner.waking")
      : t("offline.banner.serverUnreachable");

  return (
    <View style={[styles.wrap, { paddingTop: insets.top > 0 ? 4 : 8 }]}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#3D3D38",
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
});
