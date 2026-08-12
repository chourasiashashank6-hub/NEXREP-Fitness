import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { ensureDailyCalorieLog, todayLocal } from "../../api/caloriesLog";
import { getSummary } from "../../api/dashboard";
import { AICoachCard } from "../../components/Coach/AICoachCard";
import { ActionPlanCard } from "../../components/Coach/ActionPlanCard";
import { ScreenContainer } from "../../components/ScreenContainer";
import type { AICoachResponse, NutritionData } from "../../types/coach";
import type { CoachStackParamList } from "./CoachHomeScreen";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const AMBER = "#FFB800";
const AMBER_LIGHT = "#FFF8E8";
const AMBER_TEXT = "#C08000";
const PURPLE = "#7B68CC";
const GOLD = "#FFD700";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";

export default function AICalorieCoachScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const coachCardRef = useRef<{ refresh: () => void } | null>(null);
  const [nutritionData, setNutritionData] = useState<NutritionData | null>(null);
  const [coachResult, setCoachResult] = useState<AICoachResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [coachRefreshing, setCoachRefreshing] = useState(false);

  const logDate = todayLocal();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [day, summary] = await Promise.all([ensureDailyCalorieLog(logDate), getSummary()]);
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
  }, [logDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScreenContainer bg={WHITE} contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>
        <Text style={styles.title}>{t("coach.calorie.title")}</Text>
        <Pressable
          style={[styles.refreshPill, coachRefreshing && styles.refreshPillDisabled]}
          onPress={() => coachCardRef.current?.refresh()}
          disabled={coachRefreshing}
        >
          {coachRefreshing ? <ActivityIndicator size="small" color={GREEN} /> : <Ionicons name="refresh" size={13} color={GREEN} />}
          <Text style={styles.refreshPillText}>{t("coach.common.refresh")}</Text>
        </Pressable>
        <View style={styles.onlineDot} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {!nutritionData && !loading ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>{t("coach.calorie.emptyTitle")}</Text>
            <Text style={styles.emptySub}>{t("coach.calorie.emptySubtitle")}</Text>
          </View>
        ) : null}
        <AICoachCard
          ref={coachCardRef}
          logDate={logDate}
          nutritionData={nutritionData}
          accentColor="#22d3ee"
          onNutritionRefresh={() => void load()}
          onCoachResult={setCoachResult}
          onLoadingChange={setCoachRefreshing}
        />
        <ActionPlanCard nutritionData={nutritionData} coachResult={coachResult} accentColor="#a78bfa" />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, color: TEXT, fontSize: 16, fontWeight: "900" },
  refreshPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: GREEN_LIGHT, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 7 },
  refreshPillDisabled: { opacity: 0.75 },
  refreshPillText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  onlineDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: GREEN },
  emptyBox: { borderWidth: 1, borderColor: BORDER, backgroundColor: BG, borderRadius: 16, padding: 16, marginBottom: 12 },
  emptyTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  emptySub: { color: MUTED, fontSize: 12, marginTop: 4, lineHeight: 18 },
});
