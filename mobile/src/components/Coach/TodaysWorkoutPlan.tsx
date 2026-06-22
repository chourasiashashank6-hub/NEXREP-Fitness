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
import { useTranslation } from "react-i18next";
import type { TodaysPlan } from "../../types/workoutCoach";
import { WC_COLORS } from "../../constants/workoutCoach";
import { ExerciseRow } from "./ExerciseRow";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACCENT = WC_COLORS.PURPLE;

export function TodaysWorkoutPlan({ plan }: { plan: TodaysPlan }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const chevronRotation = useRef(new Animated.Value(0)).current;

  const focusLabel = plan.focusMuscles.length ? plan.focusMuscles.join(", ") : t("coach.components.generalTraining");

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
    <View style={styles.wrap}>
      <Pressable
        onPress={handleToggle}
        style={styles.planHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={t("coach.components.todaysPlanAccessibility", { splitName: plan.splitName })}
      >
        <View style={styles.planHeaderText}>
          <Text style={styles.sectionLabel}>{t("coach.components.todaysPlan")}</Text>
          <Text style={styles.planName}>{plan.splitName}</Text>
          <Text style={styles.meta}>
            {t("coach.components.focus", { focus: focusLabel, duration: plan.estimatedDuration })}
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
            <View style={styles.avoidPill}>
              <Text style={styles.avoidText}>{t("coach.components.avoid", { muscles: plan.avoidMuscles.join(", ") })}</Text>
            </View>
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
  wrap: { backgroundColor: WC_COLORS.BG, borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, marginTop: 4, overflow: "hidden" },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planHeaderText: { flex: 1 },
  sectionLabel: { color: WC_COLORS.MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  planName: { color: ACCENT, fontSize: 15, fontWeight: "800", marginTop: 7 },
  meta: { color: WC_COLORS.MUTED, fontSize: 11, marginTop: 4, lineHeight: 16 },
  planContent: { paddingTop: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: WC_COLORS.BORDER, marginBottom: 10 },
  avoidPill: { alignSelf: "flex-start", backgroundColor: WC_COLORS.ORANGE_LIGHT, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 4 },
  avoidText: { color: WC_COLORS.ORANGE, fontSize: 11, fontWeight: "700" },
});
