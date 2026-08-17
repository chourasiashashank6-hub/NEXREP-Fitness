import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { CalorieDayPayload } from "../api/caloriesLog";
import type { MealDayPlan, WorkoutPlanCurrent } from "../types/planner";
import { calcExerciseEstimateKcal } from "../utils/sessionCalories";
import {
  buildMuscleRecoveryGroups,
  firstSoreFocusMuscle,
} from "../utils/muscleRecoveryFromHistory";
import { isWorkoutRestDay } from "../utils/workoutRestDay";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#8A8A84";
const BORDER = "#E8E6E1";

type WorkoutHistoryRow = {
  date: string;
  exerciseName?: string;
  type?: string;
  notes?: string | null;
  bodyPart?: string | null;
};

type Props = {
  dailyGoal: number;
  restDayActive: boolean;
  hasWorkoutPlannerAccess: boolean;
  hasMealPlannerAccess: boolean;
  todayWorkoutPlan: WorkoutPlanCurrent | null;
  todayMealPlan: MealDayPlan | null;
  calorieDay: CalorieDayPayload | null;
  workoutHistory: WorkoutHistoryRow[];
  weightKg: number;
  equipmentItems: string[];
  ingredientNames: string[];
};

const formatNum = (v: number) => Math.round(v || 0).toLocaleString();

function joinNames(names: string[]): string {
  return names.map((n) => n.trim()).filter(Boolean).join(", ");
}

