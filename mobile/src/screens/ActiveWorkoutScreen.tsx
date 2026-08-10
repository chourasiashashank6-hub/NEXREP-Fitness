import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { fetchWorkoutPlanCurrent } from "../api/workoutPlanner";
import { postSessionComplete } from "../api/workoutSessions";
import { getProfile } from "../api/user";
import { EndEarlySheet } from "../components/EndEarlySheet";
import { CameraGuidedSessionFrame } from "../components/aiTrainer/CameraGuidedSessionFrame";
import { useCameraTracking } from "../hooks/useCameraTracking";
import { usePoseCalibrationStore } from "../store/poseCalibrationStore";
import { navigationRef } from "../navigation/navigationRef";
import { scheduleRestEndNotification } from "../services/notificationService";
import {
  type SessionExercise,
  useWorkoutSessionStore,
} from "../store/workoutSessionStore";
import type { RootStackParamList } from "../navigation/types";
import {
  calcExerciseEstimateKcal,
  calcSetKcal,
  metForExercise,
} from "../utils/sessionCalories";
import { notifyUser } from "../utils/notify";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E1F5EE";
const GREEN_DARK = "#085041";
const AMBER = "#BA7517";
const AMBER_BG = "#FAEEDA";
const PURPLE = "#534AB7";
const PURPLE_BG = "#EEEDFE";
const TEXT = "#1A1A18";
const MUTED = "#6B7280";
const BORDER = "#E5E7EB";
const DOT = "#1D9E75";

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h >= 1) {
    return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function parseReps(reps: string | number): number {
  const n = typeof reps === "number" ? reps : parseInt(String(reps), 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export default function ActiveWorkoutScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "ActiveWorkoutSession">>();
  const planId = route.params?.planId;

  const session = useWorkoutSessionStore((s) => s.session);
  const startSession = useWorkoutSessionStore((s) => s.startSession);
  const logSet = useWorkoutSessionStore((s) => s.logSet);
  const beginRest = useWorkoutSessionStore((s) => s.beginRest);
  const endRest = useWorkoutSessionStore((s) => s.endRest);
  const advanceExercise = useWorkoutSessionStore((s) => s.advanceExercise);
  const completeSession = useWorkoutSessionStore((s) => s.completeSession);
  const abandonSession = useWorkoutSessionStore((s) => s.abandonSession);
  const clearSession = useWorkoutSessionStore((s) => s.clearSession);

  const [, tick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userWeightKg, setUserWeightKg] = useState(70);
  const [currentStreak] = useState(0);
  const [weightInput, setWeightInput] = useState("");
  const [setStartedAt, setSetStartedAt] = useState(() => new Date());
  const [showEndSheet, setShowEndSheet] = useState(false);
  const [showSessionCamera, setShowSessionCamera] = useState(false);
  const [sessionCameraError, setSessionCameraError] = useState<string | null>(null);
  const [sessionCameraPermission, requestSessionCameraPermission] = useCameraPermissions();
  const needsCalBanner = usePoseCalibrationStore((s) => s.skipped && !s.hasCalibration());
  const needsRecalibration = usePoseCalibrationStore((s) => s.needsRecalibration);
  const bootstrapped = useRef(false);

  useEffect(() => {
    // Don't tick while camera is open — parent re-renders remount MediaPipe on web/native.
    if (showSessionCamera) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [showSessionCamera]);

  const handleSessionCameraReady = useCallback(() => {
    setSessionCameraError(null);
  }, []);

  const handleSessionCameraError = useCallback((message: string) => {
    setSessionCameraError(message);
  }, []);

  useEffect(() => {
    getProfile()
      .then((p: any) => {
        const w = Number(p?.weight ?? p?.weight_kg ?? 70);
        if (Number.isFinite(w) && w > 0) setUserWeightKg(w);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      try {
        const todayPlan = await fetchWorkoutPlanCurrent();
        if (!todayPlan?.today) {
          notifyUser("No plan", "No workout scheduled for today.");
          navigation.goBack();
          return;
        }
        const planDay = todayPlan.today;
        if (planDay.is_rest_day) {
          notifyUser("Rest day", "Today is a rest day");
          navigation.goBack();
          return;
        }

        const sessionExercises: SessionExercise[] = planDay.exercises.map((ex) => ({
          exercise_name: ex.name,
          muscle: ex.muscle,
          sets: ex.sets,
          reps: parseReps(ex.reps),
          rest_seconds: ex.rest_seconds || 90,
          met_value: metForExercise(ex.name),
        }));

        const dayName = planDay.split_name;
        const planDayId = String(todayPlan.plan_id);
        const existing = useWorkoutSessionStore.getState().session;
        const canResume =
          existing &&
          existing.plan_day_id === planDayId &&
          (existing.status === "active" || existing.status === "resting") &&
          (existing.session_type ?? "standard") === "standard";

        if (!canResume) {
          startSession(planDayId, todayPlan.plan_id, dayName, sessionExercises, "standard");
          setSetStartedAt(new Date());
        }
      } catch {
        notifyUser("Error", "Could not load today's workout plan.");
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [navigation, planId, startSession]);

  // Auto end rest when countdown hits 0
  useEffect(() => {
    if (!session || session.status !== "resting" || !session.rest_ends_at) return;
    const remaining = Math.ceil((new Date(session.rest_ends_at).getTime() - Date.now()) / 1000);
    if (remaining <= 0) {
      endRest();
      setSetStartedAt(new Date());
    }
  }, [session, tick, endRest]);

  const blockLeave = Boolean(session && (session.status === "active" || session.status === "resting"));

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (blockLeave) {
          setShowEndSheet(true);
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [blockLeave]),
  );

  const currentExercise = session?.exercises[session.current_exercise_index];
  const elapsedSec = session
    ? Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
    : 0;
  const setElapsedSec = Math.floor((Date.now() - setStartedAt.getTime()) / 1000);
  const restRemainingSec =
    session?.rest_ends_at != null
      ? Math.max(0, Math.ceil((new Date(session.rest_ends_at).getTime() - Date.now()) / 1000))
      : 0;

  const totalSets = session?.exercises.reduce((s, ex) => s + ex.sets, 0) ?? 1;
  const completedSets = session?.set_logs.length ?? 0;
  const progress = Math.min(1, completedSets / Math.max(1, totalSets));
  const totalKcal = session?.set_logs.reduce((s, l) => s + l.kcal, 0) ?? 0;
  const totalVolume = session?.set_logs.reduce((s, l) => s + l.reps * (l.weight_kg ?? 0), 0) ?? 0;
  const upcoming = session ? session.exercises.slice(session.current_exercise_index + 1) : [];
  const exercisesLeft = upcoming.length + (currentExercise ? 1 : 0);
  const cameraTargetReps = currentExercise ? parseReps(currentExercise.reps) : 10;
  const cameraTracking = useCameraTracking({
    exerciseName: currentExercise?.exercise_name ?? "",
    targetReps: cameraTargetReps,
    enableAudio: true,
  });

  useEffect(() => {
    if (showSessionCamera) cameraTracking.resetTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSessionCamera, currentExercise?.exercise_name]);

  const estimatedMinutesLeft = Math.max(
    1,
    Math.round(
      (upcoming.reduce((s, ex) => s + ex.sets, 0) +
        (currentExercise ? Math.max(0, currentExercise.sets - (session?.current_set ?? 1) + 1) : 0)) *
        2.5,
    ),
  );

  const buildCompletePayload = (status: "completed" | "abandoned") => {
    const s = useWorkoutSessionStore.getState().session;
    if (!s) return null;
    return {
      session_id: s.session_id,
      plan_day_id: s.plan_day_id,
      started_at: s.started_at,
      ended_at: new Date().toISOString(),
      status,
      set_logs: s.set_logs.map(
        ({ exercise_name, set_number, reps, weight_kg, started_at, completed_at, tracking_method }) => ({
          exercise_name,
          set_number,
          reps,
          weight_kg,
          started_at,
          completed_at,
          tracking_method: tracking_method ?? "manual",
        }),
      ),
      user_weight_kg: userWeightKg,
    };
  };

  const handleSetDone = async () => {
    if (!session || !currentExercise) return;
    const now = new Date();
    const weight = weightInput.trim() ? Number(weightInput) : null;
    const kcal = calcSetKcal({
      exerciseName: currentExercise.exercise_name,
      userWeightKg,
      setDurationSec: setElapsedSec,
      restDurationSec: currentExercise.rest_seconds,
    });

    logSet({
      exercise_name: currentExercise.exercise_name,
      reps: currentExercise.reps,
      weight_kg: Number.isFinite(weight as number) ? (weight as number) : null,
      started_at: setStartedAt.toISOString(),
      completed_at: now.toISOString(),
      kcal,
      tracking_method: "manual",
    });

    const isLastSet = session.current_set >= currentExercise.sets;
    const isLastExercise = session.current_exercise_index >= session.exercises.length - 1;

    if (!isLastSet) {
      beginRest(currentExercise.rest_seconds);
      const restEnd = new Date(Date.now() + currentExercise.rest_seconds * 1000);
      const nextLabel = `Set ${session.current_set + 1} of ${currentExercise.sets} — ${currentExercise.exercise_name}`;
      void scheduleRestEndNotification(restEnd, nextLabel);
    } else if (!isLastExercise) {
      advanceExercise();
      setSetStartedAt(new Date());
    } else {
      completeSession();
      const payload = buildCompletePayload("completed");
      let serverResult = { server_kcal_total: totalKcal + kcal, streak_incremented: true };
      if (payload) {
        try {
          serverResult = await postSessionComplete(payload);
        } catch {
          // still show completion with client totals
        }
      }
      navigation.replace("WorkoutCompletion", {
        elapsedSec,
        clientKcal: totalKcal + kcal,
        serverKcal: serverResult.server_kcal_total,
        volumeKg: totalVolume + currentExercise.reps * (Number.isFinite(weight as number) ? (weight as number) : 0),
        setsCompleted: completedSets + 1,
        streakIncremented: serverResult.streak_incremented,
      });
    }
  };

  const handleSkipRest = () => {
    endRest();
    setSetStartedAt(new Date());
  };

  const handleEndEarly = async () => {
    abandonSession();
    const payload = buildCompletePayload("abandoned");
    if (payload) {
      try {
        await postSessionComplete(payload);
      } catch {
        // best-effort
      }
    }
    clearSession();
    setShowEndSheet(false);
    navigation.popToTop();
  };

  const openSessionCamera = async () => {
    setSessionCameraError(null);
    try {
      if (!sessionCameraPermission?.granted) {
        const result = await requestSessionCameraPermission();
        if (!result.granted) {
          setSessionCameraError("Camera permission denied");
          return;
        }
      }
      setShowSessionCamera(true);
    } catch (e) {
      setSessionCameraError(e instanceof Error ? e.message : "Camera failed");
      setShowSessionCamera(true);
    }
  };

  if (loading || !session || !currentExercise) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={GREEN} />
          <Text style={styles.loadingTxt}>Loading session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const resting = session.status === "resting";

  if (showSessionCamera && currentExercise) {
    const coachWarn =
      cameraTracking.bannerCue?.priority === "correction" ||
      cameraTracking.bannerCue?.priority === "safety" ||
      cameraTracking.liveStatus === "no_body" ||
      !cameraTracking.orientationOk;
    const coachText =
      cameraTracking.bannerCue?.text ||
      cameraTracking.liveCorrection ||
      t("aiTrainer.tracking_ready", { defaultValue: "Tracking locked — start when ready" });

    return (
      <CameraGuidedSessionFrame
        exerciseName={currentExercise.exercise_name}
        exerciseSubtitle={`Set ${session.current_set} of ${currentExercise.sets} · ${session.day_name}`}
        targetReps={cameraTargetReps}
        poseSpec={cameraTracking.poseSpec}
        calibration={cameraTracking.calibrationPayload}
        isActive
        countingPaused={cameraTracking.countingPaused}
        sessionPaused={cameraTracking.sessionPaused}
        facingMode={cameraTracking.facingMode}
        repCount={cameraTracking.repCount}
        formScore={cameraTracking.formScore}
        verdicts={cameraTracking.verdicts}
        liveRom01={cameraTracking.liveRom01}
        liveInZone={cameraTracking.liveInZone}
        zoneStart01={cameraTracking.zoneStart01}
        zoneEnd01={cameraTracking.zoneEnd01}
        orientationOk={cameraTracking.orientationOk}
        liveStatus={cameraTracking.liveStatus}
        coachText={coachText}
        coachWarn={coachWarn}
        ttsSpeaking={cameraTracking.ttsSpeaking}
        trackingRunning={cameraTracking.trackingRunning}
        voiceMode={cameraTracking.voiceMode}
        webAudioReady={cameraTracking.webAudioReady}
        cameraError={sessionCameraError}
        showCalibrateBanner={needsCalBanner || needsRecalibration}
        onClose={() => setShowSessionCamera(false)}
        onCalibrate={() => {
          setShowSessionCamera(false);
          navigationRef.navigate("AITrainerCalibration" as never, { planId } as never);
        }}
        onPauseToggle={cameraTracking.handlePauseToggle}
        onVoiceModeCycle={cameraTracking.handleVoiceModeCycle}
        onFlipCam={cameraTracking.handleFlipCam}
        flipDisabled={cameraTracking.flipInProgress}
        onCameraFlipped={cameraTracking.handleCameraFlipped}
        onZoomIn={cameraTracking.handleZoomIn}
        onZoomOut={cameraTracking.handleZoomOut}
        zoomLevel={cameraTracking.zoomLevel}
        onTrackingUpdate={cameraTracking.handleTrackingUpdate}
        onReady={handleSessionCameraReady}
        onError={handleSessionCameraError}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.dot} />
            <Text style={styles.headerStatus}>
              {session.day_name} · in progress
            </Text>
          </View>
          <View style={styles.lockedRow}>
            <Ionicons name="lock-closed" size={12} color={MUTED} />
            <Text style={styles.lockedTxt}>Locked</Text>
          </View>
        </View>

        <Text style={styles.timerBig}>{formatElapsed(elapsedSec)}</Text>
        <Text style={styles.timerCap}>Total session time</Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressCap}>
          Exercise {session.current_exercise_index + 1} of {session.exercises.length} ·{" "}
          {Math.round(progress * 100)}% complete
        </Text>

        <View style={styles.exCard}>
          <View style={styles.exCardTop}>
            <Text style={styles.nowLbl}>
              NOW · SET {session.current_set} OF {currentExercise.sets}
            </Text>
            <Text style={styles.setTimer}>
              {resting ? formatElapsed(restRemainingSec) : formatElapsed(setElapsedSec)}
              {resting ? "" : " ↑"}
            </Text>
          </View>
          <Text style={styles.exName}>{currentExercise.exercise_name}</Text>
          <View style={styles.repsRow}>
            <Text style={styles.repsTxt}>{currentExercise.reps} reps · </Text>
            <TextInput
              style={styles.weightInput}
              value={weightInput}
              onChangeText={setWeightInput}
              placeholder="0"
              placeholderTextColor={MUTED}
              keyboardType="decimal-pad"
            />
            <Text style={styles.repsTxt}> kg</Text>
          </View>

          {sessionCameraError ? <Text style={styles.mismatch}>{sessionCameraError}</Text> : null}

          <Pressable style={styles.cameraRow} onPress={openSessionCamera}>
            <View style={styles.camBtn}>
              <Text style={{ fontSize: 16 }}>📷</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.camTitle}>Check your form</Text>
              <Text style={styles.camSub}>AI reviews your movement</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={MUTED} />
          </Pressable>

          {resting ? (
            <View style={styles.restBanner}>
              <Text style={styles.restTitle}>Rest · {formatElapsed(restRemainingSec)}</Text>
              <Pressable style={styles.skipRestBtn} onPress={handleSkipRest}>
                <Text style={styles.skipRestTxt}>Skip rest</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actionRow}>
              <Pressable style={styles.setDoneBtn} onPress={handleSetDone}>
                <Text style={styles.setDoneTxt}>✓ Set done</Text>
              </Pressable>
              <Pressable
                style={styles.restOutlineBtn}
                onPress={() => {
                  beginRest(currentExercise.rest_seconds);
                  void scheduleRestEndNotification(
                    new Date(Date.now() + currentExercise.rest_seconds * 1000),
                    `Set ${session.current_set + 1} of ${currentExercise.sets} — ${currentExercise.exercise_name}`,
                  );
                }}
              >
                <Text style={styles.restOutlineTxt}>Rest {currentExercise.rest_seconds}s</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.chipsRow}>
          <View style={[styles.chip, { backgroundColor: AMBER_BG }]}>
            <Text style={[styles.chipVal, { color: AMBER }]}>🔥 {totalKcal} kcal</Text>
            <Text style={styles.chipLbl}>Calories burned</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: PURPLE_BG }]}>
            <Text style={[styles.chipVal, { color: PURPLE }]}>🏋️ {Math.round(totalVolume)} kg</Text>
            <Text style={styles.chipLbl}>Volume</Text>
          </View>
        </View>

        {upcoming.length > 0 ? (
          <View style={styles.upNext}>
            <Text style={styles.upNextTitle}>Up next</Text>
            {upcoming.slice(0, 2).map((ex) => (
              <View key={ex.exercise_name} style={styles.upNextRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upNextName}>{ex.exercise_name}</Text>
                  <Text style={styles.upNextMeta}>
                    {ex.sets} × {ex.reps}
                  </Text>
                </View>
                <View style={styles.kcalBadge}>
                  <Text style={styles.kcalBadgeTxt}>
                    ~{calcExerciseEstimateKcal(ex.exercise_name, ex.sets, userWeightKg)} kcal
                  </Text>
                </View>
              </View>
            ))}
            {upcoming.length > 2 ? (
              <Text style={styles.moreRow}>+{upcoming.length - 2} more</Text>
            ) : null}
          </View>
        ) : null}

        <Pressable style={styles.endEarlyBtn} onPress={() => setShowEndSheet(true)}>
          <Text style={styles.endEarlyTxt}>End workout early</Text>
        </Pressable>
        <Text style={styles.endEarlyCap}>
          Ending early saves completed sets to history — streak won't count
        </Text>
      </ScrollView>

      <EndEarlySheet
        visible={showEndSheet}
        onDismiss={() => setShowEndSheet(false)}
        onConfirmEnd={handleEndEarly}
        exercisesLeft={exercisesLeft}
        kcalSoFar={totalKcal}
        elapsedMinutes={Math.max(1, Math.floor(elapsedSec / 60))}
        currentStreak={currentStreak}
        estimatedMinutesLeft={estimatedMinutesLeft}
        setsCompleted={completedSets}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 16, paddingBottom: 48 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { color: MUTED },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DOT },
  headerStatus: { color: MUTED, fontSize: 13, fontWeight: "600" },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  lockedTxt: { color: MUTED, fontSize: 12, fontWeight: "600" },
  timerBig: { fontSize: 40, fontWeight: "800", color: TEXT, marginTop: 16, textAlign: "center" },
  timerCap: { textAlign: "center", color: MUTED, fontSize: 12, marginBottom: 14 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: GREEN_LIGHT, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: GREEN, borderRadius: 4 },
  progressCap: { color: MUTED, fontSize: 12, marginTop: 6, marginBottom: 14 },
  exCard: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  exCardTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  nowLbl: { fontSize: 11, fontWeight: "800", color: GREEN_DARK, letterSpacing: 0.4 },
  setTimer: { fontSize: 12, fontWeight: "700", color: GREEN_DARK },
  exName: { fontSize: 20, fontWeight: "800", color: TEXT, marginBottom: 4 },
  repsRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  repsTxt: { color: MUTED, fontSize: 14, fontWeight: "600" },
  weightInput: {
    minWidth: 48,
    borderBottomWidth: 1,
    borderBottomColor: GREEN,
    color: TEXT,
    fontWeight: "800",
    fontSize: 14,
    paddingVertical: 0,
    textAlign: "center",
  },
  mismatch: { color: "#B42318", fontSize: 12, marginBottom: 8 },
  cameraRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  camBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  camTitle: { fontSize: 13, fontWeight: "700", color: TEXT },
  camSub: { fontSize: 11, color: MUTED },
  actionRow: { flexDirection: "row", gap: 8 },
  setDoneBtn: {
    flex: 1,
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  setDoneTxt: { color: "#fff", fontWeight: "800" },
  restOutlineBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: GREEN,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  restOutlineTxt: { color: GREEN, fontWeight: "800" },
  restBanner: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 8,
  },
  restTitle: { fontSize: 16, fontWeight: "800", color: GREEN_DARK },
  skipRestBtn: { paddingVertical: 6 },
  skipRestTxt: { color: GREEN, fontWeight: "700" },
  chipsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  chip: { flex: 1, borderRadius: 12, padding: 12 },
  chipVal: { fontSize: 15, fontWeight: "800" },
  chipLbl: { fontSize: 11, color: MUTED, marginTop: 2 },
  upNext: { marginBottom: 16 },
  upNextTitle: { fontSize: 13, fontWeight: "800", color: TEXT, marginBottom: 8 },
  upNextRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  upNextName: { fontSize: 14, fontWeight: "700", color: TEXT },
  upNextMeta: { fontSize: 12, color: MUTED },
  kcalBadge: { backgroundColor: AMBER_BG, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  kcalBadgeTxt: { color: AMBER, fontSize: 11, fontWeight: "700" },
  moreRow: { color: MUTED, fontSize: 12, textAlign: "center" },
  endEarlyBtn: {
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  endEarlyTxt: { color: MUTED, fontWeight: "700" },
  endEarlyCap: { textAlign: "center", color: MUTED, fontSize: 11, marginTop: 8 },
});
