import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCameraPermissions } from "expo-camera";
import * as Speech from "expo-speech";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import Svg, { Circle } from "react-native-svg";
import { fetchWorkoutPlanCurrent } from "../api/workoutPlanner";
import { postSessionComplete } from "../api/workoutSessions";
import { getProfile } from "../api/user";
import { EndEarlySheet } from "../components/EndEarlySheet";
import MediaPipeGuidanceView, {
  type MediaPipeTrackingUpdate,
} from "../components/MediaPipeGuidanceView";
import { getExerciseTrackingConfig } from "../constants/exerciseTrackingConfig";
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
const CREAM = "#F1EFE8";
const AMBER = "#BA7517";
const AMBER_BG = "#FAEEDA";
const ORANGE = "#D85A30";
const TEXT = "#1A1A18";
const MUTED = "#6B7280";
const BORDER = "#E5E7EB";
const RED = "#E24B4A";
const CHECKPOINT_AUTO_MS = 5000;
const SPEECH_THROTTLE_MS = 4000;

const CAMERA_CANCEL_COPY = {
  title: "Cancel this session?",
  body: "Camera stops and completed sets save to history. Today won't count toward your streak.",
  keepLabel: "Keep going",
  endLabel: "End session anyway",
} as const;

type LiveTrackingStatus = "tracking_good" | "tracking_correction" | "no_body";

function toShortCue(raw: string, fallback: string): string {
  const cleaned = (raw || "")
    .replace(/[:·].*$/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\d+°?/g, "")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  return words.slice(0, 4).join(" ");
}

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h >= 1) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function parseReps(reps: string | number): number {
  const n = typeof reps === "number" ? reps : parseInt(String(reps), 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function RestCountdownRing({
  remainingSec,
  totalSec,
}: {
  remainingSec: number;
  totalSec: number;
}) {
  const size = 140;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = totalSec > 0 ? Math.max(0, Math.min(1, remainingSec / totalSec)) : 0;
  const offset = c * (1 - pct);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={AMBER_BG}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ORANGE}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={styles.ringTime}>{formatElapsed(remainingSec)}</Text>
    </View>
  );
}