function ChipRow({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (!items.length) {
    return <Text style={styles.chipEmpty}>{emptyText}</Text>;
  }
  return (
    <View style={styles.chipRow}>
      {items.map((item) => (
        <View key={item} style={styles.chip}>
          <Text style={styles.chipText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function DailyGamePlanCard({
  dailyGoal,
  restDayActive,
  hasWorkoutPlannerAccess,
  hasMealPlannerAccess,
  todayWorkoutPlan,
  todayMealPlan,
  calorieDay,
  workoutHistory,
  weightKg,
  equipmentItems,
  ingredientNames,
}: Props) {
  const { t } = useTranslation();

  const hasGeneratedWorkoutPlan = Boolean(todayWorkoutPlan?.plan_id);
  const todayPlanDay = todayWorkoutPlan?.today ?? null;
  const focusMuscles = todayPlanDay?.focus_muscles ?? [];
  const exercises = !todayPlanDay || isWorkoutRestDay(todayPlanDay) ? [] : todayPlanDay.exercises ?? [];

  const estimatedWorkoutKcal = useMemo(() => {
    if (!exercises.length || restDayActive) return 0;
    const kg = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 70;
    return exercises.reduce((sum, ex) => sum + calcExerciseEstimateKcal(ex.name, Number(ex.sets) || 0, kg), 0);
  }, [exercises, restDayActive, weightKg]);

  const recoveryNote = useMemo(() => {
    if (restDayActive || !focusMuscles.length) return null;
    const groups = buildMuscleRecoveryGroups(workoutHistory);
    const sore = firstSoreFocusMuscle(groups, focusMuscles);
    if (!sore) return null;
    return t("home.gamePlan.recoveryNote", {
      muscle: sore.name,
      day: sore.lastTrainedLabel,
    });
  }, [restDayActive, focusMuscles, workoutHistory, t]);

  const exerciseLine = joinNames(exercises.map((ex) => ex.name));
  const muscleLine = joinNames(focusMuscles);

  const plannedMealNames = useMemo(() => {
    const planned = todayMealPlan?.meals ?? [];
    if (planned.length) {
      return planned.map((meal) => meal.recipe_name || meal.items?.[0]?.food || meal.meal_type.replace(/_/g, " "));
    }
    const logged = calorieDay?.meals ?? [];
    const visible = hasMealPlannerAccess ? logged : logged.filter((m) => m.source_type !== "meal_planner");
    return visible.map((m) => m.food_name).filter(Boolean);
  }, [todayMealPlan?.meals, calorieDay?.meals, hasMealPlannerAccess]);

  const mealMacros = useMemo(() => {
    if (todayMealPlan) {
      return {
        protein: Number(todayMealPlan.total_protein_g || 0),
        carbs: Number(todayMealPlan.total_carbs_g || 0),
        fat: Number(todayMealPlan.total_fat_g || 0),
      };
    }
    const log = calorieDay?.log;
    return {
      protein: Number(log?.total_protein_g || 0),
      carbs: Number(log?.total_carbs_g || 0),
      fat: Number(log?.total_fat_g || 0),
    };
  }, [todayMealPlan, calorieDay?.log]);

  const mealLine = joinNames(plannedMealNames);
  const hasMealPlanData = Boolean(todayMealPlan?.meals?.length);

  const mealCount = useMemo(() => {
    if (todayMealPlan?.meals?.length) return todayMealPlan.meals.length;
    const logged = calorieDay?.meals ?? [];
    const visible = hasMealPlannerAccess ? logged : logged.filter((m) => m.source_type !== "meal_planner");
    return visible.length;
  }, [todayMealPlan?.meals, calorieDay?.meals, hasMealPlannerAccess]);

  let workoutBody: string;
  if (restDayActive) {
    workoutBody = t("home.restDayNoSession");
  } else if (hasWorkoutPlannerAccess && !hasGeneratedWorkoutPlan) {
    workoutBody = t("home.gamePlan.noWorkoutPlan");
  } else if (!exerciseLine) {
    workoutBody = t("home.gamePlan.noWorkoutPlan");
  } else {
    workoutBody = exerciseLine;
  }

  const equipmentEmptyText =
    restDayActive || !exerciseLine
      ? t("home.gamePlan.noEquipmentNeeded")
      : t("home.gamePlan.noEquipmentMatched");

  const ingredientsEmptyText = hasMealPlanData
    ? t("home.gamePlan.noIngredientsListed")
    : hasMealPlannerAccess
      ? t("home.gamePlan.noMealPlan")
      : t("home.gamePlan.noMealsLoggedFree");

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("home.gamePlan.title")}</Text>

      <View style={styles.statsRow}>
        <DualStatPill
          accent={GREEN}
          items={[
            {
              icon: "barbell-outline",
              label: t("home.gamePlan.exerciseCount"),
              value: restDayActive ? "—" : String(exercises.length),
            },
            {
              icon: "nutrition-outline",
              label: t("home.gamePlan.mealCount"),
              value: mealCount > 0 ? String(mealCount) : "—",
            },
          ]}
        />
        <StatPill
          icon="flame-outline"
          label={t("home.gamePlan.estBurn")}
          value={restDayActive ? "—" : formatNum(estimatedWorkoutKcal)}
          accent={ORANGE}
        />
        <StatPill
          icon="restaurant-outline"
          label={t("home.toEat")}
          value={formatNum(dailyGoal)}
          accent={GREEN}
        />
      </View>

      {recoveryNote ? (
        <View style={styles.recoveryBanner}>
          <Text style={styles.recoveryText}>{recoveryNote}</Text>
        </View>
      ) : null}

      <View style={styles.workoutZone}>
        <Text style={styles.zoneTitle}>{t("home.gamePlan.workoutTitle")}</Text>
        {!restDayActive && todayPlanDay && exerciseLine ? (
          <Text style={styles.meta}>
            {t("home.gamePlan.workoutMeta", {
              split: todayPlanDay.split_name,
              muscles: muscleLine || "—",
              minutes: todayPlanDay.estimated_duration_min,
            })}
          </Text>
        ) : null}
        <Text style={styles.prose}>{workoutBody}</Text>
        <View style={styles.zoneDivider} />
        <Text style={styles.prepTitle}>{t("home.gamePlan.equipmentTitle")}</Text>
        <ChipRow items={equipmentItems} emptyText={equipmentEmptyText} />
      </View>

      <View style={styles.mealsZone}>
        <Text style={styles.zoneTitle}>{t("home.gamePlan.mealsTitle")}</Text>
        {mealLine ? (
          <>
            <Text style={styles.prose}>{mealLine}</Text>
            <Text style={styles.meta}>
              {t("home.gamePlan.macros", {
                protein: formatNum(mealMacros.protein),
                carbs: formatNum(mealMacros.carbs),
                fat: formatNum(mealMacros.fat),
              })}
            </Text>
          </>
        ) : (
          <Text style={styles.prose}>
            {hasMealPlannerAccess ? t("home.gamePlan.noMealPlan") : t("home.gamePlan.noMealsLoggedFree")}
          </Text>
        )}
        <View style={styles.zoneDivider} />
        <Text style={styles.prepTitle}>{t("home.gamePlan.ingredientsTitle")}</Text>
        <ChipRow items={ingredientNames} emptyText={ingredientsEmptyText} />
      </View>
    </View>
  );
}

function DualStatPill({
  accent,
  items,
}: {
  accent: string;
  items: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[];
}) {
  return (
    <View style={styles.statPill}>
      {items.map((item, index) => (
        <View key={item.label} style={index > 0 ? styles.statPairSpaced : undefined}>
          <View style={styles.statTop}>
            <Ionicons name={item.icon} size={12} color={accent} />
            <Text style={styles.statLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
          <Text style={[styles.statValue, styles.statValueCompact, { color: accent }]}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function StatPill({
  icon,
  label,
  value,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <View style={styles.statPill}>
      <View style={styles.statTop}>
        <Ionicons name={icon} size={12} color={accent} />
        <Text style={styles.statLabel} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: WHITE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 14,
  },
  title: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statPill: {
    flex: 1,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 64,
    justifyContent: "center",
  },
  statPairSpaced: { marginTop: 8 },
  statTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4,
  },
  statValueCompact: {
    fontSize: 16,
    marginTop: 2,
  },
  workoutZone: {
    borderLeftWidth: 3,
    borderLeftColor: ORANGE,
    backgroundColor: ORANGE_LIGHT,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  mealsZone: {
    borderLeftWidth: 3,
    borderLeftColor: GREEN,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  zoneTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  prepTitle: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  zoneDivider: {
    height: 1,
    backgroundColor: "rgba(26, 26, 24, 0.08)",
    marginVertical: 4,
  },
  prose: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  meta: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    backgroundColor: WHITE,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(26, 26, 24, 0.06)",
  },
  chipText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
  },
  chipEmpty: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  recoveryBanner: {
    backgroundColor: "#FFF8E6",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#F5E6B8",
  },
  recoveryText: {
    color: "#8A6D1B",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
});
