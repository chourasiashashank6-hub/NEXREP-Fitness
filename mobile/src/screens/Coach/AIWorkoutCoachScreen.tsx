import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { todayLocal } from "../../api/caloriesLog";
import { CoachCadenceSelector } from "../../components/Coach/CoachCadenceSelector";
import { WorkoutCoachSummaryViews } from "../../components/Coach/workout/WorkoutCoachSummaryViews";
import { CoachCadencePager } from "../../components/Coach/CoachCadencePager";
import { RefreshCountPill } from "../../components/Coach/shared/RefreshCountPill";
import { ScreenContainer } from "../../components/ScreenContainer";
import { WC_COLORS } from "../../constants/workoutCoach";
import { useCoachCadence } from "../../hooks/useCoachCadence";
import { useRefreshUsageCount } from "../../hooks/useRefreshUsageCount";
import type { CoachStackParamList } from "./CoachHomeScreen";
import { coachRefreshUsageKey } from "../../utils/refreshUsageCounter";
import { refreshScopeLabel } from "../../utils/refreshScopeLabel";

export default function AIWorkoutCoachScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { cadence, setCadence, isCadenceLocked, handleYearlyPress } = useCoachCadence();
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const logDate = todayLocal();
  const refreshUsageKey = useMemo(
    () => coachRefreshUsageKey("workout", cadence, logDate),
    [cadence, logDate],
  );
  const { count: refreshUsageCount, increment: incrementRefreshUsage } = useRefreshUsageCount(refreshUsageKey);

  const handleRefresh = () => {
    void incrementRefreshUsage();
    setSummaryRefresh((n) => n + 1);
  };

  return (
    <ScreenContainer bg={WC_COLORS.SCREEN_BG} scroll={false} contentStyle={styles.screenContent}>
      <View style={styles.body}>
        <View style={styles.topHeader}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={WC_COLORS.TEXT} />
          </Pressable>
          <Text style={styles.headerTitle}>{t("coach.workout.title")}</Text>
          <RefreshCountPill
            scopeLabel={refreshScopeLabel(cadence, t)}
            count={refreshUsageCount}
            accentColor={WC_COLORS.PURPLE_MID}
            accentLightBg={WC_COLORS.PURPLE_LIGHT}
            onPress={handleRefresh}
            accessibilityLabel={t("coach.common.refresh")}
          />
          <View style={styles.onlineDot} />
        </View>
        <CoachCadenceSelector
          value={cadence}
          accentColor={WC_COLORS.PURPLE_MID}
          onChange={setCadence}
          onYearlyPress={handleYearlyPress}
          isCadenceLocked={isCadenceLocked}
        />
        <View style={styles.cadenceBody}>
          <CoachCadencePager
            cadence={cadence}
            accentColor={WC_COLORS.PURPLE_MID}
            isCadenceLocked={isCadenceLocked}
            onCadenceChange={setCadence}
            onYearlyPress={handleYearlyPress}
            renderSummary={(value) => (
              <WorkoutCoachSummaryViews cadence={value} activeCadence={cadence} refreshToken={summaryRefresh} />
            )}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 0 },
  body: { flex: 1, minHeight: 0 },
  cadenceBody: { flex: 1, minHeight: 0 },
  topHeader: { flexDirection: "row", alignItems: "center", paddingBottom: 10, gap: 8 },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
    backgroundColor: WC_COLORS.BG,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, color: WC_COLORS.TEXT, fontSize: 16, fontWeight: "800" },
  onlineDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: WC_COLORS.GREEN },
});
