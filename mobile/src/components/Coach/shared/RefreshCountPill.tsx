import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const MUTED = "#BBBBBB";

export type RefreshCountPillProps = {
  scopeLabel: string;
  count: number;
  accentColor: string;
  accentLightBg: string;
  disabled?: boolean;
  loading?: boolean;
  muted?: boolean;
  hideCount?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/** Planner-style refresh/regenerate pill: icon + "Scope · count". */
export function RefreshCountPill({
  scopeLabel,
  count,
  accentColor,
  accentLightBg,
  disabled,
  loading,
  muted,
  hideCount,
  onPress,
  accessibilityLabel,
}: RefreshCountPillProps) {
  const textColor = muted ? MUTED : accentColor;
  const iconColor = muted ? MUTED : accentColor;
  const label = hideCount ? scopeLabel : `${scopeLabel} · ${count}`;

  const body = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={accentColor} />
      ) : (
        <Ionicons name="refresh" size={13} color={iconColor} />
      )}
      <Text style={[styles.text, { color: textColor }]}>{label}</Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: Boolean(disabled || loading) }}
        style={[
          styles.pill,
          { backgroundColor: accentLightBg },
          (disabled || loading) && styles.pillDisabled,
        ]}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={[styles.pill, { backgroundColor: accentLightBg }]}>{body}</View>;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pillDisabled: { opacity: 0.6 },
  text: { fontSize: 10, fontWeight: "800" },
});
