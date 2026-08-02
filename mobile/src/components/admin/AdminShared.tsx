import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { COLORS } from "../../screens/admin/adminTheme";

export function MetricCard({
  label,
  value,
  sub,
  accentColor,
}: {
  label: string;
  value: string;
  sub?: string;
  accentColor?: string;
  icon?: React.ReactNode;
}) {
  return (
    <View style={[styles.metricCard, accentColor ? { borderTopWidth: 2, borderTopColor: accentColor } : {}]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {sub ? <Text style={styles.metricSub}>{sub}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function PlanBadge({ plan }: { plan: string }) {
  const cfg: Record<string, { bg: string; color: string }> = {
    free: { bg: "rgba(255,255,255,0.06)", color: "#8b949e" },
    pro: { bg: "rgba(29,158,117,0.15)", color: "#3fcf8e" },
    elite: { bg: "rgba(127,119,221,0.15)", color: "#a5a0f0" },
    trial: { bg: "rgba(239,159,39,0.15)", color: "#f0c060" },
  };
  const c = cfg[plan.toLowerCase()] ?? cfg.free;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.color }]}>{plan.toUpperCase()}</Text>
    </View>
  );
}

const AVATAR_COLORS = [
  { bg: "rgba(29,158,117,0.2)", fg: "#3fcf8e" },
  { bg: "rgba(55,138,221,0.2)", fg: "#79b8f8" },
  { bg: "rgba(127,119,221,0.2)", fg: "#a5a0f0" },
  { bg: "rgba(239,159,39,0.2)", fg: "#f0c060" },
  { bg: "rgba(216,90,48,0.2)", fg: "#f07650" },
  { bg: "rgba(212,83,126,0.2)", fg: "#f090b0" },
];

export function UserAvatar({ name, size = 38 }: { name: string; size?: number }) {
  const initial = (name || "?")[0].toUpperCase();
  const idx = (name.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  const c = AVATAR_COLORS[idx];
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg },
      ]}
    >
      <Text style={[styles.avatarText, { color: c.fg, fontSize: size * 0.36 }]}>{initial}</Text>
    </View>
  );
}

export function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

export function CardBox({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.cardBox, style]}>{children}</View>;
}

export function AlertBanner({ text, type = "warning" }: { text: string; type?: "warning" | "success" | "info" }) {
  const cfg = {
    warning: { bg: "rgba(239,159,39,0.1)", border: "rgba(239,159,39,0.3)", text: "#c8aa6e", icon: "⚠" },
    success: { bg: "rgba(29,158,117,0.08)", border: "rgba(29,158,117,0.2)", text: "#3fcf8e", icon: "✓" },
    info: { bg: "rgba(55,138,221,0.1)", border: "rgba(55,138,221,0.3)", text: "#79b8f8", icon: "ℹ" },
  };
  const c = cfg[type];
  return (
    <View style={[styles.alertBanner, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={{ color: c.text, fontSize: 16, marginRight: 10 }}>{c.icon}</Text>
      <Text style={[styles.alertText, { color: c.text }]}>{text}</Text>
    </View>
  );
}

export function FeatureBar({
  name,
  value,
  maxValue,
  color,
  unit = "₹",
}: {
  name: string;
  value: number;
  maxValue: number;
  color: string;
  unit?: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureName} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.featureBarWrap}>
        <View style={[styles.featureBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.featureVal}>
        {unit}
        {value.toFixed(2)}
      </Text>
    </View>
  );
}

export function NavButton({
  label,
  iconColor,
  onPress,
}: {
  label: string;
  iconColor: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.navBtn} activeOpacity={0.7}>
      <View style={[styles.navBtnDot, { backgroundColor: iconColor }]} />
      <Text style={styles.navBtnLabel}>{label}</Text>
      <Text style={{ color: "#1d9e75", fontSize: 20, fontWeight: "300" }}>›</Text>
    </TouchableOpacity>
  );
}

export function LoadingBlock() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={COLORS.teal} />
    </View>
  );
}

export function ErrorText({ message }: { message: string }) {
  return <Text style={styles.error}>{message}</Text>;
}

export const adminScreenScroll = {
  style: { backgroundColor: COLORS.bg, flex: 1 as const },
  contentContainerStyle: { padding: 16, paddingBottom: 40 },
};

const styles = StyleSheet.create({
  metricCard: {
    backgroundColor: "#161b22",
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.07)",
    padding: 14,
    flex: 1,
  },
  metricLabel: { color: "#8b949e", fontSize: 11, marginBottom: 6 },
  metricValue: { color: "#ffffff", fontSize: 22, fontWeight: "500", lineHeight: 26 },
  metricSub: { color: "#6e7681", fontSize: 11, marginTop: 4 },
  sectionLabel: {
    color: "#6e7681",
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 10,
  },
  chip: {
    backgroundColor: "#161b22",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: "#1d9e75", borderColor: "#1d9e75" },
  chipText: { color: "#c9d1d9", fontSize: 12 },
  chipTextActive: { color: "#ffffff", fontSize: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: "500" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "500" },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  statLabel: { color: "#8b949e", fontSize: 13 },
  statValue: { color: "#e6edf3", fontSize: 13, fontWeight: "500" },
  cardBox: {
    backgroundColor: "#161b22",
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.07)",
    padding: 14,
    marginBottom: 10,
  },
  alertBanner: {
    borderWidth: 0.5,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  alertText: { fontSize: 12, lineHeight: 18, flex: 1 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  featureName: { color: "#8b949e", fontSize: 11, width: 80 },
  featureBarWrap: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 4,
    height: 6,
    overflow: "hidden",
  },
  featureBarFill: { height: 6, borderRadius: 4 },
  featureVal: { color: "#c9d1d9", fontSize: 11, fontWeight: "500", width: 40, textAlign: "right" },
  navBtn: {
    backgroundColor: "#161b22",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 12,
  },
  navBtnDot: { width: 8, height: 8, borderRadius: 4 },
  navBtnLabel: { color: "#c9d1d9", fontSize: 14, fontWeight: "500", flex: 1 },
  loading: { paddingVertical: 40, alignItems: "center" },
  error: { color: "#f85149", marginBottom: 12, fontSize: 13 },
});
