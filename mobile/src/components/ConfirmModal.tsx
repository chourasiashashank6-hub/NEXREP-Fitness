import { Pressable, StyleSheet, Text, View } from "react-native";
import { BlurredModal } from "./BlurredModal";

const TEXT = "#1A1A18";
const MUTED = "#6B7280";
const BORDER = "#ECEAE5";
const PURPLE = "#7B68CC";
const DESTRUCTIVE = "#C0392B";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  destructive?: boolean;
};

export function ConfirmModal({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = false,
}: Props) {
  return (
    <BlurredModal
      visible={visible}
      onClose={onCancel}
      variant="center"
      sheetStyle={styles.sheet}
      backdropAccessibilityLabel={cancelLabel}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <Pressable style={styles.cancelBtn} onPress={onCancel} accessibilityRole="button">
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
          <Pressable
            style={[styles.confirmBtn, destructive && styles.confirmBtnDestructive]}
            onPress={onConfirm}
            accessibilityRole="button"
          >
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </BlurredModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    maxWidth: 360,
    alignSelf: "center",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
  },
  title: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 10,
    textAlign: "center",
  },
  message: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  cancelText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },
  confirmBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PURPLE,
  },
  confirmBtnDestructive: {
    backgroundColor: DESTRUCTIVE,
  },
  confirmText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
});
