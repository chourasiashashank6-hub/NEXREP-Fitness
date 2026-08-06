import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { scoreSetFromReps } from "../data/aiTrainer/formScore";
import { remapSpecWithCalibration, resolvePoseSpec } from "../data/aiTrainer/resolvePoseSpec";
import type { AiRepEvent, RepVerdict } from "../data/aiTrainer/types";
import type { MediaPipeTrackingUpdate } from "../components/MediaPipeGuidanceView";
import { sharedAudioCoach } from "../services/aiTrainer/audioCoach";
import { usePoseCalibrationStore } from "../store/poseCalibrationStore";
import type { CoachPriority } from "../services/aiTrainer/audioCoach";
import {
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_STEP,
} from "../services/aiTrainer/webviewCameraControls";

export type LiveTrackingStatus = "tracking_good" | "tracking_correction" | "no_body";

export type CameraTrackingDisplayState = {
  repCount: number;
  formScore: number;
  verdicts: RepVerdict[];
  liveRom01: number;
  liveInZone: boolean;
  zoneStart01: number;
  zoneEnd01: number;
  orientationOk: boolean;
  liveStatus: LiveTrackingStatus;
  liveCorrection: string;
  bannerCue: { text: string; priority: CoachPriority | "idle" } | null;
  sessionPaused: boolean;
  countingPaused: boolean;
  facingMode: "user" | "environment";
  zoomLevel: number;
};

type UseCameraTrackingOptions = {
  exerciseName: string;
  targetReps?: number;
  /** When set, rep count is controlled externally (session store). */
  externalRepCount?: number;
  onRepCountChange?: (count: number) => void;
  onRepComplete?: (event: AiRepEvent, formScore: number) => void;
  enableAudio?: boolean;
  paused?: boolean;
};

