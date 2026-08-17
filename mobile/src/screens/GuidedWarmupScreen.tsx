import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { postSessionComplete } from "../api/workoutSessions";
import { speakPlainCue, unlockWebSpeech } from "../services/aiTrainer/audioCoach";
import {
  getPhaseRemainingSec,
  getPreparingRemainingSec,
  getSessionElapsedSec,
  useGuidedWarmupStore,
} from "../store/guidedWarmupStore";
import {
  buildGuidedWarmupCompletePayload,
  estimateGuidedWarmupKcal,
  finalizePhaseDurations,
} from "../utils/guidedWarmupComplete";
import type { WarmupPhase } from "../utils/generatePreworkoutPlan";

const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GREEN = "#0F6E56";
const TEXT = "#1A1A18";
const MUTED = "#6B7280";
const WHITE = "#FFFFFF";
const BORDER = "#ECEAE5";

function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseIcon(type: WarmupPhase["type"]): keyof typeof Ionicons.glyphMap {
  if (type === "run") return "fitness";
  if (type === "brisk_walk") return "walk";
  return "footsteps";
}

function speakPhaseTransition(phase: WarmupPhase, t: (key: string, opts?: Record<string, unknown>) => string) {
  const text = t("coach.workoutPlannerScreen.preworkout.phaseCue", {
    speed: phase.speed_kmh,
    incline: phase.incline_level,
  });
  speakPlainCue(text);
}

