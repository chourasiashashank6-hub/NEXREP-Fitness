import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

export type MediaPipeTrackingUpdate = {
  reps: number;
  formOk: boolean;
  correction: string;
  phase: string;
  bodyDetected: boolean;
  primaryAngle?: number | null;
  rom01?: number;
  inDepthZone?: boolean;
  zoneStart01?: number;
  zoneEnd01?: number;
  orientationOk?: boolean;
  requiredView?: string;
  cueKey?: string | null;
  cuePriority?: "safety" | "correction" | null;
  repCompleted?: boolean;
  repVerdict?: "clean" | "flagged" | null;
  failedChecksThisRep?: string[];
  countingGated?: boolean;
};

export type MediaPipeGuidanceViewProps = {
  selectedExerciseName?: string;
  isActive?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
  onTrackingUpdate?: (update: MediaPipeTrackingUpdate) => void;
  sessionMode?: boolean;
  facingMode?: "user" | "environment";
  poseSpec?: unknown;
  calibration?: unknown;
  seedRepCount?: number;
  countingPaused?: boolean;
  relaxTrackingGates?: boolean;
  zoomLevel?: number;
};

/** Web placeholder — use Android APK for camera / pose tracking. */
export default function MediaPipeGuidanceView({ onReady }: MediaPipeGuidanceViewProps) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Camera preview</Text>
      <Text style={styles.hint}>Pose tracking runs on device only. Web is for UI layout testing.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 8 },
  hint: { color: "#9ca3af", fontSize: 13, textAlign: "center", lineHeight: 18 },
});
