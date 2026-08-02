import { StyleSheet, Text, View } from "react-native";
import { AI_C } from "./aiTrainerTokens";

/**
 * Vertical depth/ROM gauge — matches reference LiveScreen:
 * thin track, dashed mint target band, live marker that glows in-zone.
 */
export function DepthRomGauge({
  progress01,
  inZone,
  zoneStart01 = 0.74,
  zoneEnd01 = 0.96,
}: {
  /** 0 = top/lockout, 1 = bottom of depth (marker slides downward) */
  progress01: number;
  inZone: boolean;
  /** Calibrated target band (0–1 from top). */
  zoneStart01?: number;
  zoneEnd01?: number;
}) {
  const p = Math.max(0, Math.min(1, progress01));
  const z0 = Math.max(0, Math.min(1, zoneStart01));
  const z1 = Math.max(z0, Math.min(1, zoneEnd01));
  const zoneTopPct = z0 * 100;
  const zoneHPct = Math.max(4, (z1 - z0) * 100);
  return (
    <View style={styles.wrap} accessibilityLabel="Depth">
      <Text style={styles.topLbl}>DEPTH</Text>
      <View style={styles.track}>
        <View style={[styles.zone, { top: `${zoneTopPct}%`, height: `${zoneHPct}%` }]} />
        <View
          style={[
            styles.marker,
            { top: `${p * 92}%` },
            inZone ? styles.markerIn : styles.markerOut,
          ]}
        />
      </View>
      <Text style={styles.bottomLbl}>YOUR RANGE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 34,
    alignItems: "center",
    flex: 1,
    maxHeight: 280,
    paddingVertical: 4,
  },
  topLbl: {
    fontSize: 9,
    letterSpacing: 1.2,
    color: AI_C.dim,
    fontWeight: "700",
    marginBottom: 6,
  },
  track: {
    flex: 1,
    width: 10,
    minHeight: 140,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: AI_C.line,
    position: "relative",
  },
  zone: {
    position: "absolute",
    left: -3,
    right: -3,
    borderRadius: 6,
    backgroundColor: "rgba(45,212,167,0.22)",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: AI_C.mint,
  },
  marker: {
    position: "absolute",
    left: -8,
    right: -8,
    height: 5,
    marginTop: -2,
    borderRadius: 3,
  },
  markerOut: {
    backgroundColor: AI_C.txt,
  },
  markerIn: {
    backgroundColor: AI_C.mint,
    shadowColor: AI_C.mint,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
  },
  bottomLbl: {
    fontSize: 9,
    color: AI_C.mint,
    fontWeight: "700",
    marginTop: 6,
  },
});
