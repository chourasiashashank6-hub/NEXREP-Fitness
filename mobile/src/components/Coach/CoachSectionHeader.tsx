import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

export function CoachSectionHeader({ title, subtitle, accent }: { title: string; subtitle?: string; accent: string }) {
  return (
    <View style={styles.wrap}>
      <LinearGradient colors={[accent, `${accent}66`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.bar} />
      <Text style={[styles.title, { color: accent }]}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, marginBottom: 8 },
  bar: { height: 2, borderRadius: 1, marginBottom: 8 },
  title: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9 },
  sub: { fontSize: 12, color: "#9AA8C4", marginTop: 4 },
});
