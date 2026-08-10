import { ReactNode, useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import MediaPipeGuidanceView from "../MediaPipeGuidanceView";
import { DepthRomGauge } from "./DepthRomGauge";
import { GlassPanel } from "./GlassPanel";
import { WaveformBars } from "./WaveformBars";
import { AI_C } from "./aiTrainerTokens";
import { formatCameraZoom } from "../../services/aiTrainer/webviewCameraControls";
import type { PoseCalibration, RepVerdict, ResolvedPoseSpec } from "../../data/aiTrainer/types";
import type { LiveTrackingStatus } from "../../hooks/useCameraTracking";
import {
  speakBypassTestAudio,
  speakTestUtterance,
  unlockWebSpeech,
  voiceModeLabel,
  type CoachPriority,
  type VoiceMode,
} from "../../services/aiTrainer/audioCoach";

export type CameraWorkoutShellProps = {
  exerciseName: string;
  exerciseSubtitle?: string;
  targetReps?: number;
  poseSpec: ResolvedPoseSpec | null;
  calibration: PoseCalibration;
  isActive?: boolean;
  countingPaused?: boolean;
  sessionPaused?: boolean;
  seedRepCount?: number;
  facingMode?: "user" | "environment";
  repCount: number;
  formScore: number;
  verdicts: RepVerdict[];
  liveRom01: number;
  liveInZone: boolean;
  zoneStart01: number;
  zoneEnd01: number;
  orientationOk: boolean;
  liveStatus: LiveTrackingStatus;
  coachText: string;
  coachWarn: boolean;
  ttsSpeaking?: boolean;
  trackingRunning?: boolean;
  voiceMode?: VoiceMode;
  cameraError?: string | null;
  showCalibrateBanner?: boolean;
  webAudioReady?: boolean;
  onClose: () => void;
  onCalibrate?: () => void;
  onPauseToggle?: () => void;
  onVoiceModeCycle?: () => void;
  onFlipCam?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  zoomLevel?: number;
  onTrackingUpdate: (update: import("../MediaPipeGuidanceView").MediaPipeTrackingUpdate) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  /** Optional overlay (e.g. rest countdown) rendered above camera, below HUD chrome. */
  overlay?: ReactNode;
  hideBottomControls?: boolean;
  /** Relax orientation/idle/visibility gates for standalone camera workouts. */
  relaxTrackingGates?: boolean;
};

export function CameraWorkoutShell({
  exerciseName,
  exerciseSubtitle,
  targetReps = 10,
  poseSpec,
  calibration,
  isActive = true,
  countingPaused = false,
  sessionPaused = false,
  seedRepCount = 0,
  facingMode = "user",
  repCount,
  formScore,
  verdicts,
  liveRom01,
  liveInZone,
  zoneStart01,
  zoneEnd01,
  orientationOk,
  liveStatus,
  coachText,
  coachWarn,
  ttsSpeaking = false,
  trackingRunning = true,
  voiceMode = "full",
  cameraError,
  showCalibrateBanner = false,
  webAudioReady = true,
  onClose,
  onCalibrate,
  onPauseToggle,
  onVoiceModeCycle,
  onFlipCam,
  onZoomIn,
  onZoomOut,
  zoomLevel = 1,
  onTrackingUpdate,
  onReady,
  onError,
  overlay,
  hideBottomControls = false,
  relaxTrackingGates = false,
}: CameraWorkoutShellProps) {
  const { t } = useTranslation();
  const cleanCount = verdicts.filter((v) => v === "clean").length;
  const flaggedCount = verdicts.filter((v) => v === "flagged").length;
  const coachOnLabel =
    voiceMode === "muted" ? "COACH OFF" : voiceMode === "corrections_only" ? "COACH FIXES" : "COACH ON";

  const trackable = Boolean(poseSpec);

  const cameraKey = useMemo(
    () => `cam-${exerciseName}-${seedRepCount}`,
    [exerciseName, seedRepCount],
  );

  return (
    <View style={styles.cameraShell}>
      {isActive && trackable ? (
        <MediaPipeGuidanceView
          key={cameraKey}
          selectedExerciseName={exerciseName}
          isActive
          sessionMode
          facingMode={facingMode}
          poseSpec={poseSpec}
          calibration={calibration}
          seedRepCount={seedRepCount}
          countingPaused={countingPaused || sessionPaused}
          relaxTrackingGates={relaxTrackingGates}
          zoomLevel={zoomLevel}
          onReady={onReady}
          onError={onError}
          onTrackingUpdate={onTrackingUpdate}
        />
      ) : isActive ? (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.untrackableTxt}>
            {t("aiTrainer.manual_logging_only", {
              defaultValue: "Manual logging only — camera tracking isn't available for this exercise.",
            })}
          </Text>
        </View>
      ) : (
        <View style={styles.cameraPlaceholder}>
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {cameraError ? (
        <View style={styles.cameraErrorBanner}>
          <Text style={styles.cameraErrorTxt}>{cameraError}</Text>
        </View>
      ) : null}

      {overlay}

      <View style={styles.hud} pointerEvents="box-none">
        {showCalibrateBanner && onCalibrate ? (
          <Pressable style={styles.calBanner} onPress={onCalibrate}>
            <Text style={styles.calBannerTxt}>
              {t("aiTrainer.calibrate_banner", { defaultValue: "Calibrate for accuracy" })}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.liveTopBar}>
          <GlassPanel style={styles.topGlass}>
            <View style={[styles.livePulse, !trackingRunning && styles.livePulseIdle]} />
            <View style={styles.topCopy}>
              <Text style={styles.topExName} numberOfLines={1}>
                {exerciseName}
              </Text>
              {exerciseSubtitle ? (
                <Text style={styles.topExSub} numberOfLines={1}>
                  {exerciseSubtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.coachOn}>
              <WaveformBars active={ttsSpeaking} />
              <Text style={styles.coachOnLbl}>{coachOnLabel}</Text>
            </View>
          </GlassPanel>
          <Pressable style={styles.closeGlass} onPress={onClose} accessibilityLabel="Close camera">
            <Text style={styles.closeX}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.leftCol} pointerEvents="none">
          <GlassPanel style={styles.repCard}>
            <Text style={styles.repBig}>
              {repCount}
              <Text style={styles.repSlash}>/{targetReps}</Text>
            </Text>
            <Text style={styles.cleanLbl}>CLEAN REPS</Text>
            <Text style={styles.cleanSub}>
              {cleanCount} perfect · {flaggedCount} flagged
            </Text>
          </GlassPanel>
          <GlassPanel style={styles.scoreCard}>
            <Text
              style={[
                styles.scoreBig,
                {
                  color:
                    liveStatus === "no_body" || !trackable
                      ? AI_C.dim
                      : formScore >= 89
                        ? AI_C.mint
                        : AI_C.orange,
                },
              ]}
            >
              {liveStatus === "no_body" || !trackable ? "—" : formScore}
            </Text>
            <Text style={styles.scoreLbl}>FORM SCORE</Text>
          </GlassPanel>
        </View>

        <View style={styles.depthCol} pointerEvents="none">
          <DepthRomGauge
            progress01={liveStatus === "no_body" ? 0 : liveRom01}
            inZone={liveInZone && orientationOk && liveStatus !== "no_body"}
            zoneStart01={zoneStart01}
            zoneEnd01={zoneEnd01}
          />
        </View>

        <View style={styles.dotsRow} pointerEvents="none">
          {verdicts.slice(-12).map((v, i) => (
            <View
              key={`${i}-${v}`}
              style={[
                styles.dot,
                {
                  backgroundColor: v === "clean" ? AI_C.mint : AI_C.orange,
                  opacity: 0.5 + 0.5 * (i / 12),
                },
              ]}
            />
          ))}
        </View>

        <GlassPanel
          style={[
            styles.coachBanner,
            { borderColor: coachWarn ? "rgba(255,122,69,0.55)" : "rgba(139,92,246,0.45)" },
          ]}
        >
          <View
            style={[
              styles.coachIcon,
              {
                backgroundColor: coachWarn ? "rgba(255,122,69,0.18)" : "rgba(139,92,246,0.2)",
              },
            ]}
          >
            <Text style={{ fontSize: 18 }}>{coachWarn ? "⚠️" : "🎧"}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.coachKicker, { color: coachWarn ? AI_C.orange : AI_C.purple }]}>
              {coachWarn ? "AUDIO CUE · CORRECTION" : "AUDIO CUE · COACH"}
            </Text>
            <Text style={styles.coachBody} numberOfLines={2}>
              {coachText}
            </Text>
          </View>
          <WaveformBars active={ttsSpeaking} color={coachWarn ? AI_C.orange : AI_C.purple} />
        </GlassPanel>

        {sessionPaused ? (
          <View style={styles.pauseOverlay}>
            <Text style={styles.pauseTitle}>Paused</Text>
            <Text style={styles.pauseSub}>Rep counting and audio are frozen</Text>
            {onPauseToggle ? (
              <Pressable style={styles.resumeBtn} onPress={onPauseToggle}>
                <Text style={styles.resumeBtnTxt}>▶ Resume</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!sessionPaused && !orientationOk && liveStatus !== "no_body" ? (
          <View style={styles.orientOverlay} pointerEvents="none">
            <Text style={styles.orientTxt}>{coachText}</Text>
          </View>
        ) : null}

        {!hideBottomControls ? (
          <View style={styles.bottomControls}>
            {onPauseToggle ? (
              <Pressable style={styles.ctrlBtn} onPress={onPauseToggle}>
                <Text style={styles.ctrlTxt}>{sessionPaused ? "▶ Resume" : "⏸ Pause"}</Text>
              </Pressable>
            ) : null}
            {onVoiceModeCycle ? (
              <Pressable
                style={[styles.ctrlBtn, voiceMode !== "muted" && styles.ctrlBtnActive]}
                onPress={onVoiceModeCycle}
              >
                <Text style={[styles.ctrlTxt, voiceMode !== "muted" && { color: AI_C.purple }]}>
                  {voiceModeLabel(voiceMode)}
                </Text>
              </Pressable>
            ) : null}
            {onFlipCam ? (
              <Pressable
                style={styles.ctrlBtn}
                onPress={onFlipCam}
                accessibilityRole="button"
                accessibilityLabel={t("aiTrainer.flip_camera", { defaultValue: "Flip camera" })}
              >
                <Text style={styles.ctrlTxt}>
                  {t("aiTrainer.flip_camera", { defaultValue: "Flip camera" })}
                </Text>
              </Pressable>
            ) : null}
            {onZoomIn || onZoomOut ? (
              <View style={styles.zoomGroup}>
                <Text style={styles.zoomKicker}>
                  {t("aiTrainer.zoom_label", { defaultValue: "Zoom" })}
                </Text>
                {onZoomOut ? (
                  <Pressable
                    style={[styles.zoomBtn, zoomLevel <= 1 && styles.ctrlBtnDisabled]}
                    onPress={onZoomOut}
                    disabled={zoomLevel <= 1}
                    accessibilityRole="button"
                    accessibilityLabel={t("aiTrainer.zoom_out", { defaultValue: "Zoom out" })}
                  >
                    <Text style={styles.ctrlTxt}>−</Text>
                  </Pressable>
                ) : null}
                <Text
                  style={styles.zoomValue}
                  accessibilityLabel={`Zoom ${formatCameraZoom(zoomLevel)}`}
                >
                  {formatCameraZoom(zoomLevel)}
                </Text>
                {onZoomIn ? (
                  <Pressable
                    style={[styles.zoomBtn, zoomLevel >= 3 && styles.ctrlBtnDisabled]}
                    onPress={onZoomIn}
                    disabled={zoomLevel >= 3}
                    accessibilityRole="button"
                    accessibilityLabel={t("aiTrainer.zoom_in", { defaultValue: "Zoom in" })}
                  >
                    <Text style={styles.ctrlTxt}>+</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {Platform.OS === "web" && !webAudioReady ? (
          <Pressable
            style={styles.enableAudioBanner}
            onPress={() => speakTestUtterance("Coach audio is on")}
          >
            <Text style={styles.enableAudioTxt}>
              🔊 Tap to enable coach audio (browser requires a click)
            </Text>
          </Pressable>
        ) : null}

        {Platform.OS === "web" ? (
          <Pressable
            style={styles.testAudioBtn}
            onPress={() => {
              const ok = speakBypassTestAudio("bypass test");
              if (!ok) speakTestUtterance("Test audio one two three");
            }}
          >
            <Text style={styles.testAudioTxt}>Test Audio</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraShell: { flex: 1, backgroundColor: AI_C.bg },
  cameraPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AI_C.bg,
    padding: 24,
  },
  untrackableTxt: { color: AI_C.dim, textAlign: "center", fontWeight: "600", lineHeight: 20 },
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
  liveTopBar: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
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
  livePulseIdle: { backgroundColor: AI_C.dim, shadowOpacity: 0 },
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
  leftCol: { position: "absolute", top: 88, left: 14, gap: 8, zIndex: 2 },
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
  scoreCard: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, alignItems: "center" },
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
    flexWrap: "wrap",
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
  ctrlBtnDisabled: { opacity: 0.45 },
  ctrlTxt: { color: AI_C.dim, fontSize: 12, fontWeight: "600" },
  zoomGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: AI_C.glass,
    borderWidth: 1,
    borderColor: AI_C.line,
  },
  zoomKicker: { color: AI_C.dim, fontSize: 11, fontWeight: "700", marginRight: 2 },
  zoomBtn: {
    minWidth: 36,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  zoomValue: { color: AI_C.txt, fontSize: 12, fontWeight: "800", minWidth: 36, textAlign: "center" },
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
});
