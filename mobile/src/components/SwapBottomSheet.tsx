import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useAppTheme } from "../theme";

export type SwapReason = { key: string; label: string };

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  reasons: SwapReason[];
  confirmLabel: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
};

export function SwapBottomSheet({ visible, title, subtitle, reasons, confirmLabel, onConfirm, onCancel }: Props) {
  const { colors, radius } = useAppTheme();
  const [selected, setSelected] = useState<string | null>(null);

  const handleCancel = () => {
    setSelected(null);
    onCancel();
  };

  const handleConfirm = () => {
    const reason = selected ?? undefined;
    setSelected(null);
    onConfirm(reason);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
          <Text style={[styles.hint, { color: colors.muted }]}>Why are you replacing? (optional)</Text>
          <View style={styles.chips}>
            {reasons.map((r) => {
              const on = selected === r.key;
              return (
                <Pressable
                  key={r.key}
                  style={[styles.chip, { borderColor: on ? "#22d3ee" : colors.border, backgroundColor: on ? "rgba(34,211,238,0.15)" : colors.cardAlt }]}
                  onPress={() => setSelected(on ? null : r.key)}
                >
                  <Text style={{ color: on ? "#22d3ee" : colors.text, fontSize: 13, fontWeight: on ? "700" : "500" }}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Pressable style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
              <Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const MEAL_SWAP_REASONS: SwapReason[] = [
  { key: "dont_like", label: "Don't like it" },
  { key: "too_expensive", label: "Too expensive" },
  { key: "not_available", label: "Not available" },
  { key: "want_variety", label: "Want variety" },
];

export const EXERCISE_SWAP_REASONS: SwapReason[] = [
  { key: "no_equipment", label: "No equipment" },
  { key: "too_hard", label: "Too hard" },
  { key: "too_easy", label: "Too easy" },
  { key: "injury", label: "Injury" },
  { key: "want_variety", label: "Want variety" },
];

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { borderWidth: 1, padding: 20, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: "800" },
  subtitle: { fontSize: 14, marginTop: 6 },
  hint: { fontSize: 13, marginTop: 14, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  confirmBtn: { flex: 1, backgroundColor: "#22d3ee", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  confirmText: { color: "#0f172a", fontWeight: "800" },
});
