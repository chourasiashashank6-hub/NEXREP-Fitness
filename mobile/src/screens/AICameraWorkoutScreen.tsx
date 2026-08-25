import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
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
import { fetchOnboardingMeShared } from "../api/onboarding";
import { getProfile } from "../api/user";
import { fetchWeightLatest } from "../api/weight";
import { EndEarlySheet } from "../components/EndEarlySheet";
import { SetWeightPrompt } from "../components/SetWeightPrompt";
import { useSetWeightAfterLog } from "../hooks/useSetWeightAfterLog";
import type { MediaPipeTrackingUpdate } from "../components/MediaPipeGuidanceView";
import { useCameraFlipLock } from "../hooks/useCameraFlipLock";
import { CameraWorkoutShell } from "../components/aiTrainer/CameraWorkoutShell";
import { AI_C } from "../components/aiTrainer/aiTrainerTokens";
import { getExerciseTrackingConfig } from "../constants/exerciseTrackingConfig";
import { scoreSetFromReps } from "../data/aiTrainer/formScore";
import {
  remapSpecWithCalibration,
  resolvePoseSpec,
} from "../data/aiTrainer/resolvePoseSpec";
import { hasTrackablePoseSpec } from "../data/aiTrainer/manualOnlyExercises";
import type { AiRepEvent } from "../data/aiTrainer/types";
import { usePoseCalibrationStore } from "../store/poseCalibrationStore";
import {
  sharedAudioCoach,
  speechLocaleForAppLang,
  unlockWebSpeech,
  isWebSpeechUnlocked,
  onWebSpeechUnlockChange,
  type CoachPriority,
  type VoiceMode,
} from "../services/aiTrainer/audioCoach";
import { scheduleRestEndNotification } from "../services/notificationService";
import { useTranslation } from "react-i18next";
import {
  type SessionExercise,
  useWorkoutSessionStore,
} from "../store/workoutSessionStore";
import type { RootStackParamList } from "../navigation/types";
import { navigationRef } from "../navigation/navigationRef";
import {
  calcActiveSetKcal,
  calcExerciseEstimateKcal,
} from "../utils/sessionCalories";
import { resolveMetForExercise } from "../utils/exerciseMetLookup";
import { resolveBurnTargetWeightKg } from "../utils/resolveBurnTargetWeightKg";
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

const CAMERA_CANCEL_COPY = {
  title: "Cancel this session?",
  body: "Camera stops and completed sets save to history. Today won't count toward your streak.",
  keepLabel: "Keep going",
  endLabel: "End session anyway",
} as const;

