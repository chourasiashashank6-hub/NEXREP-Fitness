import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { WC_COLORS } from "../../constants/workoutCoach";

function scoreColor(score: number): string {
  if (score >= 81) return "#4ADE80";
  if (score >= 61) return "#22C55E";
  if (score >= 31) return "#F59E0B";
  return "#EF4444";
}

type Props = {
  score: number;
  label: string;
  subtitle?: string;
  size?: number;
  pulseWhenHigh?: boolean;
  strokeColor?: string;
  trackColor?: string;
  textColor?: string;
  labelColor?: string;
  subtitleColor?: string;
};

export function CircularScore({
  score,
  label,
  subtitle,
  size = 120,
  pulseWhenHigh = false,
  strokeColor,
  trackColor = WC_COLORS.TRACK,
  textColor,
  labelColor = WC_COLORS.TEXT,
  subtitleColor = WC_COLORS.MUTED,
}: Props) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = strokeColor ?? scoreColor(clamped);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulseWhenHigh || clamped < 81) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, pulseWhenHigh, clamped]);

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={8} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={8}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={offset}
            rotation="-90"
            origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
        <View style={[styles.center, { width: size, height: size }]}>
          <Text style={[styles.score, { color: textColor ?? color }]}>{clamped}</Text>
        </View>
      </Animated.View>
      {label ? <Text style={[styles.label, { color: labelColor }]}>{label}</Text> : null}
      {subtitle ? <Text style={[styles.sub, { color: subtitleColor }]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 8 },
  center: { position: "absolute", top: 0, left: 0, alignItems: "center", justifyContent: "center" },
  score: { fontSize: 28, fontWeight: "800" },
  label: { marginTop: 10, fontSize: 16, fontWeight: "700" },
  sub: { marginTop: 4, fontSize: 11, textAlign: "center", paddingHorizontal: 16, lineHeight: 16 },
});
