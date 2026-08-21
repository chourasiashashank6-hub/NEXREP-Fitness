import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

type Props = {
  staleFields: string[];
  onRegenerate: () => void;
  regenerating?: boolean;
};

const AMBER = "#D97706";
const AMBER_LIGHT = "#FFFBEB";
const AMBER_BORDER = "#FCD34D";

/** Human-readable labels for onboarding snapshot field keys. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  age: "stalePlan.fields.age",
  biological_sex: "stalePlan.fields.biological_sex",
  height_cm: "stalePlan.fields.height_cm",
  current_weight_kg: "stalePlan.fields.current_weight_kg",
  primary_goal: "stalePlan.fields.primary_goal",
  goal_pace: "stalePlan.fields.goal_pace",
  target_weight_kg: "stalePlan.fields.target_weight_kg",
  daily_activity_level: "stalePlan.fields.daily_activity_level",
  diet_type: "stalePlan.fields.diet_type",
  food_allergies: "stalePlan.fields.food_allergies",
  meals_per_day: "stalePlan.fields.meals_per_day",
  difficulty: "stalePlan.fields.difficulty",
  body_type_current: "stalePlan.fields.body_type_current",
  body_type_goal: "stalePlan.fields.body_type_goal",
  body_type_problem_areas: "stalePlan.fields.body_type_problem_areas",
  workouts_per_week: "stalePlan.fields.workouts_per_week",
  workout_types: "stalePlan.fields.workout_types",
  muscle_focus: "stalePlan.fields.muscle_focus",
  _legacy_no_snapshot: "stalePlan.fields.legacyProfile",
};

export function StalePlanBanner({ staleFields, onRegenerate, regenerating = false }: Props) {
  const { t } = useTranslation();

  if (!staleFields || staleFields.length === 0) return null;

  const labels = staleFields.map((f) =>
    FIELD_LABEL_KEYS[f] ? t(FIELD_LABEL_KEYS[f]) : f
  );
  const fieldList = labels.join(", ");

  return (
    <View style={styles.banner}>
      <View style={styles.textBlock}>
        <Text style={styles.title}>{t("stalePlan.bannerTitle")}</Text>
        <Text style={styles.body}>{t("stalePlan.bannerBody", { fields: fieldList })}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onRegenerate}
        disabled={regenerating}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("stalePlan.regenerate")}
        accessibilityState={{ disabled: regenerating }}
      >
        {regenerating ? (
          <ActivityIndicator size="small" color={AMBER} />
        ) : (
          <Text style={styles.buttonText}>{t("stalePlan.regenerate")}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: AMBER_LIGHT,
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  textBlock: { flex: 1, gap: 4 },
  title: { fontSize: 13, fontWeight: "700", color: AMBER },
  body: { fontSize: 12, color: "#78350F", lineHeight: 17 },
  button: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: AMBER,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 44,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: { fontSize: 12, fontWeight: "700", color: AMBER },
});
