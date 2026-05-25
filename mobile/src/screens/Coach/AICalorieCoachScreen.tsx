import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ensureDailyCalorieLog } from "../../api/caloriesLog";
import { getSummary } from "../../api/dashboard";
import { AICoachCard } from "../../components/Coach/AICoachCard";
import { ActionPlanCard } from "../../components/Coach/ActionPlanCard";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useAppTheme } from "../../theme";
import type { NutritionData } from "../../types/coach";
import type { CoachStackParamList } from "./CoachHomeScreen";

export default function AICalorieCoachScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { colors, radius } = useAppTheme();
  const [nutritionData, setNutritionData] = useState<NutritionData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [day, summary] = await Promise.all([ensureDailyCalorieLog(), getSummary()]);
      setNutritionData({
        goal: "maintain",
        tdee: Number(day.log.target_calories || 0),
        caloriesConsumed: Number(day.log.total_calories || 0),
        proteinG: Number(day.log.total_protein_g || 0),
        carbsG: Number(day.log.total_carbs_g || 0),
        fatG: Number(day.log.total_fat_g || 0),
        fiberG: Number(day.log.total_fiber_g || 0),
        waterMl: Math.round(Number(day.water.total_water_l || 0) * 1000),
        proteinTargetG: Number(day.log.target_protein_g || 0),
        carbsTargetG: Number(day.log.target_carbs_g || 0),
        fatTargetG: Number(day.log.target_fat_g || 0),
        waterTargetMl: Math.round(Number(day.water.target_water_l || day.log.target_water_l || 2.5) * 1000),
        burnedKcal: Number(summary?.caloriesBurned || 0),
        mealsLogged: Array.isArray(day.meals) ? day.meals.length : 0,
      });
    } catch {
      setNutritionData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={[styles.backBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.md }]}>
          <Text style={[styles.backTxt, { color: colors.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>AI Calorie Coach</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {!nutritionData && !loading ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Log your meals first to get AI insights</Text>
            <Text style={[styles.emptySub, { color: colors.muted }]}>Once nutrition data exists for today, coaching and action tasks will appear.</Text>
          </View>
        ) : null}
        <AICoachCard nutritionData={nutritionData} accentColor="#22d3ee" onNutritionRefresh={() => void load()} />
        <ActionPlanCard nutritionData={nutritionData} accentColor="#a78bfa" />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 99,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  backTxt: { fontSize: 20 },
  title: { fontSize: 20, fontWeight: "600" },
  emptyBox: { borderWidth: 1, padding: 16, marginBottom: 12 },
  emptyTitle: { fontSize: 14, fontWeight: "600" },
  emptySub: { fontSize: 12, marginTop: 4, lineHeight: 18 },
});