export default function AICameraWorkoutScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "AICameraWorkoutSession">>();
  const planId = route.params?.planId;

  const session = useWorkoutSessionStore((s) => s.session);
  const startSession = useWorkoutSessionStore((s) => s.startSession);
  const logSet = useWorkoutSessionStore((s) => s.logSet);
  const beginRest = useWorkoutSessionStore((s) => s.beginRest);
  const endRest = useWorkoutSessionStore((s) => s.endRest);
  const adjustRestRemaining = useWorkoutSessionStore((s) => s.adjustRestRemaining);
  const advanceExercise = useWorkoutSessionStore((s) => s.advanceExercise);
  const completeSession = useWorkoutSessionStore((s) => s.completeSession);
  const abandonSession = useWorkoutSessionStore((s) => s.abandonSession);
  const clearSession = useWorkoutSessionStore((s) => s.clearSession);
  const setAiUiPhase = useWorkoutSessionStore((s) => s.setAiUiPhase);
  const setCurrentRepCount = useWorkoutSessionStore((s) => s.setCurrentRepCount);
  const resetRepTracking = useWorkoutSessionStore((s) => s.resetRepTracking);
  const updateFormTracking = useWorkoutSessionStore((s) => s.updateFormTracking);
  const setAudioGuidanceEnabled = useWorkoutSessionStore((s) => s.setAudioGuidanceEnabled);
  const markExerciseCheckpoint = useWorkoutSessionStore((s) => s.markExerciseCheckpoint);
  const clearExerciseCheckpoint = useWorkoutSessionStore((s) => s.clearExerciseCheckpoint);

  const [, tick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userWeightKg, setUserWeightKg] = useState(70);
  const [weightInput, setWeightInput] = useState("");
  const [manualReps, setManualReps] = useState("");
  const [setStartedAt, setSetStartedAt] = useState(() => new Date());
  const [showEndSheet, setShowEndSheet] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [forceManual, setForceManual] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveTrackingStatus>("no_body");
  const [liveCorrection, setLiveCorrection] = useState("Step back into frame");
  const bootstrapped = useRef(false);
  const completingRef = useRef(false);
  const restFinishLock = useRef(false);
  const lastSpeechAt = useRef(0);
  const lastSpeechText = useRef("");
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
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
          existing.session_type === "ai_camera";

        if (!canResume) {
          startSession(planDayId, todayPlan.plan_id, dayName, sessionExercises, "ai_camera");
          setSetStartedAt(new Date());
        } else {
          setSetStartedAt(new Date());
        }

        if (!permission?.granted) {
          await requestPermission();
        }
      } catch {
        notifyUser("Error", "Could not load today's workout plan.");
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [navigation, planId, startSession, permission?.granted, requestPermission]);

  const currentExercise = session?.exercises[session.current_exercise_index];
  const trackingConfig = useMemo(
    () => (currentExercise ? getExerciseTrackingConfig(currentExercise.exercise_name) : null),
    [currentExercise],
  );
  const trackable = Boolean(trackingConfig);
  const poseExerciseName =
    trackingConfig?.mediaPipeName || currentExercise?.exercise_name || "";
  const cameraActive =
    Boolean(session) &&
    session?.session_type === "ai_camera" &&
    session.status === "active" &&
    session.ai_ui_phase === "tracking" &&
    trackable &&
    !forceManual;

  // Sync phase when exercise trackability changes
  useEffect(() => {
    if (!session || session.session_type !== "ai_camera") return;
    if (session.status === "resting") return;
    if (session.ai_ui_phase === "exercise_complete") return;
    if (!trackable || forceManual) {
      if (session.ai_ui_phase !== "manual_fallback") setAiUiPhase("manual_fallback");
    } else if (session.ai_ui_phase === "manual_fallback") {
      setAiUiPhase("tracking");
    }
  }, [session, trackable, forceManual, setAiUiPhase]);

  const finishRest = useCallback(() => {
    const s = useWorkoutSessionStore.getState().session;
    if (!s || s.status !== "resting") return;
    if (restFinishLock.current) return;
    restFinishLock.current = true;
    if (restTimer.current) {
      clearTimeout(restTimer.current);
      restTimer.current = null;
    }
    setForceManual(false);
    endRest();
    resetRepTracking();
    setLiveStatus("no_body");
    setSetStartedAt(new Date());
    // Allow a later rest period to complete
    setTimeout(() => {
      restFinishLock.current = false;
    }, 250);
  }, [endRest, resetRepTracking]);

  // Drive rest completion off rest_ends_at with a real timeout (fixes stuck 00:00).
  useEffect(() => {
    if (restTimer.current) {
      clearTimeout(restTimer.current);
      restTimer.current = null;
    }
    if (!session || session.status !== "resting" || !session.rest_ends_at) return;

    const endsAt = new Date(session.rest_ends_at).getTime();
    if (Number.isNaN(endsAt)) return;

    const ms = endsAt - Date.now();
    if (ms <= 0) {
      finishRest();
      return;
    }
    restTimer.current = setTimeout(() => {
      finishRest();
    }, ms);
    return () => {
      if (restTimer.current) {
        clearTimeout(restTimer.current);
        restTimer.current = null;
      }
    };
  }, [session?.status, session?.rest_ends_at, finishRest]);

  const handleSkipRest = useCallback(() => {
    finishRest();
  }, [finishRest]);

  const handleAdjustRest = useCallback(
    (deltaSeconds: number) => {
      const shouldComplete = adjustRestRemaining(deltaSeconds);
      if (shouldComplete) finishRest();
      else tick((n) => n + 1); // refresh ring immediately
    },
    [adjustRestRemaining, finishRest],
  );

  // Auto-continue after exercise checkpoint
  useEffect(() => {
    if (!session || session.ai_ui_phase !== "exercise_complete") {
      if (checkpointTimer.current) {
        clearTimeout(checkpointTimer.current);
        checkpointTimer.current = null;
      }
      return;
    }
    if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
    checkpointTimer.current = setTimeout(() => {
      handleContinueAfterCheckpoint();
    }, CHECKPOINT_AUTO_MS);
    return () => {
      if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.ai_ui_phase, session?.exercise_checkpoint_at]);

  useEffect(() => {
    return () => {
      Speech.stop();
      if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
      if (restTimer.current) clearTimeout(restTimer.current);
    };
  }, []);

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

  const elapsedSec = session
    ? Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
    : 0;
  const restRemainingSec =
    session?.rest_ends_at != null
      ? Math.max(0, Math.ceil((new Date(session.rest_ends_at).getTime() - Date.now()) / 1000))
      : 0;
  const restTotalSec = Math.max(
    1,
    session?.rest_ring_total_sec ?? currentExercise?.rest_seconds ?? 90,
  );
  const totalKcal = session?.set_logs.reduce((s, l) => s + l.kcal, 0) ?? 0;
  const totalVolume = session?.set_logs.reduce((s, l) => s + l.reps * (l.weight_kg ?? 0), 0) ?? 0;
  const completedSets = session?.set_logs.length ?? 0;
  const upcoming = session ? session.exercises.slice(session.current_exercise_index + 1) : [];
  const nextExercise = upcoming[0];
  const exercisesLeft = upcoming.length + (currentExercise ? 1 : 0);
  const estimatedMinutesLeft = Math.max(
    1,
    Math.round(
      (upcoming.reduce((s, ex) => s + ex.sets, 0) +
        (currentExercise ? Math.max(0, currentExercise.sets - (session?.current_set ?? 1) + 1) : 0)) *
        2.5,
    ),
  );

  const formQualityPct = useMemo(() => {
    if (!session || session.form_total_samples <= 0) return null;
    return Math.round((session.form_good_samples / session.form_total_samples) * 100);
  }, [session]);

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

  const finishWorkout = async (extraKcal: number, extraVolume: number) => {
    if (completingRef.current) return;
    completingRef.current = true;
    completeSession();
    const payload = buildCompletePayload("completed");
    let serverResult = { server_kcal_total: totalKcal + extraKcal, streak_incremented: true };
    if (payload) {
      try {
        serverResult = await postSessionComplete(payload);
      } catch {
        // client totals fallback
      }
    }
    navigation.replace("WorkoutCompletion", {
      elapsedSec,
      clientKcal: totalKcal + extraKcal,
      serverKcal: serverResult.server_kcal_total,
      volumeKg: totalVolume + extraVolume,
      setsCompleted: completedSets + 1,
      streakIncremented: serverResult.streak_incremented,
    });
  };

  const completeCurrentSet = async (opts: {
    reps: number;
    method: "ai_camera" | "manual";
    weightKg?: number | null;
  }) => {
    if (!session || !currentExercise || completingRef.current) return;
    completingRef.current = true;
    const now = new Date();
    const weight =
      opts.weightKg !== undefined
        ? opts.weightKg
        : weightInput.trim()
          ? Number(weightInput)
          : null;
    const setDurationSec = Math.floor((now.getTime() - setStartedAt.getTime()) / 1000);
    const kcal = calcSetKcal({
      exerciseName: currentExercise.exercise_name,
      userWeightKg,
      setDurationSec,
      restDurationSec: currentExercise.rest_seconds,
    });
    const quality =
      opts.method === "ai_camera" && session.form_total_samples > 0
        ? Math.round((session.form_good_samples / session.form_total_samples) * 100)
        : null;

    logSet({
      exercise_name: currentExercise.exercise_name,
      reps: opts.reps,
      weight_kg: Number.isFinite(weight as number) ? (weight as number) : null,
      started_at: setStartedAt.toISOString(),
      completed_at: now.toISOString(),
      kcal,
      tracking_method: opts.method,
      form_quality_pct: quality,
    });

    const isLastSet = session.current_set >= currentExercise.sets;
    const isLastExercise = session.current_exercise_index >= session.exercises.length - 1;
    const volumeAdd = opts.reps * (Number.isFinite(weight as number) ? (weight as number) : 0);

    setForceManual(false);
    resetRepTracking();
    setLiveStatus("no_body");

    if (!isLastSet) {
      beginRest(currentExercise.rest_seconds);
      void scheduleRestEndNotification(
        new Date(Date.now() + currentExercise.rest_seconds * 1000),
        `Set ${session.current_set + 1} of ${currentExercise.sets} — ${currentExercise.exercise_name}`,
      );
      completingRef.current = false;
      return;
    }

    if (!isLastExercise) {
      markExerciseCheckpoint();
      completingRef.current = false;
      return;
    }

    await finishWorkout(kcal, volumeAdd);
  };

  const handleContinueAfterCheckpoint = () => {
    if (checkpointTimer.current) {
      clearTimeout(checkpointTimer.current);
      checkpointTimer.current = null;
    }
    clearExerciseCheckpoint();
    setForceManual(false);
    advanceExercise();
    resetRepTracking();
    setLiveStatus("no_body");
    setSetStartedAt(new Date());
  };

  const maybeSpeakCorrection = useCallback(
    (correction: string) => {
      const s = useWorkoutSessionStore.getState().session;
      if (!s?.audio_guidance_enabled) return;
      const text = (correction || "").trim();
      if (!text) return;
      const now = Date.now();
      if (text === lastSpeechText.current && now - lastSpeechAt.current < SPEECH_THROTTLE_MS) return;
      if (now - lastSpeechAt.current < SPEECH_THROTTLE_MS) return;
      lastSpeechAt.current = now;
      lastSpeechText.current = text;
      Speech.stop();
      Speech.speak(text, { rate: 1.0, pitch: 1.0 });
    },
    [],
  );

  const handleTrackingUpdate = useCallback(
    (update: MediaPipeTrackingUpdate) => {
      const s = useWorkoutSessionStore.getState().session;
      if (!s || s.ai_ui_phase !== "tracking" || s.status !== "active") return;
      const ex = s.exercises[s.current_exercise_index];
      if (!ex) return;

      if (!update.bodyDetected) {
        setLiveStatus("no_body");
        setLiveCorrection("Step back into frame");
        return;
      }

      if (update.reps !== s.current_rep_count) {
        setCurrentRepCount(update.reps);
      }
      updateFormTracking(update.formOk ? "good" : "correction", update.correction);

      if (update.formOk) {
        setLiveStatus("tracking_good");
      } else {
        const cfg = getExerciseTrackingConfig(ex.exercise_name);
        const cue = toShortCue(
          update.correction || cfg?.correctionCue || "",
          "Adjust your form",
        );
        setLiveStatus("tracking_correction");
        setLiveCorrection(cue);
        if (update.correction) maybeSpeakCorrection(cue);
      }

      if (update.reps >= ex.reps && !completingRef.current) {
        void completeCurrentSet({ reps: update.reps, method: "ai_camera" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maybeSpeakCorrection, setCurrentRepCount, updateFormTracking],
  );

  const handleManualSetDone = () => {
    if (!currentExercise) return;
    const repsRaw = manualReps.trim() ? Number(manualReps) : currentExercise.reps;
    const reps = Number.isFinite(repsRaw) && repsRaw > 0 ? Math.round(repsRaw) : currentExercise.reps;
    void completeCurrentSet({
      reps,
      method: "manual",
      weightKg: weightInput.trim() ? Number(weightInput) : null,
    });
  };

  const handleEndEarly = async () => {
    Speech.stop();
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

  if (loading || !session || !currentExercise) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={GREEN} />
          <Text style={styles.loadingTxt}>Loading AI camera session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const phase = session.ai_ui_phase;
  const resting = session.status === "resting";
  const nextLabel = nextExercise
    ? nextExercise.exercise_name
    : session.current_set < currentExercise.sets
      ? `Set ${session.current_set + 1}`
      : "Workout complete";

  // —— Exercise complete checkpoint (camera off) ——
  if (phase === "exercise_complete") {
    const exSets = session.set_logs.filter((l) => l.exercise_name === currentExercise.exercise_name);
    const exReps = exSets.reduce((s, l) => s + l.reps, 0);
    const exKcal = exSets.reduce((s, l) => s + l.kcal, 0);
    const avgForm =
      exSets.filter((l) => l.form_quality_pct != null).length > 0
        ? Math.round(
            exSets
              .filter((l) => l.form_quality_pct != null)
              .reduce((s, l) => s + (l.form_quality_pct || 0), 0) /
              exSets.filter((l) => l.form_quality_pct != null).length,
          )
        : formQualityPct;

    return (
      <SafeAreaView style={styles.safeCream} edges={["top", "left", "right"]}>
        <View style={styles.checkpointWrap}>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={36} color="#fff" />
          </View>
          <Text style={styles.checkpointEyebrow}>
            Exercise {session.current_exercise_index + 1} of {session.exercises.length} done
          </Text>
          <Text style={styles.checkpointTitle}>{currentExercise.exercise_name}</Text>
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statVal}>🔥 {Math.round(exKcal)}</Text>
              <Text style={styles.statLbl}>kcal</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statVal}>
                {exSets.length} × {exReps}
              </Text>
              <Text style={styles.statLbl}>sets · reps</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statVal}>{avgForm != null ? `${avgForm}%` : "—"}</Text>
              <Text style={styles.statLbl}>form</Text>
            </View>
          </View>

          {nextExercise ? (
            <View style={styles.upNextCard}>
              <Text style={styles.upNextLbl}>Up next</Text>
              <Text style={styles.upNextName}>{nextExercise.exercise_name}</Text>
              <Text style={styles.upNextMeta}>
                {nextExercise.sets} × {nextExercise.reps} · ~
                {calcExerciseEstimateKcal(nextExercise.exercise_name, nextExercise.sets, userWeightKg)}{" "}
                kcal
              </Text>
            </View>
          ) : null}

          <Pressable style={styles.primaryBtn} onPress={handleContinueAfterCheckpoint}>
            <Text style={styles.primaryBtnTxt}>
              Continue to {nextExercise?.exercise_name ?? "finish"}
            </Text>
          </Pressable>
          <Text style={styles.autoCap}>Camera reopens automatically in a few seconds</Text>
        </View>
        <EndEarlySheet
          visible={showEndSheet}
          onDismiss={() => setShowEndSheet(false)}
          onConfirmEnd={handleEndEarly}
          exercisesLeft={exercisesLeft}
          kcalSoFar={totalKcal}
          elapsedMinutes={Math.max(1, Math.floor(elapsedSec / 60))}
          currentStreak={0}
          estimatedMinutesLeft={estimatedMinutesLeft}
          setsCompleted={completedSets}
          {...CAMERA_CANCEL_COPY}
        />
      </SafeAreaView>
    );
  }

  // —— Rest (camera stays mounted) ——
  if (resting) {
    const restUpNext =
      session.current_set < currentExercise.sets
        ? `${currentExercise.exercise_name} · Set ${session.current_set + 1}`
        : nextLabel;

    return (
      <SafeAreaView style={styles.safeDark} edges={["top", "left", "right"]}>
        <View style={styles.cameraShell}>
          {trackable ? (
            <MediaPipeGuidanceView
              selectedExerciseName={poseExerciseName || currentExercise.exercise_name}
              isActive
              sessionMode
              onReady={() => setCameraError(null)}
              onError={(m) => setCameraError(m)}
            />
          ) : (
            <View style={styles.cameraPlaceholder} />
          )}
          <View style={[styles.hud, styles.restHud]}>
            <View style={styles.topRow}>
              <Pressable
                style={styles.circleBtn}
                onPress={() => setShowEndSheet(true)}
                accessibilityLabel="Cancel session"
              >
                <Ionicons name="close" size={20} color="#fff" />
              </Pressable>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.livePillTxt}>{formatElapsed(elapsedSec)}</Text>
              </View>
              <View style={styles.circleBtnPlaceholder} />
            </View>

            <View style={styles.restBodyOverlay}>
              <View style={styles.restRingRow}>
                <Pressable style={styles.restAdjustBtn} onPress={() => handleAdjustRest(-15)}>
                  <Ionicons name="remove" size={22} color="#fff" />
                  <Text style={styles.restAdjustLbl}>15s</Text>
                </Pressable>

                <RestCountdownRing remainingSec={restRemainingSec} totalSec={restTotalSec} />

                <Pressable style={styles.restAdjustBtn} onPress={() => handleAdjustRest(15)}>
                  <Ionicons name="add" size={22} color="#fff" />
                  <Text style={styles.restAdjustLbl}>15s</Text>
                </Pressable>
              </View>

              <Text style={[styles.restTitle, { color: "#fff" }]}>Rest</Text>
              <Text style={[styles.restSub, { color: "rgba(255,255,255,0.85)" }]}>
                Camera stays on — next set starts automatically
              </Text>

              <Pressable style={styles.skipRestBtn} onPress={handleSkipRest}>
                <Text style={styles.skipRestTxt}>Skip rest</Text>
              </Pressable>

              <View style={[styles.upNextCard, { backgroundColor: "rgba(241,239,232,0.95)" }]}>
                <Text style={styles.upNextLbl}>Up next</Text>
                <Text style={styles.upNextName}>{restUpNext}</Text>
              </View>
            </View>
          </View>
        </View>
        <EndEarlySheet
          visible={showEndSheet}
          onDismiss={() => setShowEndSheet(false)}
          onConfirmEnd={handleEndEarly}
          exercisesLeft={exercisesLeft}
          kcalSoFar={totalKcal}
          elapsedMinutes={Math.max(1, Math.floor(elapsedSec / 60))}
          currentStreak={0}
          estimatedMinutesLeft={estimatedMinutesLeft}
          setsCompleted={completedSets}
          {...CAMERA_CANCEL_COPY}
        />
      </SafeAreaView>
    );
  }

  // —— Manual fallback (camera fully unmounted) ——
  if (phase === "manual_fallback" || !trackable || forceManual) {
    return (
      <SafeAreaView style={styles.safeCream} edges={["top", "left", "right"]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerStatus}>
            {session.day_name} · {formatElapsed(elapsedSec)}
          </Text>
          <Pressable onPress={() => setShowEndSheet(true)}>
            <Text style={styles.endLink}>End</Text>
          </Pressable>
        </View>

        <View style={styles.offBanner}>
          <Ionicons name="videocam-off" size={22} color={MUTED} />
          <View style={{ flex: 1 }}>
            <Text style={styles.offTitle}>Camera is off</Text>
            <Text style={styles.offSub}>
              Form tracking isn’t available for this exercise
              {forceManual ? " — logging manually" : ""}
            </Text>
          </View>
        </View>

        <View style={styles.exCard}>
          <Text style={styles.nowLbl}>
            NOW · SET {session.current_set} OF {currentExercise.sets}
          </Text>
          <Text style={styles.exName}>{currentExercise.exercise_name}</Text>
          <View style={styles.manualRow}>
            <Text style={styles.manualLbl}>Reps</Text>
            <TextInput
              style={styles.manualInput}
              value={manualReps}
              onChangeText={setManualReps}
              placeholder={String(currentExercise.reps)}
              placeholderTextColor={MUTED}
              keyboardType="number-pad"
            />
            <Text style={styles.manualLbl}>kg</Text>
            <TextInput
              style={styles.manualInput}
              value={weightInput}
              onChangeText={setWeightInput}
              placeholder="0"
              placeholderTextColor={MUTED}
              keyboardType="decimal-pad"
            />
          </View>
          <Pressable style={styles.primaryBtn} onPress={handleManualSetDone}>
            <Text style={styles.primaryBtnTxt}>✓ Set done</Text>
          </Pressable>
        </View>

        {upcoming.length > 0 ? (
          <View style={styles.upNextCard}>
            <Text style={styles.upNextLbl}>Up next</Text>
            <Text style={styles.upNextName}>{upcoming[0].exercise_name}</Text>
          </View>
        ) : null}

        <EndEarlySheet
          visible={showEndSheet}
          onDismiss={() => setShowEndSheet(false)}
          onConfirmEnd={handleEndEarly}
          exercisesLeft={exercisesLeft}
          kcalSoFar={totalKcal}
          elapsedMinutes={Math.max(1, Math.floor(elapsedSec / 60))}
          currentStreak={0}
          estimatedMinutesLeft={estimatedMinutesLeft}
          setsCompleted={completedSets}
          {...CAMERA_CANCEL_COPY}
        />
      </SafeAreaView>
    );
  }

  // —— Live tracking ——
  const upNextStrip =
    nextExercise != null
      ? `${nextExercise.exercise_name} · ${nextExercise.sets}x${nextExercise.reps}`
      : "Workout complete";

  return (
    <SafeAreaView style={styles.safeDark} edges={["top", "left", "right"]}>
      <View style={styles.cameraShell}>
        {cameraActive ? (
          <MediaPipeGuidanceView
            key={`pose-${poseExerciseName}-${session.current_exercise_index}-${session.current_set}`}
            selectedExerciseName={poseExerciseName || currentExercise.exercise_name}
            isActive={cameraActive}
            sessionMode
            onReady={() => setCameraError(null)}
            onError={(m) => setCameraError(m)}
            onTrackingUpdate={handleTrackingUpdate}
          />
        ) : (
          <View style={styles.cameraPlaceholder}>
            <ActivityIndicator color="#fff" />
          </View>
        )}

        <View style={styles.hud} pointerEvents="box-none">
          {/* Row 1 — cancel · live pill · mute */}
          <View style={styles.topRow}>
            <Pressable
              style={styles.circleBtn}
              onPress={() => setShowEndSheet(true)}
              accessibilityLabel="Cancel session"
            >
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>

            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.livePillTxt}>{formatElapsed(elapsedSec)}</Text>
            </View>

            <Pressable
              style={styles.circleBtn}
              onPress={() => setAudioGuidanceEnabled(!session.audio_guidance_enabled)}
              accessibilityLabel="Toggle audio guidance"
            >
              <Ionicons
                name={session.audio_guidance_enabled ? "volume-high" : "volume-mute"}
                size={18}
                color="#fff"
              />
            </Pressable>
          </View>

          {/* Row 2 — single exercise label */}
          <Text style={styles.exLine} numberOfLines={1}>
            {currentExercise.exercise_name} · Set {session.current_set} of {currentExercise.sets}
          </Text>

          {/* Row 3 — exactly one status banner */}
          {liveStatus === "tracking_good" ? (
            <View key="status-good" style={[styles.statusPill, styles.statusGood]}>
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.statusTxt}>Good form</Text>
            </View>
          ) : liveStatus === "tracking_correction" ? (
            <View key="status-correction" style={[styles.statusPill, styles.statusAmber]}>
              <Ionicons name="alert-circle" size={16} color="#fff" />
              <Text style={styles.statusTxt} numberOfLines={1}>
                {liveCorrection}
              </Text>
            </View>
          ) : (
            <View key="status-nobody" style={[styles.statusPill, styles.statusAmber]}>
              <Ionicons name="warning" size={16} color="#fff" />
              <Text style={styles.statusTxt}>Step back into frame</Text>
            </View>
          )}

          {/* Rep counter — only while tracking */}
          {liveStatus !== "no_body" ? (
            <View key="reps" style={styles.repBlock}>
              <Text style={styles.repCount}>{session.current_rep_count}</Text>
              <Text style={styles.repTarget}>/ {currentExercise.reps} reps</Text>
            </View>
          ) : (
            <View style={styles.repSpacer} />
          )}

          <Pressable
            onPress={() => {
              setForceManual(true);
              setAiUiPhase("manual_fallback");
              Speech.stop();
            }}
          >
            <Text style={styles.manualLink}>Log this set manually</Text>
          </Pressable>

          <View style={styles.upNextDivider} />
          <View style={styles.upNextStrip}>
            <Text style={styles.upNextStripLbl}>Up next</Text>
            <Ionicons name="arrow-forward" size={12} color="rgba(255,255,255,0.7)" />
            <Text style={styles.upNextStripVal} numberOfLines={1}>
              {upNextStrip}
            </Text>
          </View>
        </View>
      </View>

      <EndEarlySheet
        visible={showEndSheet}
        onDismiss={() => setShowEndSheet(false)}
        onConfirmEnd={handleEndEarly}
        exercisesLeft={exercisesLeft}
        kcalSoFar={totalKcal}
        elapsedMinutes={Math.max(1, Math.floor(elapsedSec / 60))}
        currentStreak={0}
        estimatedMinutesLeft={estimatedMinutesLeft}
        setsCompleted={completedSets}
        {...CAMERA_CANCEL_COPY}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  safeCream: { flex: 1, backgroundColor: CREAM },
  safeDark: { flex: 1, backgroundColor: "#050b16" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { color: MUTED },
  cameraShell: { flex: 1 },
  cameraPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#050b16" },
  hud: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-start",
    padding: 16,
    paddingBottom: 20,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  livePillTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },
  exLine: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  statusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  statusGood: { backgroundColor: "rgba(15,110,86,0.92)" },
  statusAmber: { backgroundColor: "rgba(186,117,23,0.94)" },
  statusTxt: { color: "#fff", fontWeight: "700", fontSize: 13, flexShrink: 1 },
  repBlock: {
    marginTop: "auto",
    alignItems: "center",
    marginBottom: 12,
  },
  repSpacer: { flex: 1 },
  repCount: { color: "#fff", fontSize: 72, fontWeight: "800", lineHeight: 78 },
  repTarget: { color: "rgba(255,255,255,0.75)", fontSize: 16, fontWeight: "700" },
  manualLink: {
    textAlign: "center",
    color: "rgba(255,255,255,0.9)",
    textDecorationLine: "underline",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 12,
  },
  upNextDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.28)",
    marginBottom: 10,
  },
  upNextStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  upNextStripLbl: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "700",
  },
  upNextStripVal: {
    flex: 1,
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "700",
  },
  liveTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  liveDotRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  liveTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
  liveTimer: { color: "#fff", fontSize: 13, fontWeight: "800" },
  restHud: { backgroundColor: "rgba(5,11,22,0.35)" },
  restBodyOverlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  restBody: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 10 },
  restRingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    marginBottom: 4,
  },
  restAdjustBtn: {
    width: 56,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  restAdjustLbl: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700" },
  skipRestBtn: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.75)",
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
    marginBottom: 8,
  },
  skipRestTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  circleBtnPlaceholder: { width: 40, height: 40 },
  restTitle: { fontSize: 28, fontWeight: "800", color: TEXT },
  restSub: { color: MUTED, textAlign: "center", fontSize: 14, marginBottom: 8 },
  ringTime: {
    position: "absolute",
    fontSize: 28,
    fontWeight: "800",
    color: ORANGE,
  },
  checkpointWrap: { flex: 1, padding: 20, justifyContent: "center", gap: 10 },
  checkCircle: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  checkpointEyebrow: {
    textAlign: "center",
    color: GREEN_DARK,
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.4,
  },
  checkpointTitle: { textAlign: "center", fontSize: 24, fontWeight: "800", color: TEXT },
  statsRow: { flexDirection: "row", gap: 8, marginVertical: 8 },
  statPill: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },
  statVal: { fontWeight: "800", color: TEXT, fontSize: 14 },
  statLbl: { color: MUTED, fontSize: 11, marginTop: 2 },
  upNextCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 8,
  },
  upNextLbl: { fontSize: 11, fontWeight: "800", color: MUTED, letterSpacing: 0.4, marginBottom: 4 },
  upNextName: { fontSize: 16, fontWeight: "800", color: TEXT },
  upNextMeta: { fontSize: 12, color: MUTED, marginTop: 2 },
  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  primaryBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  autoCap: { textAlign: "center", color: MUTED, fontSize: 12, marginTop: 8 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  headerStatus: { color: MUTED, fontWeight: "700", fontSize: 13 },
  endLink: { color: GREEN, fontWeight: "800" },
  offBanner: {
    margin: 16,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },
  offTitle: { fontWeight: "800", color: TEXT, fontSize: 14 },
  offSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  exCard: {
    marginHorizontal: 16,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 16,
    padding: 14,
  },
  nowLbl: { fontSize: 11, fontWeight: "800", color: GREEN_DARK, letterSpacing: 0.4, marginBottom: 6 },
  exName: { fontSize: 20, fontWeight: "800", color: TEXT, marginBottom: 12 },
  manualRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  manualLbl: { color: MUTED, fontWeight: "700" },
  manualInput: {
    minWidth: 56,
    borderBottomWidth: 1.5,
    borderBottomColor: GREEN,
    color: TEXT,
    fontWeight: "800",
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 4,
  },
});