export function useCameraTracking(options: UseCameraTrackingOptions) {
  const {
    exerciseName,
    targetReps = 10,
    externalRepCount,
    onRepCountChange,
    onRepComplete,
    enableAudio = true,
    paused = false,
  } = options;
  const { t } = useTranslation();
  const calibrationPayload = usePoseCalibrationStore((s) => s.effectiveCalibration());
  const poseSpec = useMemo(() => {
    const raw = resolvePoseSpec(exerciseName);
    if (!raw) return null;
    return remapSpecWithCalibration(raw, calibrationPayload);
  }, [exerciseName, calibrationPayload]);

  const [internalRepCount, setInternalRepCount] = useState(0);
  const repCount = externalRepCount ?? internalRepCount;
  const [verdicts, setVerdicts] = useState<RepVerdict[]>([]);
  const [formScore, setFormScore] = useState(100);
  const [liveRom01, setLiveRom01] = useState(0);
  const [liveInZone, setLiveInZone] = useState(false);
  const [zoneStart01, setZoneStart01] = useState(0.74);
  const [zoneEnd01, setZoneEnd01] = useState(0.96);
  const [orientationOk, setOrientationOk] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveTrackingStatus>("no_body");
  const [liveCorrection, setLiveCorrection] = useState(
    t("aiTrainer.step_into_frame", { defaultValue: "Step back into frame" }),
  );
  const [bannerCue, setBannerCue] = useState<{
    text: string;
    priority: CoachPriority | "idle";
  } | null>(null);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [countingPaused, setCountingPaused] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [zoomLevel, setZoomLevel] = useState(CAMERA_ZOOM_MIN);

  const repEventsRef = useRef<AiRepEvent[]>([]);
  const lastSpokenCueRef = useRef<string | null>(null);

  const setRepCount = useCallback(
    (n: number) => {
      if (externalRepCount == null) setInternalRepCount(n);
      onRepCountChange?.(n);
    },
    [externalRepCount, onRepCountChange],
  );

  const resetTracking = useCallback(() => {
    repEventsRef.current = [];
    setInternalRepCount(0);
    setVerdicts([]);
    setFormScore(100);
    setLiveRom01(0);
    setLiveInZone(false);
    setOrientationOk(true);
    setLiveStatus("no_body");
    lastSpokenCueRef.current = null;
    setSessionPaused(false);
    setCountingPaused(false);
    setFacingMode("user");
    setZoomLevel(CAMERA_ZOOM_MIN);
  }, []);

  const handleTrackingUpdate = useCallback(
    (update: MediaPipeTrackingUpdate) => {
      if (sessionPaused || paused) return;

      if (update.rom01 != null) setLiveRom01(update.rom01);
      if (update.zoneStart01 != null) setZoneStart01(update.zoneStart01);
      if (update.zoneEnd01 != null) setZoneEnd01(update.zoneEnd01);
      if (update.inDepthZone != null) setLiveInZone(update.inDepthZone);
      setOrientationOk(update.orientationOk !== false);

      if (!update.bodyDetected) {
        setLiveStatus("no_body");
        setLiveCorrection(
          t("aiTrainer.step_into_frame", { defaultValue: "Step back into frame" }),
        );
        return;
      }

      if (update.reps !== repCount) {
        setRepCount(update.reps);
        if (enableAudio) sharedAudioCoach.setRepIndex(update.reps);
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
        repEventsRef.current = [...repEventsRef.current, event];
        setVerdicts((v) => [...v, update.repVerdict!]);
        const sev: Record<string, "critical" | "minor"> = {};
        for (const c of poseSpec?.checks || []) sev[c.id] = c.severity;
        const score = scoreSetFromReps(repEventsRef.current, sev);
        setFormScore(Math.round(score));
        onRepComplete?.(event, score);
        if (enableAudio && update.repVerdict === "clean") {
          sharedAudioCoach.speakKey("cue_clean_rep", "encouragement", "encourage_clean", update.reps);
        }
      }

      if (update.orientationOk === false) {
        setLiveStatus("tracking_correction");
        const orientKey = update.requiredView === "side" ? "cue_turn_side" : "cue_turn_front";
        const orientText = t(`aiTrainer.${orientKey}`, {
          defaultValue: update.requiredView === "side" ? "Turn to your side" : "Face the camera",
        });
        setLiveCorrection(String(orientText));
        setBannerCue({ text: String(orientText), priority: "safety" });
        if (enableAudio && lastSpokenCueRef.current !== orientKey) {
          lastSpokenCueRef.current = orientKey;
          sharedAudioCoach.speakKey(orientKey, "safety", orientKey, update.reps);
        }
      } else if (update.cueKey) {
        setLiveStatus("tracking_correction");
        const cueText = t(`aiTrainer.${update.cueKey}`, {
          defaultValue: update.cueKey.replace(/^cue_/, "").replace(/_/g, " "),
        });
        setLiveCorrection(String(cueText));
        setBannerCue({ text: String(cueText), priority: update.cuePriority || "correction" });
        const speakId = `${update.cueKey}:${update.reps}`;
        if (enableAudio && lastSpokenCueRef.current !== speakId) {
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
        setBannerCue(null);
      }
    },
    [
      sessionPaused,
      paused,
      repCount,
      setRepCount,
      enableAudio,
      poseSpec,
      onRepComplete,
      t,
    ],
  );

  const handlePauseToggle = useCallback(() => {
    if (sessionPaused) {
      setSessionPaused(false);
      setCountingPaused(false);
      return;
    }
    setSessionPaused(true);
    setCountingPaused(true);
    sharedAudioCoach.clear();
  }, [sessionPaused]);

  const handleFlipCam = useCallback(() => {
    setFacingMode((f) => (f === "user" ? "environment" : "user"));
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoomLevel((z) => Math.min(CAMERA_ZOOM_MAX, Math.round((z + CAMERA_ZOOM_STEP) * 100) / 100));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((z) => Math.max(CAMERA_ZOOM_MIN, Math.round((z - CAMERA_ZOOM_STEP) * 100) / 100));
  }, []);

  const trackingRunning = !sessionPaused && !countingPaused && !paused;

  return {
    poseSpec,
    calibrationPayload,
    targetReps,
    repCount,
    formScore,
    verdicts,
    liveRom01,
    liveInZone,
    zoneStart01,
    zoneEnd01,
    orientationOk,
    liveStatus,
    liveCorrection,
    bannerCue,
    sessionPaused,
    countingPaused,
    facingMode,
    zoomLevel,
    trackingRunning,
    handleTrackingUpdate,
    handlePauseToggle,
    handleFlipCam,
    handleZoomIn,
    handleZoomOut,
    resetTracking,
    setSessionPaused,
    setCountingPaused,
  };
}
