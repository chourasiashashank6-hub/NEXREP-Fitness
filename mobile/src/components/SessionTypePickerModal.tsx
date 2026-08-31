import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurredModalBackdrop } from "./BlurredModalBackdrop";
import { GREEN, TEXT } from "../theme/colors";

const CREAM = "#F1EFE8";
const MUTED = "#6B7280";
const BORDER = "#E5E7EB";

export type SessionStartChoice = "standard" | "ai_camera";

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onChoose: (type: SessionStartChoice) => void;
  dayTitle?: string;
}

export function SessionTypePickerModal({ visible, onDismiss, onChoose, dayTitle }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.root}>
        <BlurredModalBackdrop onPress={onDismiss} accessibilityLabel="Cancel" />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.eyebrow}>START SESSION</Text>
            <Text style={styles.title}>{dayTitle || "Guided workout"}</Text>
            <Text style={styles.sub}>Choose how you want to train today</Text>

            <Pressable style={styles.card} onPress={() => onChoose("standard")}>
              <Text style={styles.cardTitle}>Standard session</Text>
              <Text style={styles.cardMeta}>Manual sets · rest timers · form camera on demand</Text>
            </Pressable>

            <Pressable style={[styles.card, styles.cardAi]} onPress={() => onChoose("ai_camera")}>
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeTxt}>New</Text>
              </View>
              <Text style={styles.cardTitle}>Active camera Session</Text>
              <Text style={styles.cardMeta}>
                Auto-count reps · posture cues · hands-free set advance
              </Text>
            </Pressable>

            <Pressable style={styles.cancel} onPress={onDismiss}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: CREAM,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: MUTED,
    marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: "800", color: TEXT },
  sub: { color: MUTED, fontSize: 13, marginBottom: 16, marginTop: 2 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: BORDER,
    marginBottom: 10,
  },
  cardAi: {
    borderColor: GREEN,
  },
  newBadge: {
    alignSelf: "flex-start",
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  newBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  cardTitle: { fontSize: 16, fontWeight: "800", color: TEXT, marginBottom: 4 },
  cardMeta: { fontSize: 13, color: MUTED, lineHeight: 18 },
  cancel: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  cancelTxt: { color: MUTED, fontWeight: "700" },
});
