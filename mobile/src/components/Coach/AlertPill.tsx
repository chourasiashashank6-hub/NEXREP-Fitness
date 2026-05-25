import { StyleSheet, Text, View } from "react-native";
import type { AlertItem } from "../../types/coach";
import { ALERT_STYLES } from "../../types/coach";

export function AlertPill({ alert }: { alert: AlertItem }) {
  const tone = ALERT_STYLES[alert.type];
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={styles.icon}>{alert.icon}</Text>
      <Text style={[styles.title, { color: tone.titleColor }]} numberOfLines={1}>
        {alert.title}
      </Text>
      <Text style={[styles.sub, { color: tone.subColor }]} numberOfLines={2}>
        {alert.subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 10, minHeight: 84, flex: 1 },
  icon: { fontSize: 14, marginBottom: 3 },
  title: { fontSize: 12, fontWeight: "600" },
  sub: { fontSize: 11, marginTop: 2 },
});
