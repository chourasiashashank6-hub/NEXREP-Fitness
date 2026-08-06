import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { WebView as WebViewType } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { usePoseCalibrationStore } from "../../store/poseCalibrationStore";
import type { RootStackParamList } from "../../navigation/types";
import { useTranslation } from "react-i18next";
import { unlockWebSpeech } from "../../services/aiTrainer/audioCoach";
import {
  buildInjectedCalibrationScript,
  type CalibrationStepId,
} from "../../services/aiTrainer/mediaPipeCalibrationTemplate";
import {
  type CameraDiagnosticsPayload,
  logCameraDiagnostics,
} from "../../services/aiTrainer/webviewCameraControls";
import {
  finalizeCalibration,
  mergeCalibrationStep,
  type CalibrationStepPartial,
} from "../../utils/calibrationMerge";
import type { PoseCalibration } from "../../data/aiTrainer/types";
import {
  acquireMediaPipeServer,
  MEDIAPIPE_CALIBRATION_PAGE,
  releaseMediaPipeServer,
} from "../../services/aiTrainer/mediaPipeLocalServer";
import {
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_STEP,
  formatCameraZoom,
} from "../../services/aiTrainer/webviewCameraControls";
import { CalibrationPoseDemo } from "../../components/aiTrainer/CalibrationPoseDemo";
import { GlassPanel } from "../../components/aiTrainer/GlassPanel";
import { AI_C } from "../../components/aiTrainer/aiTrainerTokens";

const DEMO_SEC = 3;
const TPOSE_HOLD_SEC = 3;

type Props = NativeStackScreenProps<RootStackParamList, "AITrainerCalibration">;

const STEPS = [
  { id: "tpose" as const, durationSec: 10, labelKey: "cal_step_tpose", labelDefault: "T-pose" },
  { id: "squats" as const, durationSec: 20, labelKey: "cal_step_squats", labelDefault: "Squats" },
  { id: "turn" as const, durationSec: 8, labelKey: "cal_step_turn", labelDefault: "Turn" },
] as const;

type CalProgressState = {
  gatePassed: boolean;
  phase: string;
  statusText?: string;
  holdProgress?: number;
  squatReps?: number;
  depthDeg?: number;
  turnProgress?: number;
  gateProgress?: number;
};

function buildSummaryItems(cal: PoseCalibration): { label: string; value: string }[] {
  const standing = Math.round(cal.standingKneeDeg ?? 168);
  const squatDepth = Math.round(cal.squatDepthDeg ?? cal.mobility.depthTargetDeg ?? 95);
  const depthTarget = Math.round(cal.mobility.depthTargetDeg);
  const rom = Math.max(0, standing - squatDepth);
  const lean = Math.round(cal.torsoLeanBaselineDeg ?? 8);
  const asym = cal.asymmetryFlags?.length
    ? "Slight left/right difference noted"
    : "Balanced left and right";
  return [
    {
      label: "Standing posture",
      value: `Legs near ${standing}° when upright`,
    },
    {
      label: "Squat depth",
      value: `You reached ~${squatDepth}° at your deepest squat (${rom}° range)`,
    },
    {
      label: "Coaching target",
      value: `Reps will count depth near ${depthTarget}° for your body`,
    },
    {
      label: "Torso baseline",
      value: `Typical lean ~${lean}° when standing`,
    },
    {
      label: "Symmetry",
      value: asym,
    },
  ];
}

