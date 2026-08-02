import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

type PlannerKey = "meal" | "workout";

type Props = {
  visible: boolean;
  affectedPlanners: PlannerKey[];
  changedFieldLabels?: string[];
  regenerating?: boolean;
  onRegenerateNow: () => void;
  onDoItLater: () => void;
};

const AMBER = "#D97706";
const AMBER_LIGHT = "#FFFBEB";

export function StalePlanModal({
  visible,
  affectedPlanners,
  changedFieldLabels = [],
  regenerating = false,
  onRegenerateNow,
  onDoItLater,
}: Props) {
  const { t } = useTranslation();

  if (!visible) return null;

  const plannerLabels = affectedPlanners.map((p) => t(`stalePlan.planners.${p}`));
  const plannerStr =
    plannerLabels.length === 1
      ? plannerLabels[0]
      : plannerLabels.slice(0, -1).join(", ") + " " + t("common.and") + " " + plannerLabels[plannerLabels.length - 1];

  const bodyKey = affectedPlanners.length === 1 ? "stalePlan.modalBodyOne" : "stalePlan.modalBodyTwo";
  const fieldsStr = changedFieldLabels.length > 0 ? changedFieldLabels.join(", ") : "";

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDoItLater}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <Text style={styles.icon}>⚠️</Text>
          </View>
          <Text style={styles.title}>{t("stalePlan.modalTitle")}</Text>
          <Text style={styles.body}>{t(bodyKey, { planners: plannerStr, fields: fieldsStr || plannerStr })}</Text>
          <Pressable
            style={[styles.btn, styles.btnPrimary, regenerating && styles.btnDisabled]}
            onPress={onRegenerateNow}
            disabled={regenerating}
          >
            {regenerating ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>{t("stalePlan.regenerateNow")}</Text>
            )}
          </Pressable>
          <Pressable style={[styles.btn, styles.btnSecondary]} onPress={onDoItLater} disabled={regenerating}>
            <Text style={styles.btnSecondaryText}>{t("stalePlan.doItLater")}</Text>
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
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    gap: 12,
  },
  iconRow: { alignItems: "center" },
  icon: { fontSize: 32 },
  title: { fontSize: 17, fontWeight: "800", color: "#1A1A18", textAlign: "center" },
  body: { fontSize: 14, color: "#555550", lineHeight: 20, textAlign: "center" },
  btn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: AMBER },
  btnDisabled: { opacity: 0.6 },
  btnSecondary: { backgroundColor: AMBER_LIGHT },
  btnPrimaryText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  btnSecondaryText: { fontSize: 15, fontWeight: "700", color: AMBER },
});
