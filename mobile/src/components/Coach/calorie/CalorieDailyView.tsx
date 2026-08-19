import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useOnboardingContext } from "../../../hooks/OnboardingContext";
import type { CoachSummaryResponse } from "../../../types/coachSummary";
import { isNutritionDay } from "../../../types/coachSummary";
import { CoachInsightNoteFromKey } from "../shared/CoachInsightNote";
import { CoachNutritionHero } from "../shared/CoachNutritionHero";
import { CoachPartialPeriodBanner } from "../shared/CoachPartialPeriodBanner";
import { MacroBreakdownSection, MacroGapSection } from "../shared/MacroBreakdownSection";

type MacroKey = "protein" | "carbs" | "fat";

function getMacroFoods(dietType: string): Record<MacroKey, string[]> {
  const isVegan = dietType === "vegan";
  const isVegetarian = dietType === "vegetarian" || isVegan;
  const protein = isVegan
    ? ["Almonds 30g", "Dal 150g", "Tofu 100g", "Peanut butter", "Edamame"]
    : isVegetarian
      ? ["Paneer 80g", "2 Eggs", "Greek yogurt", "Dal 150g", "Almonds"]
      : ["Paneer 80g", "2 Eggs", "Chicken 120g", "Greek yogurt", "Tuna"];
  return {
    protein,
    carbs: ["Brown rice", "2 Roti", "Oats 80g", "Sweet potato", "Banana"],
    fat: ["Almonds", "Olive oil", "Avocado", "Coconut", "Peanut butter"],
  };
}

type Props = {
  summary: CoachSummaryResponse;
};

export function CalorieDailyView({ summary }: Props) {
  const { t } = useTranslation();
  const { profile } = useOnboardingContext();
  const day = summary.daily;
  const focus = summary.notes?.find((n) => n.kind === "todays_focus");

  const foodChips = useMemo(
    () => getMacroFoods(profile?.dietary?.diet_type ?? "non_vegetarian"),
    [profile?.dietary?.diet_type],
  );

  if (!day || !isNutritionDay(day)) return null;

  if (!day.logged) {
    return (
      <View>
        <CoachNutritionHero
          score={0}
          title={t(day.score_label_key)}
          subtitle={t("coach.summary.nutrition.daily.heroSubtitle")}
          statLeft={{ value: "0", label: t("coach.calorie.card.eaten") }}
          statRight={{ value: String(Math.round(day.target_calories)), label: t("coach.calorie.card.left") }}
        />
        <CoachPartialPeriodBanner message={t("coach.summary.partial.noMealsToday")} />
        <CoachInsightNoteFromKey
          noteKey="coach.summary.nutrition.daily.focusLogMeals"
          label={t("coach.summary.nutrition.daily.focusLabel")}
          variant="green"
        />
      </View>
    );
  }

  const gaps = (["protein", "carbs", "fat"] as MacroKey[]).filter((k) => day.macro_status[k] === "low");

  return (
    <View>
      <CoachNutritionHero
        score={day.score}
        title={t(day.score_label_key)}
        subtitle={t("coach.summary.nutrition.daily.heroSubtitle")}
        statLeft={{ value: String(Math.round(day.calories)), label: t("coach.calorie.card.eaten") }}
        statRight={{ value: String(Math.round(day.calories_remaining)), label: t("coach.calorie.card.left") }}
      />
      {focus ? (
        <CoachInsightNoteFromKey
          noteKey={focus.key}
          params={focus.params}
          label={t("coach.summary.nutrition.daily.focusLabel")}
          variant="green"
        />
      ) : null}
      <MacroBreakdownSection
        values={{ protein: day.protein_g, carbs: day.carbs_g, fat: day.fat_g }}
        targets={{ protein: day.target_protein_g, carbs: day.target_carbs_g, fat: day.target_fat_g }}
        statuses={day.macro_status}
      />
      <MacroGapSection
        gaps={gaps}
        values={{ protein: day.protein_g, carbs: day.carbs_g, fat: day.fat_g }}
        targets={{ protein: day.target_protein_g, carbs: day.target_carbs_g, fat: day.target_fat_g }}
        foodChips={foodChips}
      />
    </View>
  );
}

const styles = StyleSheet.create({});
