import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatPrefillWeight } from "../utils/resolveLoadWeight";
import { GREEN, TEXT } from "../theme/colors";

const MUTED = "#6B7280";
const BORDER = "#E5E7EB";

function formatRest(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

type Props = {
  visible: boolean;
  exerciseName: string;
  setNumber: number;
  prefillKg: number | null;
  showRestTimer: boolean;
  restRemainingSec: number;
  restTotalSec: number;
  onConfirm: (weightKg: number | null) => void;
  onSkip: () => void;
};

export function SetWeightPrompt({
  visible,
  exerciseName,
  setNumber,
  prefillKg,
  showRestTimer,
  restRemainingSec,
  restTotalSec,
  onConfirm,
  onSkip,
}: Props) {
  const [value, setValue] = useState(formatPrefillWeight(prefillKg));

  useEffect(() => {
    if (visible) {
      setValue(formatPrefillWeight(prefillKg));
    }
  }, [visible, prefillKg, setNumber, exerciseName]);

  if (!visible) return null;

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      onSkip();
      return;
    }
    const parsed = Number(trimmed);
    onConfirm(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View style={styles.card}>
          {showRestTimer ? (
            <View style={styles.restRow}>
              <Text style={styles.restLabel}>Rest</Text>
              <Text style={styles.restTimer}>{formatRest(restRemainingSec)}</Text>
              <Text style={styles.restCap}>of {formatRest(restTotalSec)}</Text>
            </View>
          ) : null}
          <Text style={styles.title}>Log weight for set {setNumber}</Text>
          <Text style={styles.subtitle}>{exerciseName}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder={prefillKg ? formatPrefillWeight(prefillKg) : "0"}
              placeholderTextColor={MUTED}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={styles.unit}>kg</Text>
          </View>
          <View style={styles.actions}>
            <Pressable style={styles.skipBtn} onPress={onSkip}>
              <Text style={styles.skipTxt}>Skip</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={handleConfirm}>
              <Text style={styles.saveTxt}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  card: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  restRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 12,
  },
  restLabel: { color: GREEN, fontWeight: "800", fontSize: 12, letterSpacing: 0.4 },
  restTimer: { color: TEXT, fontWeight: "800", fontSize: 22 },
  restCap: { color: MUTED, fontSize: 12 },
  title: { fontSize: 17, fontWeight: "800", color: TEXT },
  subtitle: { color: MUTED, fontSize: 14, marginTop: 4, marginBottom: 14 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  input: {
    flex: 1,
    fontSize: 28,
    fontWeight: "800",
    color: TEXT,
    borderBottomWidth: 2,
    borderBottomColor: GREEN,
    paddingVertical: 6,
    textAlign: "center",
  },
  unit: { color: MUTED, fontWeight: "700", fontSize: 16 },
  actions: { flexDirection: "row", gap: 10 },
  skipBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },
  skipTxt: { color: MUTED, fontWeight: "700" },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: GREEN,
    alignItems: "center",
  },
  saveTxt: { color: "#fff", fontWeight: "800" },
});
