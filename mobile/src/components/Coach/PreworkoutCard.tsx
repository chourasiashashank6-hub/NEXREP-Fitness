import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import {
  generatePreworkoutPlan,
  isCardioGoal,
  type PreworkoutPlan,
  type PreworkoutProfile,
} from "../../utils/generatePreworkoutPlan";

const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GREEN = "#0F6E56";
const TEXT = "#1A1A18";
const MUTED = "#6B7280";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";

type Props = {
  profile: PreworkoutProfile;
  dayMuscleFocus: string[];
  guidedWarmupCompleted?: boolean;
  onStartGuided?: (plan: PreworkoutPlan) => void;
};

export function PreworkoutCard({ profile, dayMuscleFocus, guidedWarmupCompleted = false, onStartGuided }: Props) {
  const { t } = useTranslation();
  const { hasFeatureAccess } = useFeatureAccess();
  const canView = hasFeatureAccess("preworkout_recommendation");
  const canStartGuided = hasFeatureAccess("guided_warmup_session");

  const plan = useMemo(
    () => generatePreworkoutPlan(profile, dayMuscleFocus),
    [profile, dayMuscleFocus],
  );

  if (!canView) return null;

  const showGuidedButton = canStartGuided && plan.kind === "cardio" && isCardioGoal(profile.primaryGoal);

  return (
    <View style={styles.card}>
      <View style={styles.tagRow}>
        <Ionicons name="sparkles" size={12} color={PURPLE} />
        <Text style={styles.tagText}>{t("coach.workoutPlannerScreen.preworkout.aiTag")}</Text>
      </View>

      {plan.kind === "cardio" ? (
        <>
          <Text style={styles.summaryTitle}>{t("coach.workoutPlannerScreen.preworkout.cardioTitle")}</Text>
          <Text style={styles.summaryLine}>
            {t("coach.workoutPlannerScreen.preworkout.cardioSummary", {
              minutes: plan.totalDurationMin,
              kcal: plan.estimatedKcal,
            })}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.summaryTitle}>{t("coach.workoutPlannerScreen.preworkout.strengthTitle")}</Text>
          <Text style={styles.summaryLine}>
            {t("coach.workoutPlannerScreen.preworkout.strengthSummary", {
              sets: plan.rampUpSets,
              minutes: plan.rampUpMinutesPerSet,
              protein: plan.postWorkoutProteinG,
            })}
          </Text>
        </>
      )}

      <View style={styles.exerciseList}>
        {plan.warmupExercises.map((exercise) => (
          <View key={`${exercise.name}-${exercise.cue}`} style={styles.exerciseRow}>
            <View style={styles.bullet} />
            <View style={styles.exerciseCopy}>
              <Text style={styles.exerciseName}>{exercise.name}</Text>
              <Text style={styles.exerciseCue}>{exercise.cue}</Text>
            </View>
          </View>
        ))}
      </View>

      {showGuidedButton ? (
        <Pressable
          style={[styles.guidedBtn, guidedWarmupCompleted && styles.guidedBtnCompleted]}
          onPress={() => onStartGuided?.(plan)}
          disabled={guidedWarmupCompleted}
          accessibilityRole="button"
          accessibilityState={{ disabled: guidedWarmupCompleted }}
        >
          <Ionicons
            name={guidedWarmupCompleted ? "checkmark-circle" : "play-circle"}
            size={18}
            color={WHITE}
          />
          <Text style={styles.guidedBtnText}>
            {guidedWarmupCompleted
              ? t("coach.workoutPlannerScreen.preworkout.warmupCompleted")
              : t("coach.workoutPlannerScreen.preworkout.startGuided")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: PURPLE,
    borderRadius: 16,
    backgroundColor: PURPLE_LIGHT,
    padding: 14,
    marginBottom: 12,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  tagText: {
    color: PURPLE,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  summaryLine: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  exerciseList: {
    gap: 8,
    marginBottom: 4,
  },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: WHITE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: PURPLE,
    marginTop: 6,
  },
  exerciseCopy: { flex: 1 },
  exerciseName: { color: TEXT, fontSize: 13, fontWeight: "800" },
  exerciseCue: { color: MUTED, fontSize: 11, marginTop: 2 },
  guidedBtn: {
    marginTop: 12,
    backgroundColor: PURPLE,
    borderRadius: 12,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  guidedBtnCompleted: {
    backgroundColor: GREEN,
    opacity: 0.92,
  },
  guidedBtnText: { color: WHITE, fontSize: 14, fontWeight: "900" },
});
