import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { AI_C } from "./aiTrainerTokens";

/** Animated audio-cue bars matching the mockup Waveform. */
export function WaveformBars({
  active,
  color = AI_C.purple,
}: {
  active: boolean;
  color?: string;
}) {
  const scales = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.35))).current;

  useEffect(() => {
    const loops = scales.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration: 350 + i * 65,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0.35,
            duration: 350 + i * 65,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    if (active) {
      loops.forEach((l) => l.start());
    } else {
      loops.forEach((l) => l.stop());
      scales.forEach((v) => v.setValue(0.3));
    }
    return () => loops.forEach((l) => l.stop());
  }, [active, scales]);

  return (
    <View style={styles.row}>
      {scales.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor: color,
              opacity: active ? 1 : 0.4,
              transform: [{ scaleY: v }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 2.5, height: 16 },
  bar: {
    width: 3,
    height: 14,
    borderRadius: 2,
  },
});
