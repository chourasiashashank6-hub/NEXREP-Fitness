import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useAppTheme } from "../theme";

export type SwapReason = { key: string; label: string };

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  reasons: SwapReason[];
  confirmLabel: string;
  accentColor?: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
};

export function SwapBottomSheet({ visible, title, subtitle, reasons, confirmLabel, accentColor = "#22d3ee", onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
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
        <Pressable style={[styles.sheet, { backgroundColor: "#FFFFFF", borderColor: "#ECEAE5", borderTopLeftRadius: 20, borderTopRightRadius: 20 }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
          <Text style={[styles.hint, { color: colors.muted }]}>{t("components.swapSheet.hint")}</Text>
          <View style={styles.chips}>
            {reasons.map((r) => {
              const on = selected === r.key;
              return (
                <Pressable
                  key={r.key}
                  style={[styles.chip, { borderColor: on ? accentColor : colors.border, backgroundColor: on ? "rgba(240,238,249,1)" : colors.cardAlt }]}
                  onPress={() => setSelected(on ? null : r.key)}
                >
                  <Text style={{ color: on ? accentColor : colors.text, fontSize: 13, fontWeight: on ? "700" : "500" }}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Pressable style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
              <Text style={{ color: colors.muted, fontWeight: "600" }}>{t("components.swapSheet.cancel")}</Text>
            </Pressable>
            <Pressable style={[styles.confirmBtn, { backgroundColor: accentColor }]} onPress={handleConfirm}>
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const MEAL_SWAP_REASONS: SwapReason[] = [
  { key: "dont_like", label: i18n.t("components.swapSheet.reasons.dontLike") },
  { key: "too_expensive", label: i18n.t("components.swapSheet.reasons.tooExpensive") },
  { key: "not_available", label: i18n.t("components.swapSheet.reasons.notAvailable") },
  { key: "want_variety", label: i18n.t("components.swapSheet.reasons.wantVariety") },
];

export const EXERCISE_SWAP_REASONS: SwapReason[] = [
  { key: "no_equipment", label: i18n.t("components.swapSheet.reasons.noEquipment") },
  { key: "too_hard", label: i18n.t("components.swapSheet.reasons.tooHard") },
  { key: "too_easy", label: i18n.t("components.swapSheet.reasons.tooEasy") },
  { key: "injury", label: i18n.t("components.swapSheet.reasons.injury") },
  { key: "want_variety", label: i18n.t("components.swapSheet.reasons.wantVariety") },
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
