import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { ensureDailyCalorieLog, todayLocal } from "../../api/caloriesLog";
import { getSummary } from "../../api/dashboard";
import { ActionPlanCard } from "../../components/Coach/ActionPlanCard";
import { CalorieCoachSummaryViews } from "../../components/Coach/calorie/CalorieCoachSummaryViews";
import { CoachCadencePager } from "../../components/Coach/CoachCadencePager";
import { CoachCadenceSelector } from "../../components/Coach/CoachCadenceSelector";
import { RefreshCountPill } from "../../components/Coach/shared/RefreshCountPill";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useCoachCadence } from "../../hooks/useCoachCadence";
import { useRefreshUsageCount } from "../../hooks/useRefreshUsageCount";
import type { NutritionData } from "../../types/coach";
import { coachRefreshUsageKey } from "../../utils/refreshUsageCounter";
import { refreshScopeLabel } from "../../utils/refreshScopeLabel";
import { SESSION_DATA_STALE_MS } from "../../utils/sessionDataCache";
import { useActivityDataRefreshStore } from "../../store/activityDataRefreshStore";
import type { CoachStackParamList } from "./CoachHomeScreen";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const BG = "#F7F6F3";
const BORDER = "#ECEAE5";

export default function AICalorieCoachScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { cadence, setCadence, isCadenceLocked, handleYearlyPress } = useCoachCadence();
  const [nutritionData, setNutritionData] = useState<NutritionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const logDate = todayLocal();
  const lastNutritionLoadAt = useRef(0);
  const activityRefreshVersion = useActivityDataRefreshStore((s) => s.version);
  const refreshUsageKey = useMemo(
    () => coachRefreshUsageKey("nutrition", cadence, logDate),
    [cadence, logDate],
  );
  const { count: refreshUsageCount, increment: incrementRefreshUsage } = useRefreshUsageCount(refreshUsageKey);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const now = Date.now();
    if (!opts?.force && lastNutritionLoadAt.current > 0 && now - lastNutritionLoadAt.current < SESSION_DATA_STALE_MS) {
      return;
    }
    try {
      if (!nutritionData) setLoading(true);
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
      lastNutritionLoadAt.current = Date.now();
    } catch {
      setNutritionData(null);
    } finally {
      setLoading(false);
    }
  }, [logDate, nutritionData]);

  useEffect(() => {
    void load({ force: true });
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (activityRefreshVersion === 0) return;
    lastNutritionLoadAt.current = 0;
    void load({ force: true });
  }, [activityRefreshVersion, load]);

  const handleRefresh = () => {
    void incrementRefreshUsage();
    setSummaryRefresh((n) => n + 1);
    void load({ force: true });
  };

  return (
    <ScreenContainer bg={WHITE} scroll={false} contentStyle={styles.screenContent}>
      <View style={styles.body}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={TEXT} />
          </Pressable>
          <Text style={styles.title}>{t("coach.calorie.title")}</Text>
          <RefreshCountPill
            scopeLabel={refreshScopeLabel(cadence, t)}
            count={refreshUsageCount}
            accentColor={GREEN}
            accentLightBg={GREEN_LIGHT}
            loading={loading}
            disabled={loading}
            onPress={handleRefresh}
            accessibilityLabel={t("coach.common.refresh")}
          />
          <View style={styles.onlineDot} />
        </View>
        <CoachCadenceSelector
          value={cadence}
          accentColor={GREEN}
          onChange={setCadence}
          onYearlyPress={handleYearlyPress}
          isCadenceLocked={isCadenceLocked}
        />
        {!nutritionData && !loading ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>{t("coach.calorie.emptyTitle")}</Text>
            <Text style={styles.emptySub}>{t("coach.calorie.emptySubtitle")}</Text>
          </View>
        ) : null}
        <View style={styles.cadenceBody}>
          <CoachCadencePager
            cadence={cadence}
            accentColor={GREEN}
            isCadenceLocked={isCadenceLocked}
            onCadenceChange={setCadence}
            onYearlyPress={handleYearlyPress}
            renderSummary={(value) => (
              <>
                <CalorieCoachSummaryViews cadence={value} activeCadence={cadence} refreshToken={summaryRefresh} />
                {value === "daily" ? (
                  <ActionPlanCard nutritionData={nutritionData} accentColor="#a78bfa" />
                ) : null}
              </>
            )}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1, paddingBottom: 0 },
  body: { flex: 1, minHeight: 0 },
  cadenceBody: { flex: 1, minHeight: 0 },
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
  onlineDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: GREEN },
  emptyBox: { borderWidth: 1, borderColor: BORDER, backgroundColor: BG, borderRadius: 16, padding: 16, marginBottom: 12 },
  emptyTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  emptySub: { color: MUTED, fontSize: 12, marginTop: 4, lineHeight: 18 },
});