export default function AITrainerCalibrationScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const planId = route.params?.planId;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [serverUri, setServerUri] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [stepReady, setStepReady] = useState(false);
  const [calProgress, setCalProgress] = useState<CalProgressState>({
    gatePassed: false,
    phase: "seek_pose",
  });
  const [summaryCal, setSummaryCal] = useState<PoseCalibration | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [zoomLevel, setZoomLevel] = useState(CAMERA_ZOOM_MIN);
  const [demoActive, setDemoActive] = useState(true);
  const [demoSecLeft, setDemoSecLeft] = useState(DEMO_SEC);
  const [countdownSec, setCountdownSec] = useState(STEPS[0].durationSec);
  const webViewRef = useRef<WebViewType>(null);
  const webReadyRef = useRef(false);
  const skipFlipInjectRef = useRef(true);
  const skipZoomInjectRef = useRef(true);
  const demoActiveRef = useRef(true);
  const partialRef = useRef<CalibrationStepPartial>({});
  const stepRef = useRef(step);
  stepRef.current = step;
  const setCalibration = usePoseCalibrationStore((s) => s.setCalibration);
  const skipCalibration = usePoseCalibrationStore((s) => s.skipCalibration);

  const stepId: CalibrationStepId = STEPS[step]?.id || "tpose";
  const stepMeta = STEPS[step];
  const summaryItems = useMemo(
    () => (summaryCal ? buildSummaryItems(summaryCal) : []),
    [summaryCal],
  );

  useEffect(() => {
    setStepReady(false);
    setCalProgress({ gatePassed: false, phase: "seek_pose" });
    webReadyRef.current = false;
    skipFlipInjectRef.current = true;
    skipZoomInjectRef.current = true;
    setDemoActive(true);
    demoActiveRef.current = true;
    setDemoSecLeft(DEMO_SEC);
    setCountdownSec(STEPS[step]?.durationSec ?? 10);
    const tick = setInterval(() => {
      setDemoSecLeft((s) => Math.max(0, s - 1));
    }, 1000);
    const end = setTimeout(() => {
      demoActiveRef.current = false;
      setDemoActive(false);
      webViewRef.current?.injectJavaScript(
        "if(window.__calResumeCapture){window.__calResumeCapture();}true;",
      );
    }, DEMO_SEC * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(end);
    };
  }, [step]);

  useEffect(() => {
    if (demoActive) return;
    setCountdownSec(stepMeta.durationSec);
    const tick = setInterval(() => {
      setCountdownSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [step, demoActive, stepMeta.durationSec]);

  useEffect(() => {
    if (!webReadyRef.current) return;
    if (skipFlipInjectRef.current) {
      skipFlipInjectRef.current = false;
      return;
    }
    webViewRef.current?.injectJavaScript(
      `if(window.__mpFlipCamera){window.__mpFlipCamera(${JSON.stringify(facingMode)});}true;`,
    );
  }, [facingMode]);

  useEffect(() => {
    if (!webReadyRef.current) return;
    if (skipZoomInjectRef.current) {
      skipZoomInjectRef.current = false;
      return;
    }
    webViewRef.current?.injectJavaScript(
      `if(window.__mpSetZoom){window.__mpSetZoom(${zoomLevel});}true;`,
    );
  }, [zoomLevel]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    setServerUri(null);
    setServerError(null);
    acquireMediaPipeServer(MEDIAPIPE_CALIBRATION_PAGE)
      .then((uri) => {
        if (!cancelled) setServerUri(uri);
      })
      .catch((err) => {
        if (!cancelled) {
          setServerError(err instanceof Error ? err.message : "Camera server failed to start.");
        }
      });
    return () => {
      cancelled = true;
      releaseMediaPipeServer();
    };
  }, []);

  const continueToSession = useCallback(() => {
    if (Platform.OS === "web") unlockWebSpeech();
    if (planId != null) {
      navigation.replace("AICameraWorkoutSession", { planId });
    } else {
      navigation.goBack();
    }
  }, [navigation, planId]);

  const onMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      const raw = event.nativeEvent.data || "";
      try {
        const parsed = JSON.parse(raw) as {
          type?: string;
          calibration?: PoseCalibration;
          step?: string;
          source?: string;
          msg?: string;
          phase?: string;
          gatePassed?: boolean;
          holdProgress?: number;
          squatReps?: number;
          depthDeg?: number;
          turnProgress?: number;
          gateProgress?: number;
          statusText?: string;
        };

        if (parsed.type === "cameraDiagnostics") {
          logCameraDiagnostics(parsed as CameraDiagnosticsPayload);
          return;
        }

        if (parsed.type === "ready") {
          webReadyRef.current = true;
          if (demoActiveRef.current) {
            webViewRef.current?.injectJavaScript(
              "if(window.__calPauseCapture){window.__calPauseCapture();}true;",
            );
          } else {
            webViewRef.current?.injectJavaScript(
              "if(window.__calResumeCapture){window.__calResumeCapture();}true;",
            );
          }
          return;
        }

        if (parsed.type === "calProgress") {
          setCalProgress({
            gatePassed: parsed.gatePassed === true,
            phase: String(parsed.phase || "seek_pose"),
            statusText: parsed.statusText,
            holdProgress: parsed.holdProgress,
            squatReps: parsed.squatReps,
            depthDeg: parsed.depthDeg,
            turnProgress: parsed.turnProgress,
            gateProgress: parsed.gateProgress,
          });
          return;
        }

        if (parsed.type === "stepReady") {
          const readyStep = parsed.step as CalibrationStepId | undefined;
          if (readyStep === STEPS[stepRef.current]?.id) {
            setStepReady(true);
          }
          return;
        }

        if (parsed.type !== "stepComplete" || !parsed.calibration) return;

        const incomingStep = parsed.step as CalibrationStepId | undefined;
        const expectedStepId = STEPS[stepRef.current]?.id;
        if (!incomingStep || !expectedStepId || incomingStep !== expectedStepId) return;

        const cal = parsed.calibration as CalibrationStepPartial;
        partialRef.current = mergeCalibrationStep(partialRef.current, incomingStep, cal);

        if (stepRef.current < STEPS.length - 1) {
          setStep((s) => s + 1);
          return;
        }
        if (incomingStep !== "turn") return;

        const finalCal = finalizeCalibration(partialRef.current);
        setSummaryCal(finalCal);
      } catch (err) {
        if (__DEV__) {
          console.warn("[Calibration] WebView message parse error:", err);
        }
      }
    },
    [],
  );

  const onContinueStep = () => {
    if (!stepReady || busy) return;
    webViewRef.current?.injectJavaScript(
      "if(window.__calFinishNow){window.__calFinishNow();}true;",
    );
  };

  const onSummaryDone = async () => {
    if (!summaryCal) return;
    setBusy(true);
    await setCalibration(summaryCal);
    setBusy(false);
    continueToSession();
  };

  const onRecalibrate = () => {
    partialRef.current = {};
    setSummaryCal(null);
    setStep(0);
    setStepReady(false);
    setFacingMode("user");
    setZoomLevel(CAMERA_ZOOM_MIN);
    setCalProgress({ gatePassed: false, phase: "seek_pose" });
  };

  const handleFlipCam = () => {
    setFacingMode((f) => (f === "user" ? "environment" : "user"));
  };

  const handleZoomIn = () => {
    setZoomLevel((z) =>
      Math.min(CAMERA_ZOOM_MAX, Math.round((z + CAMERA_ZOOM_STEP) * 100) / 100),
    );
  };

  const handleZoomOut = () => {
    setZoomLevel((z) =>
      Math.max(CAMERA_ZOOM_MIN, Math.round((z - CAMERA_ZOOM_STEP) * 100) / 100),
    );
  };

  const onSkip = () => {
    if (Platform.OS === "web") unlockWebSpeech();
    skipCalibration();
    continueToSession();
  };

  const stepName = t(stepMeta.labelKey, { defaultValue: stepMeta.labelDefault });

  const statusPillText = useMemo(() => {
    if (stepReady) {
      return t("aiTrainer.cal_capture_done", { defaultValue: "Capture complete — tap to continue" });
    }
    if (!calProgress.gatePassed) {
      return t("aiTrainer.cal_get_position", { defaultValue: "Get into position…" });
    }
    if (stepId === "tpose" && calProgress.holdProgress != null) {
      const secLeft = Math.max(1, Math.ceil((1 - calProgress.holdProgress) * TPOSE_HOLD_SEC));
      return t("aiTrainer.cal_hold_tpose_sec", {
        defaultValue: "Hold your T-pose · {{sec}}s",
        sec: secLeft,
      });
    }
    if (stepId === "squats") {
      return t("aiTrainer.cal_squat_tracking", {
        defaultValue: "Tracking · {{reps}} squats captured",
        reps: calProgress.squatReps ?? 0,
      });
    }
    if (stepId === "turn" && calProgress.turnProgress != null) {
      return t("aiTrainer.cal_turn_keep", {
        defaultValue: "Keep turning · {{pct}}%",
        pct: Math.round(calProgress.turnProgress * 100),
      });
    }
    return calProgress.statusText || t("aiTrainer.cal_tracking", { defaultValue: "Tracking…" });
  }, [calProgress, stepId, stepReady, t]);

  const meterProgress = useMemo(() => {
    if (stepReady) return 1;
    if (!calProgress.gatePassed) return calProgress.gateProgress ?? 0;
    if (stepId === "tpose") return calProgress.holdProgress ?? 0;
    if (stepId === "squats") {
      const repPart = Math.min(1, (calProgress.squatReps ?? 0) / 2);
      const depthPart = calProgress.depthDeg
        ? Math.min(1, Math.max(0, (175 - calProgress.depthDeg) / 55))
        : 0;
      return Math.max(repPart, depthPart);
    }
    if (stepId === "turn") return calProgress.turnProgress ?? 0;
    return 0;
  }, [calProgress, stepId, stepReady]);

  const meterLabel = useMemo(() => {
    if (stepReady) return t("aiTrainer.cal_meter_done", { defaultValue: "Done" });
    if (!calProgress.gatePassed) {
      return t("aiTrainer.cal_meter_gate", { defaultValue: "Positioning" });
    }
    if (stepId === "tpose") {
      return t("aiTrainer.cal_meter_hold", {
        defaultValue: "Hold {{pct}}%",
        pct: Math.round((calProgress.holdProgress ?? 0) * 100),
      });
    }
    if (stepId === "squats") {
      return t("aiTrainer.cal_meter_depth", {
        defaultValue: "Depth {{deg}}°",
        deg: Math.round(calProgress.depthDeg ?? 180),
      });
    }
    if (stepId === "turn") {
      return t("aiTrainer.cal_meter_turn", {
        defaultValue: "Turn {{pct}}%",
        pct: Math.round((calProgress.turnProgress ?? 0) * 100),
      });
    }
    return "";
  }, [calProgress, stepId, stepReady, t]);

  if (summaryCal) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "left", "right", "bottom"]}>
        <ScrollView contentContainerStyle={styles.summaryScroll}>
          <Text style={styles.summaryTitle}>
            {t("aiTrainer.cal_summary_title", { defaultValue: "Calibration complete" })}
          </Text>
          <Text style={styles.summarySub}>
            {t("aiTrainer.cal_summary_sub", {
              defaultValue: "Here's what we measured for your body. Coaching will use these values.",
            })}
          </Text>
          {summaryItems.map((item) => (
            <View key={item.label} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{item.label}</Text>
              <Text style={styles.summaryValue}>{item.value}</Text>
            </View>
          ))}
          <Pressable
            style={[styles.continueBtn, busy && styles.continueBtnDisabled]}
            onPress={() => void onSummaryDone()}
            disabled={busy}
          >
            <Text style={styles.continueBtnTxt}>
              {busy
                ? t("common.saving", { defaultValue: "Saving…" })
                : t("aiTrainer.cal_summary_done", { defaultValue: "Looks good — continue" })}
            </Text>
          </Pressable>
          <Pressable style={styles.skipLink} onPress={onRecalibrate}>
            <Text style={styles.skipLinkTxt}>
              {t("aiTrainer.cal_recalibrate", { defaultValue: "Recalibrate" })}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      {serverError ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>{t("mediaPipe.serverError")}</Text>
          <Text style={styles.errorSub}>{serverError}</Text>
        </View>
      ) : serverUri ? (
        <WebView
          ref={webViewRef}
          key={`cal-step-${step}`}
          source={{ uri: serverUri }}
          injectedJavaScriptBeforeContentLoaded={buildInjectedCalibrationScript(
            stepId,
            facingMode,
            zoomLevel,
            stepId === "turn" ? partialRef.current.frontShoulderRatio : undefined,
          )}
          style={styles.webview}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          javaScriptEnabled
          onMessage={onMessage}
        />
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator color={AI_C.mint} size="large" />
          <Text style={styles.loadingTxt}>
            {t("mediaPipe.loadingTracker", { defaultValue: "Loading pose tracker…" })}
          </Text>
        </View>
      )}

      {demoActive ? <CalibrationPoseDemo step={stepId} secondsLeft={demoSecLeft} /> : null}

      <SafeAreaView style={styles.hud} pointerEvents="box-none" edges={["top", "left", "right", "bottom"]}>
        {/* TOP BAR */}
        <GlassPanel style={styles.topBar}>
          <View style={styles.topRow}>
            <Text style={styles.topTitle}>
              {t("aiTrainer.cal_title", { defaultValue: "Body calibration" })}
            </Text>
            <Pressable onPress={onSkip} hitSlop={8} accessibilityRole="button">
              <Text style={styles.skipLinkTxt}>
                {t("aiTrainer.cal_skip_short", { defaultValue: "Skip" })}
              </Text>
            </Pressable>
          </View>

          <View style={styles.segmentRow}>
            {STEPS.map((s, i) => (
              <View
                key={s.id}
                style={[
                  styles.segment,
                  i < step && styles.segmentDone,
                  i === step && styles.segmentActive,
                  i > step && styles.segmentUpcoming,
                ]}
              />
            ))}
          </View>

          <View style={styles.stepRow}>
            <Text style={styles.stepLabel}>
              {t("aiTrainer.cal_step_of", {
                defaultValue: "Step {{current}} of {{total}} · {{name}}",
                current: step + 1,
                total: STEPS.length,
                name: stepName,
              })}
            </Text>
            <Text style={styles.countdown}>{countdownSec}s</Text>
          </View>
        </GlassPanel>

        {/* MIDDLE — intentionally empty for camera view */}
        <View style={styles.middleSpacer} pointerEvents="none" />

        {/* BOTTOM STACK */}
        <View style={styles.bottomStack}>
          <Pressable
            style={[styles.statusPill, stepReady && styles.statusPillReady]}
            onPress={stepReady ? onContinueStep : undefined}
            disabled={!stepReady}
            accessibilityRole={stepReady ? "button" : "text"}
          >
            <View style={[styles.liveDot, calProgress.gatePassed && styles.liveDotActive]} />
            <Text style={styles.statusPillTxt} numberOfLines={1}>
              {statusPillText}
            </Text>
          </Pressable>

          <GlassPanel style={styles.meterPanel}>
            <View style={styles.meterTrack}>
              <View style={[styles.meterFill, { width: `${Math.round(meterProgress * 100)}%` }]} />
            </View>
            <Text style={styles.meterLabel}>{meterLabel}</Text>
          </GlassPanel>

          <View style={styles.bottomControls}>
            <Pressable
              style={styles.ctrlPill}
              onPress={handleFlipCam}
              accessibilityRole="button"
              accessibilityLabel={t("aiTrainer.flip_camera", { defaultValue: "Flip camera" })}
            >
              <Text style={styles.ctrlPillTxt}>
                {t("aiTrainer.flip_camera", { defaultValue: "Flip camera" })}
              </Text>
            </Pressable>

            <View style={styles.zoomPill}>
              <Text style={styles.zoomKicker}>
                {t("aiTrainer.zoom_label", { defaultValue: "Zoom" })}
              </Text>
              <Pressable
                style={[styles.zoomBtn, zoomLevel <= CAMERA_ZOOM_MIN && styles.ctrlDisabled]}
                onPress={handleZoomOut}
                disabled={zoomLevel <= CAMERA_ZOOM_MIN}
                accessibilityRole="button"
                accessibilityLabel={t("aiTrainer.zoom_out", { defaultValue: "Zoom out" })}
              >
                <Text style={styles.zoomBtnTxt}>−</Text>
              </Pressable>
              <Text style={styles.zoomValue} accessibilityLabel={`Zoom ${formatCameraZoom(zoomLevel)}`}>
                {formatCameraZoom(zoomLevel)}
              </Text>
              <Pressable
                style={[styles.zoomBtn, zoomLevel >= CAMERA_ZOOM_MAX && styles.ctrlDisabled]}
                onPress={handleZoomIn}
                disabled={zoomLevel >= CAMERA_ZOOM_MAX}
                accessibilityRole="button"
                accessibilityLabel={t("aiTrainer.zoom_in", { defaultValue: "Zoom in" })}
              >
                <Text style={styles.zoomBtnTxt}>+</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AI_C.bg },
  webview: { flex: 1, backgroundColor: AI_C.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  loadingTxt: { color: AI_C.dim, fontWeight: "600" },
  errorTitle: { color: AI_C.txt, fontSize: 16, fontWeight: "700", textAlign: "center" },
  errorSub: { color: AI_C.dim, fontSize: 13, textAlign: "center" },

  hud: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
  },

  topBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderColor: "rgba(45,212,167,0.22)",
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topTitle: { color: AI_C.txt, fontSize: 15, fontWeight: "700" },
  skipLinkTxt: {
    color: AI_C.dim,
    fontWeight: "600",
    fontSize: 13,
    textDecorationLine: "underline",
  },

  segmentRow: { flexDirection: "row", gap: 6 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  segmentDone: { backgroundColor: AI_C.mintDeep },
  segmentActive: { backgroundColor: AI_C.mint },
  segmentUpcoming: { backgroundColor: "rgba(255,255,255,0.12)" },

  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepLabel: { color: AI_C.dim, fontSize: 12, fontWeight: "600", flex: 1 },
  countdown: { color: AI_C.mint, fontSize: 12, fontWeight: "800", marginLeft: 8 },

  middleSpacer: { flex: 1 },

  bottomStack: { gap: 8 },
  statusPill: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: AI_C.line,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: "92%",
  },
  statusPillReady: {
    borderColor: "rgba(45,212,167,0.45)",
    backgroundColor: "rgba(45,212,167,0.12)",
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  liveDotActive: {
    backgroundColor: AI_C.mint,
    shadowColor: AI_C.mint,
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  statusPillTxt: { color: AI_C.txt, fontSize: 13, fontWeight: "600", flexShrink: 1 },

  meterPanel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderColor: "rgba(45,212,167,0.18)",
  },
  meterTrack: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 3,
    overflow: "hidden",
  },
  meterFill: { height: "100%", backgroundColor: AI_C.mint, borderRadius: 3 },
  meterLabel: {
    color: AI_C.dim,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
    letterSpacing: 0.3,
  },

  bottomControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ctrlPill: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: AI_C.line,
  },
  ctrlPillTxt: { color: AI_C.dim, fontSize: 12, fontWeight: "600" },
  zoomPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: AI_C.line,
  },
  zoomKicker: { color: AI_C.dim, fontSize: 11, fontWeight: "700" },
  zoomBtn: {
    minWidth: 32,
    paddingVertical: 4,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  zoomBtnTxt: { color: AI_C.txt, fontWeight: "700", fontSize: 14 },
  zoomValue: { color: AI_C.mint, fontWeight: "800", fontSize: 12, minWidth: 36, textAlign: "center" },
  ctrlDisabled: { opacity: 0.4 },

  summaryScroll: { padding: 20, paddingTop: 32, gap: 4 },
  summaryTitle: { color: AI_C.txt, fontSize: 20, fontWeight: "700", marginBottom: 6 },
  summarySub: { color: AI_C.dim, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  summaryRow: {
    backgroundColor: AI_C.glass,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: AI_C.line,
  },
  summaryLabel: { color: AI_C.mint, fontSize: 12, fontWeight: "700", marginBottom: 4 },
  summaryValue: { color: AI_C.txt, fontSize: 15, fontWeight: "600", lineHeight: 21 },
  continueBtn: {
    marginTop: 12,
    backgroundColor: AI_C.mint,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  continueBtnDisabled: { backgroundColor: "rgba(45,212,167,0.35)" },
  continueBtnTxt: { color: "#042f2e", fontWeight: "800", fontSize: 15 },
  skipLink: { marginTop: 14, alignSelf: "flex-start", paddingVertical: 8 },
});