export default function GuidedWarmupScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const session = useGuidedWarmupStore((s) => s.session);
  const activateFromPreparing = useGuidedWarmupStore((s) => s.activateFromPreparing);
  const pauseSession = useGuidedWarmupStore((s) => s.pauseSession);
  const resumeSession = useGuidedWarmupStore((s) => s.resumeSession);
  const advancePhase = useGuidedWarmupStore((s) => s.advancePhase);
  const skipPhase = useGuidedWarmupStore((s) => s.skipPhase);
  const completeSession = useGuidedWarmupStore((s) => s.completeSession);
  const abandonSession = useGuidedWarmupStore((s) => s.abandonSession);
  const clearSession = useGuidedWarmupStore((s) => s.clearSession);

  const [, tick] = useState(0);
  const lastPhaseIndexRef = useRef<number | null>(null);
  const persistedRef = useRef(false);
  const [showTransitionBanner, setShowTransitionBanner] = useState(false);
  const [displayKcal, setDisplayKcal] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!session) {
      navigation.goBack();
    }
  }, [navigation, session]);

  const isPreparing = session?.status === "preparing";
  const currentPhase = session?.phases[session.current_phase_index];
  const nextPhase = session ? session.phases[session.current_phase_index + 1] : undefined;
  const preparingRemainingSec = getPreparingRemainingSec(session);
  const remainingSec = getPhaseRemainingSec(session);
  const elapsedSec = getSessionElapsedSec(session);

  const persistSession = useCallback(
    async (status: "completed" | "abandoned") => {
      if (!session || persistedRef.current) return;
      const durations = finalizePhaseDurations(session);
      if (durations.every((d) => d <= 0)) return;

      const actualKcal = estimateGuidedWarmupKcal(session.phases, durations, session.weight_kg);
      const payload = buildGuidedWarmupCompletePayload(session, status, durations);
      persistedRef.current = true;
      setDisplayKcal(actualKcal);

      if (payload) {
        try {
          await postSessionComplete(payload);
        } catch {
          // best-effort — client totals still shown
        }
      }

      if (status === "completed") {
        completeSession(actualKcal);
      } else {
        abandonSession();
      }
    },
    [abandonSession, completeSession, session],
  );

  useEffect(() => {
    if (!session || session.status !== "preparing") return;
    if (preparingRemainingSec > 0) return;
    activateFromPreparing();
    const first = session.phases[0];
    if (first) speakPhaseTransition(first, t);
    lastPhaseIndexRef.current = 0;
  }, [activateFromPreparing, preparingRemainingSec, session, t]);

  const handlePhaseAdvance = useCallback(() => {
    if (!session || !currentPhase || session.status !== "active") return;
    advancePhase();
  }, [advancePhase, currentPhase, session]);

  useEffect(() => {
    if (!session || session.status !== "active" || !currentPhase) return;
    if (remainingSec > 0) return;
    handlePhaseAdvance();
  }, [currentPhase, handlePhaseAdvance, remainingSec, session]);

  useEffect(() => {
    if (!session || session.status !== "completed" || persistedRef.current) return;
    void persistSession("completed");
  }, [persistSession, session?.status]);

  useEffect(() => {
    if (!session || !currentPhase || session.status !== "active") return;
    if (lastPhaseIndexRef.current === session.current_phase_index) return;
    if (lastPhaseIndexRef.current === null) {
      lastPhaseIndexRef.current = session.current_phase_index;
      return;
    }
    lastPhaseIndexRef.current = session.current_phase_index;
    setShowTransitionBanner(true);
    speakPhaseTransition(currentPhase, t);
    const timer = setTimeout(() => setShowTransitionBanner(false), 2500);
    return () => clearTimeout(timer);
  }, [currentPhase, session, t]);

  const exitWithoutProgress = useCallback(() => {
    abandonSession();
    clearSession();
    navigation.goBack();
  }, [abandonSession, clearSession, navigation]);

  const confirmEndSession = useCallback(
    (onConfirm: () => void) => {
      Alert.alert(
        t("coach.workoutPlannerScreen.preworkout.endConfirmTitle"),
        t("coach.workoutPlannerScreen.preworkout.endConfirmBody"),
        [
          { text: t("coach.workoutPlannerScreen.preworkout.endConfirmCancel"), style: "cancel" },
          {
            text: t("coach.workoutPlannerScreen.preworkout.endConfirmAction"),
            style: "destructive",
            onPress: onConfirm,
          },
        ],
      );
    },
    [t],
  );

  const handleEndConfirmed = useCallback(async () => {
    if (!session) return;
    if (getSessionElapsedSec(session) <= 0) {
      exitWithoutProgress();
      return;
    }
    await persistSession("abandoned");
    clearSession();
    navigation.goBack();
  }, [clearSession, exitWithoutProgress, navigation, persistSession, session]);

  const handleEnd = useCallback(() => {
    if (!session) return;
    if (getSessionElapsedSec(session) <= 0) {
      exitWithoutProgress();
      return;
    }
    confirmEndSession(() => {
      void handleEndConfirmed();
    });
  }, [confirmEndSession, exitWithoutProgress, handleEndConfirmed, session]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleEnd();
      return true;
    });
    return () => sub.remove();
  }, [handleEnd]);

  const handleComplete = () => {
    clearSession();
    navigation.goBack();
  };

  if (!session || !currentPhase) {
    return null;
  }

  const isPaused = session.status === "paused";
  const isCompleted = session.status === "completed";
  const kcalShown = displayKcal ?? session.actual_kcal ?? session.estimated_kcal;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={handleEnd} hitSlop={10}>
          <Ionicons name="close" size={24} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("coach.workoutPlannerScreen.preworkout.guidedTitle")}</Text>
        <Text style={styles.headerMeta}>{session.day_label}</Text>
      </View>

      <View style={styles.progressTrack}>
        {session.phases.map((phase, index) => (
          <View
            key={phase.id}
            style={[
              styles.progressSegment,
              index < session.current_phase_index
                ? styles.progressDone
                : index === session.current_phase_index && !isPreparing
                  ? styles.progressActive
                  : styles.progressPending,
            ]}
          />
        ))}
      </View>

      {showTransitionBanner ? (
        <View style={styles.transitionBanner}>
          <Text style={styles.transitionText}>
            {t("coach.workoutPlannerScreen.preworkout.transitionBanner", {
              speed: currentPhase.speed_kmh,
              incline: currentPhase.incline_level,
            })}
          </Text>
        </View>
      ) : null}

      <View style={styles.main}>
        {isPreparing ? (
          <>
            <Text style={styles.preparingTitle}>{t("coach.workoutPlannerScreen.preworkout.preparingTitle")}</Text>
            <Text style={styles.preparingCountdown}>{preparingRemainingSec}</Text>
            <Text style={styles.preparingHint}>{t("coach.workoutPlannerScreen.preworkout.preparingHint")}</Text>
          </>
        ) : (
          <>
            <View style={styles.phaseIconWrap}>
              <Ionicons name={phaseIcon(currentPhase.type)} size={34} color={PURPLE} />
            </View>
            <Text style={styles.phaseLabel}>{currentPhase.label}</Text>
            <Text style={styles.timer}>{isCompleted ? "00:00" : formatClock(remainingSec)}</Text>
            <Text style={styles.elapsed}>
              {t("coach.workoutPlannerScreen.preworkout.elapsed", { time: formatClock(elapsedSec) })}
            </Text>

            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>{t("coach.workoutPlannerScreen.preworkout.speed")}</Text>
                <Text style={styles.statValue}>{currentPhase.speed_kmh} km/h</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>{t("coach.workoutPlannerScreen.preworkout.incline")}</Text>
                <Text style={styles.statValue}>
                  {t("coach.workoutPlannerScreen.preworkout.inclineLevel", { level: currentPhase.incline_level })}
                </Text>
              </View>
            </View>

            {nextPhase && !isCompleted ? (
              <Text style={styles.nextPreview}>
                {t("coach.workoutPlannerScreen.preworkout.nextPhase", {
                  label: nextPhase.label,
                  speed: nextPhase.speed_kmh,
                  incline: nextPhase.incline_level,
                })}
              </Text>
            ) : null}

            {isCompleted ? (
              <View style={styles.completeBox}>
                <Text style={styles.completeTitle}>{t("coach.workoutPlannerScreen.preworkout.completeTitle")}</Text>
                <Text style={styles.completeBody}>
                  {t("coach.workoutPlannerScreen.preworkout.completeBody", { kcal: kcalShown })}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.footer}>
        {isPreparing ? (
          <Pressable style={styles.primaryBtn} onPress={handleEnd}>
            <Text style={styles.primaryBtnText}>{t("coach.workoutPlannerScreen.preworkout.end")}</Text>
          </Pressable>
        ) : !isCompleted ? (
          <>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                if (Platform.OS === "web") unlockWebSpeech();
                if (isPaused) resumeSession();
                else pauseSession();
              }}
            >
              <Text style={styles.secondaryBtnText}>
                {isPaused
                  ? t("coach.workoutPlannerScreen.preworkout.resume")
                  : t("coach.workoutPlannerScreen.preworkout.pause")}
              </Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                if (Platform.OS === "web") unlockWebSpeech();
                skipPhase();
              }}
            >
              <Text style={styles.secondaryBtnText}>{t("coach.workoutPlannerScreen.preworkout.skipPhase")}</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={handleEnd}>
              <Text style={styles.primaryBtnText}>{t("coach.workoutPlannerScreen.preworkout.end")}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={styles.primaryBtn} onPress={handleComplete}>
            <Text style={styles.primaryBtnText}>{t("coach.workoutPlannerScreen.preworkout.done")}</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WHITE },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { color: TEXT, fontSize: 20, fontWeight: "900", marginTop: 8 },
  headerMeta: { color: MUTED, fontSize: 12, marginTop: 2 },
  progressTrack: { flexDirection: "row", gap: 4, paddingHorizontal: 16, marginBottom: 12 },
  progressSegment: { flex: 1, height: 5, borderRadius: 99 },
  progressDone: { backgroundColor: GREEN },
  progressActive: { backgroundColor: PURPLE },
  progressPending: { backgroundColor: BORDER },
  transitionBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: PURPLE_LIGHT,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: PURPLE,
  },
  transitionText: { color: PURPLE, fontSize: 12, fontWeight: "800", textAlign: "center" },
  main: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  preparingTitle: { color: TEXT, fontSize: 18, fontWeight: "900", textAlign: "center", marginBottom: 12 },
  preparingCountdown: { color: PURPLE, fontSize: 72, fontWeight: "900", fontVariant: ["tabular-nums"] },
  preparingHint: { color: MUTED, fontSize: 14, marginTop: 12, textAlign: "center", lineHeight: 20 },
  phaseIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: PURPLE_LIGHT,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  phaseLabel: { color: TEXT, fontSize: 18, fontWeight: "900", marginBottom: 8 },
  timer: { color: PURPLE, fontSize: 56, fontWeight: "900", fontVariant: ["tabular-nums"] },
  elapsed: { color: MUTED, fontSize: 12, marginTop: 6, marginBottom: 18 },
  statRow: { flexDirection: "row", gap: 10, width: "100%" },
  statCard: {
    flex: 1,
    backgroundColor: PURPLE_LIGHT,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statLabel: { color: MUTED, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  statValue: { color: TEXT, fontSize: 20, fontWeight: "900", marginTop: 4 },
  nextPreview: { color: MUTED, fontSize: 12, marginTop: 16, textAlign: "center", lineHeight: 18 },
  completeBox: {
    marginTop: 18,
    backgroundColor: GREEN,
    borderRadius: 14,
    padding: 14,
    width: "100%",
  },
  completeTitle: { color: WHITE, fontSize: 16, fontWeight: "900" },
  completeBody: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 4, lineHeight: 18 },
  footer: { flexDirection: "row", gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: BORDER },
  secondaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: WHITE,
  },
  secondaryBtnText: { color: TEXT, fontSize: 13, fontWeight: "800" },
  primaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PURPLE,
  },
  primaryBtnText: { color: WHITE, fontSize: 13, fontWeight: "900" },
});
