import { useEffect } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import type { CalibrationStepId } from "../../services/aiTrainer/mediaPipeCalibrationTemplate";
import { CALIBRATION_SQUAT_GIF } from "../../data/aiTrainer/calibrationExerciseGifs";

const MINT = "#2DD4A7";
const STROKE = "#E2E8F0";

type Props = {
  step: CalibrationStepId;
  secondsLeft: number;
};

function TposeFigure() {
  return (
    <Svg width={160} height={220} viewBox="0 0 160 220">
      <Circle cx={80} cy={28} r={16} fill={MINT} />
      <Line x1={80} y1={44} x2={80} y2={120} stroke={STROKE} strokeWidth={6} strokeLinecap="round" />
      <Line x1={20} y1={70} x2={140} y2={70} stroke={MINT} strokeWidth={6} strokeLinecap="round" />
      <Line x1={80} y1={120} x2={58} y2={200} stroke={STROKE} strokeWidth={6} strokeLinecap="round" />
      <Line x1={80} y1={120} x2={102} y2={200} stroke={STROKE} strokeWidth={6} strokeLinecap="round" />
    </Svg>
  );
}

function SquatFigure() {
  return (
    <Image
      source={{ uri: CALIBRATION_SQUAT_GIF.gifUrl }}
      style={styles.demoGif}
      resizeMode="contain"
      accessibilityLabel="Bodyweight squat demonstration"
    />
  );
}

function TurnFigure() {
  return (
    <Svg width={160} height={220} viewBox="0 0 160 220">
      <Circle cx={80} cy={100} r={52} fill="none" stroke="rgba(45,212,167,0.35)" strokeWidth={3} strokeDasharray="8 6" />
      <Circle cx={80} cy={32} r={14} fill={MINT} />
      <Line x1={80} y1={46} x2={80} y2={118} stroke={STROKE} strokeWidth={6} strokeLinecap="round" />
      <Line x1={80} y1={70} x2={118} y2={82} stroke={MINT} strokeWidth={5} strokeLinecap="round" />
      <Line x1={80} y1={118} x2={68} y2={188} stroke={STROKE} strokeWidth={6} strokeLinecap="round" />
      <Line x1={80} y1={118} x2={92} y2={188} stroke={STROKE} strokeWidth={6} strokeLinecap="round" />
      <Line x1={118} y1={100} x2={132} y2={88} stroke={MINT} strokeWidth={4} strokeLinecap="round" />
    </Svg>
  );
}

const STEP_COPY: Record<CalibrationStepId, { title: string; hint: string }> = {
  tpose: {
    title: "T-pose",
    hint: "Face the camera, arms straight out to your sides, full body visible.",
  },
  squats: {
    title: "Bodyweight squats",
    hint: "Stand side-on to the camera and do 2 slow squats.",
  },
  turn: {
    title: "Turn in a circle",
    hint: "Face the camera, then rotate slowly through a full 360°.",
  },
};

export function CalibrationPoseDemo({ step, secondsLeft }: Props) {
  const copy = STEP_COPY[step];

  useEffect(() => {
    if (step === "squats") {
      void Image.prefetch(CALIBRATION_SQUAT_GIF.gifUrl);
    }
  }, [step]);

  return (
    <View style={styles.wrap} accessibilityRole="image" accessibilityLabel={`${copy.title} demo`}>
      <View style={styles.card}>
        {step === "tpose" ? <TposeFigure /> : null}
        {step === "squats" ? <SquatFigure /> : null}
        {step === "turn" ? <TurnFigure /> : null}
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.hint}>{copy.hint}</Text>
        <Text style={styles.countdown}>Starting in {secondsLeft}…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,11,22,0.88)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    padding: 24,
  },
  card: {
    alignItems: "center",
    maxWidth: 320,
    gap: 10,
  },
  demoGif: { width: 180, height: 220 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 8 },
  hint: { color: "rgba(255,255,255,0.8)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  countdown: { color: MINT, fontSize: 13, fontWeight: "700", marginTop: 6 },
});
