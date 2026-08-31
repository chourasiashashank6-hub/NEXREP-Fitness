import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OnboardingFormChange } from "../utils/onboardingFormDiff";
import { GREEN, TEXT, BORDER, WHITE } from "../theme/colors";

const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const MUTED = "#8A8A84";
type Props = {
  visible: boolean;
  changes: OnboardingFormChange[];
  onDiscard: () => void;
  onKeepEditing: () => void;
};

export function UnsavedOnboardingModal({ visible, changes, onDiscard, onKeepEditing }: Props) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onKeepEditing}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("onboarding.unsaved.title")}</Text>
          <Text style={styles.body}>{t("onboarding.unsaved.body")}</Text>
          <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
            {changes.map((change) => (
              <View key={change.key} style={styles.changeRow}>
                <Text style={styles.changeLabel}>{change.label}</Text>
                <Text style={styles.changeValues}>
                  {change.from} → {change.to}
                </Text>
              </View>
            ))}
          </ScrollView>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onKeepEditing}>
            <Text style={styles.btnPrimaryText}>{t("onboarding.unsaved.keepEditing")}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={onDiscard}>
            <Text style={styles.btnDangerText}>{t("onboarding.unsaved.discard")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxHeight: "80%",
  },
  title: { fontSize: 18, fontWeight: "800", color: TEXT, marginBottom: 6 },
  body: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 12 },
  listScroll: { maxHeight: 220, marginBottom: 14 },
  listContent: { gap: 8 },
  changeRow: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: ORANGE_LIGHT,
  },
  changeLabel: { fontSize: 13, fontWeight: "800", color: TEXT, marginBottom: 4 },
  changeValues: { fontSize: 12, color: MUTED, lineHeight: 17 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  btnPrimary: { backgroundColor: GREEN },
  btnPrimaryText: { color: WHITE, fontWeight: "800", fontSize: 15 },
  btnDanger: { backgroundColor: WHITE, borderWidth: 1.5, borderColor: ORANGE },
  btnDangerText: { color: ORANGE, fontWeight: "800", fontSize: 15 },
});