type LiveTrackingStatus = "tracking_good" | "tracking_correction" | "no_body";

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
  const { t, i18n } = useTranslation();
  const i18nLang = i18n.language;
  const needsCalBanner = usePoseCalibrationStore((s) => s.skipped && !s.hasCalibration());
  const needsRecalibration = usePoseCalibrationStore((s) => s.needsRecalibration);

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
  const cycleVoiceMode = useWorkoutSessionStore((s) => s.cycleVoiceMode);
  const recordRepVerdict = useWorkoutSessionStore((s) => s.recordRepVerdict);
  const markExerciseCheckpoint = useWorkoutSessionStore((s) => s.markExerciseCheckpoint);
  const clearExerciseCheckpoint = useWorkoutSessionStore((s) => s.clearExerciseCheckpoint);
  const poseCalibration = usePoseCalibrationStore((s) => s.calibration);

  const [, tick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userWeightKg, setUserWeightKg] = useState(70);
  const [manualReps, setManualReps] = useState("");
  const [setStartedAt, setSetStartedAt] = useState(() => new Date());
  const [pausedAccumMs, setPausedAccumMs] = useState(0);
  const [showEndSheet, setShowEndSheet] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [forceManual, setForceManual] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveTrackingStatus>("no_body");
  const [liveCorrection, setLiveCorrection] = useState("Step back into frame");
  const [sessionPaused, setSessionPaused] = useState(false);
  const [countingPaused, setCountingPaused] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [liveRom01, setLiveRom01] = useState(0);
  const [liveInZone, setLiveInZone] = useState(false);
  const [zoneStart01, setZoneStart01] = useState(0.74);
  const [zoneEnd01, setZoneEnd01] = useState(0.96);
  const [orientationOk, setOrientationOk] = useState(true);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [webAudioReady, setWebAudioReady] = useState(() =>
    Platform.OS !== "web" ? true : isWebSpeechUnlocked(),
  );
  const [bannerCue, setBannerCue] = useState<{
    text: string;
    priority: CoachPriority | "idle";
  } | null>(null);
  const pauseStartedAt = useRef<number | null>(null);
  const flipStabilizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { flipInProgress, requestFlip, finishFlip } = useCameraFlipLock();
  const setRepEvents = useRef<AiRepEvent[]>([]);
  const lastSpokenCueRef = useRef<string | null>(null);
  const pausedForCalibrate = useRef(false);
  const bootstrapped = useRef(false);
  const completingRef = useRef(false);
  const restFinishLock = useRef(false);
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { weightPrompt, afterSetLogged, confirmSetWeight, skipSetWeight } =
    useSetWeightAfterLog(userWeightKg);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Reset set-local live state whenever rep tracking resets for a new set.
  useEffect(() => {
    if (!session) return;
    if (session.current_rep_count === 0) {
      setRepEvents.current = [];
      setSessionPaused(false);
      setCountingPaused(false);
      setPausedAccumMs(0);
      pauseStartedAt.current = null;
      setLiveRom01(0);
      setLiveInZone(false);
      setBannerCue(null);
    }
  }, [session?.current_rep_count, session?.current_set, session?.current_exercise_index]);

  // Sync TTS queue with voice mode + app locale.
  useEffect(() => {
    const mode = (session?.voice_mode || "full") as VoiceMode;
    sharedAudioCoach.configure({
      voiceMode: mode,
      lang: speechLocaleForAppLang(i18nLang),
    });
  }, [session?.voice_mode, i18nLang]);

  useEffect(() => {
    const unsub = sharedAudioCoach.onSpeakingChange((speaking, cueKey, priority) => {
      setTtsSpeaking(speaking);
      if (cueKey && priority) {
        const text = t(`aiTrainer.${cueKey}`, {
          defaultValue: t(cueKey, { defaultValue: cueKey.replace(/^cue_/, "").replace(/_/g, " ") }),
        });
        setBannerCue({ text: String(text), priority });
      }
    });
    return () => {
      unsub();
    };
  }, [t]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    setWebAudioReady(isWebSpeechUnlocked());
    return onWebSpeechUnlockChange(setWebAudioReady);
  }, []);

  useEffect(() => {
    Promise.all([getProfile(), fetchWeightLatest(), fetchOnboardingMeShared()])
      .then(([profile, weightLatest, onboardingRes]) => {
        const profileWeightKg = Number(profile?.weight ?? profile?.weight_kg);
        const kg = resolveBurnTargetWeightKg({
          weightLatest,
          profileWeightKg: Number.isFinite(profileWeightKg) && profileWeightKg > 0 ? profileWeightKg : undefined,
          onboardingWeightKg: onboardingRes?.onboarding?.personal?.weight_kg,
        });
        setUserWeightKg(kg);
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
          met_value: resolveMetForExercise(ex.name),
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
  // Part 0: only the 71 poseSpec exercises get full AI tracking; others → manual fallback
  const trackable = Boolean(
    currentExercise && hasTrackablePoseSpec(currentExercise.exercise_name) && trackingConfig,
  );
  const poseExerciseName =
    trackingConfig?.mediaPipeName || currentExercise?.exercise_name || "";
  const calibrationPayload = useMemo(
    () => usePoseCalibrationStore.getState().effectiveCalibration(),
    [poseCalibration, needsCalBanner],
  );
  const livePoseSpec = useMemo(() => {
    const raw = resolvePoseSpec(poseExerciseName || currentExercise?.exercise_name);
    if (!raw) return null;
    return remapSpecWithCalibration(raw, calibrationPayload);
  }, [poseExerciseName, currentExercise?.exercise_name, calibrationPayload]);
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
      if (pausedForCalibrate.current) {
        pausedForCalibrate.current = false;
        if (pauseStartedAt.current != null) {
          setPausedAccumMs((ms) => ms + (Date.now() - pauseStartedAt.current!));
          pauseStartedAt.current = null;
        }
        setSessionPaused(false);
        setCountingPaused(false);
      }

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
    const calStore = usePoseCalibrationStore.getState();
    const formScores = s.set_logs
      .map((l) => l.form_quality_pct)
      .filter((n): n is number => typeof n === "number");
    const formAvg =
      formScores.length > 0
        ? Math.round((formScores.reduce((a, b) => a + b, 0) / formScores.length) * 10) / 10
        : null;
    return {
      session_id: s.session_id,
      plan_day_id: s.plan_day_id,
      started_at: s.started_at,
      ended_at: new Date().toISOString(),
      status,
      set_logs: s.set_logs.map(
        ({
          exercise_name,
          set_number,
          reps,
          weight_kg,
          started_at,
          completed_at,
          tracking_method,
          prescribed_reps,
          rest_seconds,
        }) => ({
          exercise_name,
          set_number,
          reps,
          weight_kg,
          started_at,
          completed_at,
          tracking_method: tracking_method ?? "manual",
          prescribed_reps,
          rest_seconds,
        }),
      ),
      user_weight_kg: userWeightKg,
      ai_tracking: {
        calibrated: calStore.hasCalibration(),
        used_population_defaults: !calStore.hasCalibration(),
        sets: [],
        issues_histogram: {},
        form_score_avg: formAvg,
      },
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
  }) => {
    if (!session || !currentExercise || completingRef.current) return;
    completingRef.current = true;
    const now = new Date();
    const pauseExtra =
      pausedAccumMs + (pauseStartedAt.current != null ? now.getTime() - pauseStartedAt.current : 0);
    const workSec = Math.max(
      1,
      Math.floor((now.getTime() - setStartedAt.getTime() - pauseExtra) / 1000),
    );
    const reps = opts.reps;
    const prescribedReps = parseReps(currentExercise.reps);
    const setNumber = session.current_set;
    const kcal = calcActiveSetKcal({
      exerciseName: currentExercise.exercise_name,
      userWeightKg,
      workSec,
      restSec: currentExercise.rest_seconds,
      reps,
      prescribedReps,
    });
    const quality =
      opts.method === "ai_camera"
        ? Math.round(session.live_form_score)
        : null;

    logSet({
      exercise_name: currentExercise.exercise_name,
      reps,
      weight_kg: null,
      started_at: setStartedAt.toISOString(),
      completed_at: now.toISOString(),
      kcal,
      tracking_method: opts.method,
      prescribed_reps: prescribedReps,
      rest_seconds: currentExercise.rest_seconds,
      form_quality_pct: quality,
    });

    const isLastSet = session.current_set >= currentExercise.sets;
    const isLastExercise = session.current_exercise_index >= session.exercises.length - 1;

    setForceManual(false);
    resetRepTracking();
    setLiveStatus("no_body");

    const proceedAfterWeight = () => {
      if (!isLastSet) {
        completingRef.current = false;
        return;
      }
      if (!isLastExercise) {
        markExerciseCheckpoint();
        completingRef.current = false;
        return;
      }
      const latest = useWorkoutSessionStore.getState().session;
      const latestKcal = latest?.set_logs.reduce((s, l) => s + l.kcal, 0) ?? 0;
      const latestVolume = latest?.set_logs.reduce((s, l) => s + l.reps * (l.weight_kg ?? 0), 0) ?? 0;
      void finishWorkout(latestKcal, latestVolume);
    };

    if (!isLastSet) {
      beginRest(currentExercise.rest_seconds);
      void scheduleRestEndNotification(
        new Date(Date.now() + currentExercise.rest_seconds * 1000),
        `Set ${session.current_set + 1} of ${currentExercise.sets} — ${currentExercise.exercise_name}`,
      );
    }

    const logsAfter = useWorkoutSessionStore.getState().session?.set_logs ?? [];
    await afterSetLogged(
      {
        exercise_name: currentExercise.exercise_name,
        set_number: setNumber,
        reps,
        workSec,
        restSec: currentExercise.rest_seconds,
        prescribedReps,
        tracking_method: opts.method,
        started_at: setStartedAt.toISOString(),
        completed_at: now.toISOString(),
        form_quality_pct: quality,
      },
      { showRest: !isLastSet, onDone: proceedAfterWeight, setLogs: logsAfter },
    );
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

  const handleTrackingUpdate = useCallback(
    (update: MediaPipeTrackingUpdate) => {
      const s = useWorkoutSessionStore.getState().session;
      if (!s || s.ai_ui_phase !== "tracking" || s.status !== "active") return;
      if (sessionPaused) return;
      const ex = s.exercises[s.current_exercise_index];
      if (!ex) return;

      if (update.rom01 != null) setLiveRom01(update.rom01);
      if (update.zoneStart01 != null) setZoneStart01(update.zoneStart01);
      if (update.zoneEnd01 != null) setZoneEnd01(update.zoneEnd01);
      if (update.inDepthZone != null) setLiveInZone(update.inDepthZone);
      setOrientationOk(update.orientationOk !== false);

      if (!update.bodyDetected) {
        setLiveStatus("no_body");
        setLiveCorrection(t("aiTrainer.step_into_frame", { defaultValue: "Step back into frame" }));
        return;
      }

      if (update.reps !== s.current_rep_count) {
        setCurrentRepCount(update.reps);
        sharedAudioCoach.setRepIndex(update.reps);
      }

      if (update.repCompleted && update.repVerdict) {
        const failed = update.failedChecksThisRep || [];
        const event: AiRepEvent = {
          repIndex: update.reps,
          verdict: update.repVerdict,
          failedChecks: failed,
          tempo: { eccentricSec: 0, concentricSec: 0 },
          peakAngles: update.primaryAngle != null ? { primary: update.primaryAngle } : {},
        };
        setRepEvents.current = [...setRepEvents.current, event];
        const sev: Record<string, "critical" | "minor"> = {};
        for (const c of livePoseSpec?.checks || []) sev[c.id] = c.severity;
        const score = scoreSetFromReps(setRepEvents.current, sev);
        recordRepVerdict(update.repVerdict, score);
        if (update.repVerdict === "clean") {
          sharedAudioCoach.speakKey("cue_clean_rep", "encouragement", "encourage_clean", update.reps);
        }
      }

      updateFormTracking(
        update.formOk && update.orientationOk !== false ? "good" : "correction",
        update.cueKey || update.correction || null,
      );

      if (update.orientationOk === false) {
        setLiveStatus("tracking_correction");
        const orientKey =
          update.requiredView === "side" ? "cue_turn_side" : "cue_turn_front";
        const orientText = t(`aiTrainer.${orientKey}`, {
          defaultValue: update.requiredView === "side" ? "Turn to your side" : "Face the camera",
        });
        setLiveCorrection(String(orientText));
        setBannerCue({ text: String(orientText), priority: "safety" });
        if (lastSpokenCueRef.current !== orientKey) {
          lastSpokenCueRef.current = orientKey;
          sharedAudioCoach.speakKey(orientKey, "safety", orientKey, update.reps);
        }
      } else if (update.cueKey) {
        setLiveStatus("tracking_correction");
        const cueText = t(`aiTrainer.${update.cueKey}`, {
          defaultValue: update.cueKey.replace(/^cue_/, "").replace(/_/g, " "),
        });
        setLiveCorrection(String(cueText));
        if (!ttsSpeaking) {
          setBannerCue({ text: String(cueText), priority: update.cuePriority || "correction" });
        }
        const speakId = `${update.cueKey}:${update.reps}`;
        if (lastSpokenCueRef.current !== speakId) {
          lastSpokenCueRef.current = speakId;
          sharedAudioCoach.speakKey(
            update.cueKey,
            update.cuePriority === "safety" ? "safety" : "correction",
            update.cueKey,
            update.reps,
          );
        }
      } else if (update.formOk) {
        setLiveStatus("tracking_good");
        setLiveCorrection(t("aiTrainer.clean_rep", { defaultValue: "Clean rep — great form" }));
        lastSpokenCueRef.current = null;
      }

      if (update.reps >= ex.reps && !completingRef.current) {
        void completeCurrentSet({ reps: update.reps, method: "ai_camera" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionPaused, setCurrentRepCount, updateFormTracking, recordRepVerdict, t, ttsSpeaking, livePoseSpec],
  );

  const handlePauseToggle = useCallback(() => {
    if (Platform.OS === "web") unlockWebSpeech();
    if (sessionPaused) {
      if (pauseStartedAt.current != null) {
        setPausedAccumMs((ms) => ms + (Date.now() - pauseStartedAt.current!));
        pauseStartedAt.current = null;
      }
      setSessionPaused(false);
      setCountingPaused(false);
      return;
    }
    pauseStartedAt.current = Date.now();
    setSessionPaused(true);
    setCountingPaused(true);
    sharedAudioCoach.clear();
  }, [sessionPaused]);

  const handleFlipCam = useCallback(() => {
    if (!requestFlip(setFacingMode)) return;
    setCountingPaused(true);
    if (flipStabilizeTimer.current) clearTimeout(flipStabilizeTimer.current);
    flipStabilizeTimer.current = setTimeout(() => {
      if (!sessionPaused) setCountingPaused(false);
      flipStabilizeTimer.current = null;
    }, 800);
  }, [requestFlip, sessionPaused]);

  const handleCameraFlipped = useCallback(
    (facing: "user" | "environment") => {
      const synced = finishFlip(facing);
      if (synced) setFacingMode(synced);
      if (flipStabilizeTimer.current) {
        clearTimeout(flipStabilizeTimer.current);
        flipStabilizeTimer.current = null;
      }
      if (!sessionPaused) setCountingPaused(false);
    },
    [finishFlip, sessionPaused],
  );

  const handleZoomIn = useCallback(() => {
    setZoomLevel((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100));
  }, []);

  const handleCalibratePress = useCallback(() => {
    pauseStartedAt.current = Date.now();
    pausedForCalibrate.current = true;
    setSessionPaused(true);
    setCountingPaused(true);
    sharedAudioCoach.clear();
    navigationRef.navigate("AITrainerCalibration" as never, { planId } as never);
  }, [planId]);

  const handleManualSetDone = () => {
    if (!currentExercise) return;
    const repsRaw = manualReps.trim() ? Number(manualReps) : currentExercise.reps;
    const reps = Number.isFinite(repsRaw) && repsRaw > 0 ? Math.round(repsRaw) : parseReps(currentExercise.reps);
    void completeCurrentSet({
      reps,
      method: "manual",
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

  const weightPromptNode = (
    <SetWeightPrompt
      visible={weightPrompt != null}
      exerciseName={weightPrompt?.exercise_name ?? ""}
      setNumber={weightPrompt?.set_number ?? 1}
      prefillKg={weightPrompt?.prefillKg ?? null}
      showRestTimer={weightPrompt?.showRest ?? false}
      restRemainingSec={restRemainingSec}
      restTotalSec={restTotalSec}
      onConfirm={confirmSetWeight}
      onSkip={skipSetWeight}
    />
  );

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
      <SafeAreaView style={styles.safeCream} edges={["top"]}>
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
        {weightPromptNode}
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
      <SafeAreaView style={styles.safeDark} edges={["top"]}>
        <View style={styles.cameraShell}>
          {trackable ? (
            <CameraWorkoutShell
              exerciseName={poseExerciseName || currentExercise.exercise_name}
              exerciseSubtitle={`Set ${session.current_set} of ${currentExercise.sets} · Rest`}
              targetReps={parseReps(currentExercise.reps)}
              poseSpec={livePoseSpec}
              calibration={calibrationPayload}
              isActive
              countingPaused
              sessionPaused
              seedRepCount={session.current_rep_count}
              facingMode={facingMode}
              repCount={session.current_rep_count}
              formScore={Math.round(session.live_form_score ?? 100)}
              verdicts={session.live_rep_verdicts || []}
              liveRom01={liveRom01}
              liveInZone={liveInZone}
              zoneStart01={zoneStart01}
              zoneEnd01={zoneEnd01}
              orientationOk={orientationOk}
              liveStatus={liveStatus}
              coachText={t("aiTrainer.rest_camera_on", {
                defaultValue: "Camera stays on — next set starts automatically",
              })}
              coachWarn={false}
              hideBottomControls
              onClose={() => setShowEndSheet(true)}
              onTrackingUpdate={() => undefined}
              onReady={() => setCameraError(null)}
              onError={(m) => setCameraError(m)}
              overlay={
                <View style={[styles.hud, styles.restHud]} pointerEvents="box-none">
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
              }
            />
          ) : (
            <View style={styles.cameraPlaceholder} />
          )}
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
        {weightPromptNode}
      </SafeAreaView>
    );
  }

  // —— Manual fallback (camera fully unmounted) ——
  if (phase === "manual_fallback" || !trackable || forceManual) {
    return (
      <SafeAreaView style={styles.safeCream} edges={["top"]}>
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
              Manual logging only — camera tracking isn’t available for this exercise
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
        {weightPromptNode}
      </SafeAreaView>
    );
  }

  // —— Live tracking ——
  const formScore = Math.round(session.live_form_score ?? 100);
  const verdicts = session.live_rep_verdicts || [];
  const voiceMode = (session.voice_mode || "full") as VoiceMode;
  const coachWarn =
    bannerCue?.priority === "correction" ||
    bannerCue?.priority === "safety" ||
    liveStatus === "no_body" ||
    !orientationOk;
  const coachText =
    bannerCue?.text ||
    liveCorrection ||
    t("aiTrainer.tracking_ready", { defaultValue: "Tracking locked — start when ready" });
  const trackingRunning = cameraActive && !sessionPaused && !countingPaused;

  return (
    <SafeAreaView style={styles.safeDark} edges={["top"]}>
      <View style={styles.cameraShell}>
        {cameraActive ? (
          <CameraWorkoutShell
            key={`pose-${poseExerciseName}-${session.current_exercise_index}-${session.current_set}`}
            exerciseName={poseExerciseName || currentExercise.exercise_name}
            exerciseSubtitle={`Set ${session.current_set} of ${currentExercise.sets} · ${session.day_name}`}
            targetReps={parseReps(currentExercise.reps)}
            poseSpec={livePoseSpec}
            calibration={calibrationPayload}
            isActive
            countingPaused={countingPaused || sessionPaused}
            sessionPaused={sessionPaused}
            seedRepCount={session.current_rep_count}
            facingMode={facingMode}
            repCount={session.current_rep_count}
            formScore={formScore}
            verdicts={verdicts}
            liveRom01={liveRom01}
            liveInZone={liveInZone}
            zoneStart01={zoneStart01}
            zoneEnd01={zoneEnd01}
            orientationOk={orientationOk}
            liveStatus={liveStatus}
            coachText={coachText}
            coachWarn={coachWarn}
            ttsSpeaking={ttsSpeaking}
            trackingRunning={trackingRunning}
            voiceMode={voiceMode}
            cameraError={cameraError}
            showCalibrateBanner={needsCalBanner || needsRecalibration}
            webAudioReady={webAudioReady}
            onClose={() => setShowEndSheet(true)}
            onCalibrate={handleCalibratePress}
            onPauseToggle={handlePauseToggle}
            onVoiceModeCycle={() => {
              if (Platform.OS === "web") unlockWebSpeech();
              cycleVoiceMode();
            }}
            onFlipCam={handleFlipCam}
            flipDisabled={flipInProgress}
            onCameraFlipped={handleCameraFlipped}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            zoomLevel={zoomLevel}
            onTrackingUpdate={handleTrackingUpdate}
            onReady={() => setCameraError(null)}
            onError={(m) => setCameraError(m)}
          />
        ) : (
          <View style={styles.cameraPlaceholder}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
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
      {weightPromptNode}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  safeCream: { flex: 1, backgroundColor: CREAM },
  safeDark: { flex: 1, backgroundColor: AI_C.bg },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { color: MUTED },
  cameraShell: { flex: 1 },
  cameraPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: AI_C.bg },
  cameraErrorBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "42%",
    zIndex: 30,
    backgroundColor: "rgba(127,29,29,0.92)",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.5)",
  },
  cameraErrorTxt: { color: "#fecaca", fontWeight: "700", textAlign: "center", fontSize: 15 },
  hud: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-start",
    padding: 14,
    paddingBottom: 12,
  },
  calBanner: {
    alignSelf: "center",
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.55)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    marginBottom: 10,
  },
  calBannerTxt: { color: AI_C.txt, fontWeight: "700", fontSize: 13 },
  liveTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  topGlass: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
  },
  livePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AI_C.mint,
    shadowColor: AI_C.mint,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  livePulseIdle: {
    backgroundColor: AI_C.dim,
    shadowOpacity: 0,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,11,22,0.72)",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    zIndex: 20,
  },
  pauseTitle: { color: AI_C.txt, fontSize: 28, fontWeight: "800" },
  pauseSub: { color: AI_C.dim, fontSize: 14, marginBottom: 8 },
  resumeBtn: {
    backgroundColor: AI_C.mint,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  resumeBtnTxt: { color: "#042f2e", fontWeight: "800", fontSize: 16 },
  orientOverlay: {
    alignSelf: "center",
    marginTop: 8,
    backgroundColor: "rgba(255,122,69,0.18)",
    borderColor: "rgba(255,122,69,0.55)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "92%",
  },
  orientTxt: { color: AI_C.orange, fontWeight: "700", textAlign: "center", fontSize: 14 },
  testAudioBtn: {
    alignSelf: "center",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: AI_C.line,
  },
  testAudioTxt: { color: AI_C.dim, fontWeight: "700", fontSize: 12 },
  enableAudioBanner: {
    alignSelf: "center",
    marginBottom: 8,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(139,92,246,0.92)",
    borderWidth: 1,
    borderColor: AI_C.purple,
    maxWidth: "94%",
  },
  enableAudioTxt: { color: "#fff", fontWeight: "700", fontSize: 13, textAlign: "center" },
  topCopy: { flex: 1, minWidth: 0 },
  topExName: { color: AI_C.txt, fontSize: 15, fontWeight: "700" },
  topExSub: { color: AI_C.dim, fontSize: 11, marginTop: 2 },
  coachOn: { alignItems: "flex-end", gap: 4 },
  coachOnLbl: { color: AI_C.purple, fontSize: 10, fontWeight: "700" },
  closeGlass: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: AI_C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  closeX: { color: AI_C.dim, fontSize: 16, fontWeight: "600" },
  leftCol: {
    position: "absolute",
    top: 88,
    left: 14,
    gap: 8,
    zIndex: 2,
  },
  repCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: "center",
    minWidth: 92,
  },
  repBig: { color: AI_C.txt, fontSize: 40, fontWeight: "700", lineHeight: 42 },
  repSlash: { fontSize: 16, color: AI_C.dim, fontWeight: "600" },
  cleanLbl: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: AI_C.mint,
    fontWeight: "700",
    marginTop: 4,
  },
  cleanSub: { fontSize: 10, color: AI_C.dim, marginTop: 2 },
  scoreCard: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: "center",
  },
  scoreBig: { fontSize: 22, fontWeight: "700" },
  scoreLbl: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: AI_C.dim,
    fontWeight: "600",
    marginTop: 2,
  },
  depthCol: {
    position: "absolute",
    top: 96,
    right: 16,
    bottom: 170,
    width: 34,
    zIndex: 2,
  },
  dotsRow: {
    position: "absolute",
    bottom: 128,
    left: 14,
    right: 60,
    flexDirection: "row",
    gap: 5,
    zIndex: 2,
  },
  dot: { width: 14, height: 5, borderRadius: 3 },
  coachBanner: {
    position: "absolute",
    bottom: 62,
    left: 14,
    right: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    zIndex: 3,
  },
  coachIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  coachKicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "700" },
  coachBody: { color: AI_C.txt, fontSize: 13.5, fontWeight: "500", marginTop: 2 },
  bottomControls: {
    position: "absolute",
    bottom: 12,
    left: 14,
    right: 14,
    flexDirection: "row",
    gap: 8,
    zIndex: 3,
  },
  ctrlBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: AI_C.line,
  },
  ctrlBtnActive: { borderColor: "rgba(139,92,246,0.5)" },
  ctrlTxt: { color: AI_C.dim, fontSize: 12, fontWeight: "600" },
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
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: AI_C.mint },
  livePillTxt: { color: "#fff", fontSize: 13, fontWeight: "800" },
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
