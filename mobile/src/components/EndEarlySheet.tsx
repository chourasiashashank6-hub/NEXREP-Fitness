import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

const GREEN = "#0F6E56";
const AMBER = "#BA7517";
const AMBER_BG = "#FAEEDA";
const RED_BG = "#FCEBEB";
const TEXT = "#1A1A18";
const MUTED = "#6B7280";
const BORDER = "#ECEAE5";

export interface EndEarlySheetProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirmEnd: () => void;
  exercisesLeft: number;
  kcalSoFar: number;
  elapsedMinutes: number;
  currentStreak: number;
  estimatedMinutesLeft: number;
  setsCompleted: number;
  /** Optional copy overrides (AI camera cancel). */
  title?: string;
  body?: string;
  keepLabel?: string;
  endLabel?: string;
}

export function EndEarlySheet({
  visible,
  onDismiss,
  onConfirmEnd,
  exercisesLeft,
  kcalSoFar,
  elapsedMinutes,
  currentStreak,
  estimatedMinutesLeft,
  setsCompleted,
  title,
  body,
  keepLabel,
  endLabel,
}: EndEarlySheetProps) {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!visible) {
      setCountdown(5);
      return;
    }
    setCountdown(5);
    const id = setInterval(() => {
      setCountdown((c) => (c <= 0 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [visible]);

  const endEnabled = countdown <= 0;
  const defaultEnd = endLabel || "End anyway";
  const endButtonLabel = endEnabled ? defaultEnd : `${defaultEnd} (${countdown})`;
  const setWord = setsCompleted === 1 ? "set" : "sets";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.alertCircle}>
            <Text style={styles.alertIcon}>!</Text>
          </View>
          <Text style={styles.title}>
            {title ||
              `Quit with ${exercisesLeft} exercise${exercisesLeft !== 1 ? "s" : ""} left?`}
          </Text>
          <Text style={styles.body}>
            {body ||
              `You've burned ${kcalSoFar} kcal in ${elapsedMinutes} minutes. Ending now saves your ${setsCompleted} completed ${setWord} to history, but today won't count toward your streak or weekly target.`}
          </Text>

          {currentStreak > 0 ? (
            <View style={styles.streakRow}>
              <Text style={styles.streakFlame}>🔥</Text>
              <Text style={styles.streakNum}>{currentStreak}</Text>
              <Text style={styles.streakWarn}>Won't count</Text>
            </View>
          ) : null}

          <Pressable style={styles.keepBtn} onPress={onDismiss}>
            <Text style={styles.keepTxt}>
              {keepLabel || `Keep going — ${estimatedMinutesLeft} min left`}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.endBtn, !endEnabled && styles.endBtnDisabled]}
            disabled={!endEnabled}
            onPress={onConfirmEnd}
          >
            <Text style={[styles.endTxt, !endEnabled && styles.endTxtDisabled]}>{endButtonLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 36,
    alignItems: "center",
  },
  alertCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: RED_BG,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  alertIcon: { color: "#E24B4A", fontSize: 22, fontWeight: "800" },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT,
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: MUTED,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 14,
  },
  streakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: AMBER_BG,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  streakFlame: { fontSize: 16 },
  streakNum: { fontSize: 15, fontWeight: "800", color: AMBER },
  streakWarn: { fontSize: 13, fontWeight: "700", color: AMBER },
  keepBtn: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    alignSelf: "stretch",
    marginBottom: 10,
  },
  keepTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  endBtn: { paddingVertical: 10 },
  endBtnDisabled: { opacity: 0.5 },
  endTxt: { color: MUTED, fontWeight: "700", fontSize: 14 },
  endTxtDisabled: { color: "#9CA3AF" },
});
