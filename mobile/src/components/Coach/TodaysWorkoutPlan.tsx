import { useRef, useState } from "react";
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TodaysPlan } from "../../types/workoutCoach";
import { useAppTheme } from "../../theme";
import { ExerciseRow } from "./ExerciseRow";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACCENT = "#4ADE80";

export function TodaysWorkoutPlan({ plan }: { plan: TodaysPlan }) {
  const { colors, radius } = useAppTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const chevronRotation = useRef(new Animated.Value(0)).current;

  const focusLabel = plan.focusMuscles.length ? plan.focusMuscles.join(", ") : "General training";

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !isExpanded;
    Animated.timing(chevronRotation, {
      toValue: next ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
    setIsExpanded(next);
  };

  const chevronStyle = {
    transform: [
      {
        rotate: chevronRotation.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", "180deg"],
        }),
      },
    ],
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
      <Pressable
        onPress={handleToggle}
        style={styles.planHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={`Today's plan: ${plan.splitName}`}
      >
        <View style={styles.planHeaderText}>
          <Text style={[styles.header, { color: ACCENT }]}>TODAY&apos;S PLAN: {plan.splitName}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Focus: {focusLabel} · {plan.estimatedDuration}
          </Text>
        </View>
        <Animated.View style={chevronStyle}>
          <Ionicons name="chevron-down" size={20} color={ACCENT} />
        </Animated.View>
      </Pressable>

      {isExpanded ? (
        <View style={styles.planContent}>
          <View style={styles.divider} />
          {plan.avoidMuscles.length > 0 ? (
            <Text style={[styles.meta, { color: colors.muted }]}>Avoid: {plan.avoidMuscles.join(", ")}</Text>
          ) : null}
          {plan.exercises.map((ex, i) => (
            <ExerciseRow key={`${ex.name}-${i}`} index={i + 1} {...ex} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, marginTop: 4, overflow: "hidden" },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  planHeaderText: { flex: 1 },
  header: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  meta: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  planContent: { paddingHorizontal: 14, paddingBottom: 14 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.08)", marginBottom: 10 },
});
