import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ONBOARDING_COLORS } from "../../constants/onboarding";
import { loadOnboardingWithFallback } from "../../api/onboarding";
import { useAuthStore } from "../../store/authStore";

export default function ResultsScreen({ navigation }: any) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const { width } = useWindowDimensions();
  const twoCol = width >= 900;
  const [profile, setProfile] = useState<any>(null);
  const [targets, setTargets] = useState<any>(null);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const { profile, targets } = await loadOnboardingWithFallback(token);
      setProfile(profile);
      setTargets(targets);
    })();
  }, [token]);

  const macroWidths = useMemo(() => {
    if (!targets) return { p: 33, c: 33, f: 34 };
    return { p: targets.macros.protein_pct, c: targets.macros.carbs_pct, f: targets.macros.fat_pct };
  }, [targets]);

  if (!profile || !targets) return <View style={styles.safe} />;

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.grid, twoCol ? styles.gridTwo : null]}>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t("onboarding.results.yourDetails")}</Text>
            {row(t("onboarding.results.biologicalSex"), profile.personal.sex || t("onboarding.results.notProvided"))}
            {row(t("onboarding.results.age"), profile.personal.age ? `${profile.personal.age}` : t("onboarding.results.notProvided"))}
            {row(t("onboarding.results.height"), profile.personal.unit_system === "metric" ? `${profile.personal.height_cm ?? "-"} cm` : `${profile.personal.height_in ?? "-"} in`)}
            {row(t("onboarding.results.currentWeight"), profile.personal.unit_system === "metric" ? `${profile.personal.weight_kg ?? "-"} kg` : `${profile.personal.weight_lb ?? "-"} lbs`)}
            {row(t("onboarding.results.bodyFat"), profile.personal.body_fat_percentage ? `${profile.personal.body_fat_percentage}%` : t("onboarding.results.notProvided"))}
            {row(t("onboarding.results.activityLevel"), profile.activity.level || t("onboarding.results.notProvided"))}
            {row(t("onboarding.results.goal"), profile.goal.type || t("onboarding.results.notProvided"))}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t("onboarding.results.calculatedTargets")}</Text>
            <View style={styles.energyRow}>
              <View style={styles.energyCard}><Text style={styles.energyLabel}>{t("onboarding.results.bmr")}</Text><Text style={styles.energyValue}>{targets.bmr.value_kcal}</Text><Text style={styles.energyUnit}>{t("onboarding.results.kcal")}</Text></View>
              <View style={styles.energyCard}><Text style={styles.energyLabel}>{t("onboarding.results.tdee")}</Text><Text style={styles.energyValue}>{targets.tdee.value_kcal}</Text><Text style={styles.energyUnit}>{t("onboarding.results.kcal")}</Text></View>
            </View>
            <View style={styles.targetCard}>
              <Text style={styles.targetLabel}>{t("onboarding.results.dailyCalorieTarget")}</Text>
              <Text style={styles.targetValue}>{targets.target_kcal}</Text>
              <Text style={styles.targetUnit}>{t("onboarding.results.kcalPerDay")}</Text>
            </View>

            <Text style={styles.section}>{t("onboarding.results.macroSplit")}</Text>
            <View style={styles.bar}>
              <View style={[styles.seg, { flex: macroWidths.p, backgroundColor: ONBOARDING_COLORS.protein }]} />
              <View style={[styles.seg, { flex: macroWidths.c, backgroundColor: ONBOARDING_COLORS.carbs }]} />
              <View style={[styles.seg, { flex: macroWidths.f, backgroundColor: ONBOARDING_COLORS.fat }]} />
            </View>
            {row(t("onboarding.results.protein"), `${targets.macros.protein_g}g (${targets.macros.protein_kcal}kcal)`)}
            {row(t("onboarding.results.carbohydrates"), `${targets.macros.carbs_g}g (${targets.macros.carbs_kcal}kcal)`)}
            {row(t("onboarding.results.fat"), `${targets.macros.fat_g}g (${targets.macros.fat_kcal}kcal)`)}
            {row(t("onboarding.results.fiberTarget"), `${targets.macros.fiber_g}g`)}
            {row(t("onboarding.results.waterMinimum"), `${targets.macros.water_l}L`)}

            <Text style={styles.section}>{t("onboarding.results.timeline")}</Text>
            {row(t("onboarding.results.formulaUsed"), targets.bmr.formula_used)}
            {row(t("onboarding.results.deficitSurplus"), `${targets.timeline.daily_delta_kcal} kcal`)}
            {row(t("onboarding.results.expectedRate"), targets.timeline.pace_label)}
            {row(t("onboarding.results.weeksToGoal"), targets.timeline.weeks_to_goal ? String(targets.timeline.weeks_to_goal) : "-" )}
            {row(t("onboarding.results.safetyFloor"), `${targets.safety.floor_kcal} kcal`)}

            <View style={styles.coachBox}><Text style={styles.coachLabel}>{t("onboarding.results.aiCoach")}</Text><Text style={styles.coachText}>{targets.coach_message}</Text></View>
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}><Pressable style={styles.startBtn} onPress={() => navigation.navigate("Main")}><Text style={styles.startText}>{t("onboarding.results.startTracking")}</Text></Pressable></View>
    </View>
  );
}

const row = (k: string, v: string) => <View style={styles.row} key={k}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ONBOARDING_COLORS.bg },
  scroll: { padding: 16, paddingBottom: 88 },
  grid: { gap: 12 },
  gridTwo: { flexDirection: "row" },
  panel: { flex: 1, backgroundColor: ONBOARDING_COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: ONBOARDING_COLORS.border, padding: 14 },
  panelTitle: { color: ONBOARDING_COLORS.textPrimary, fontSize: 18, fontWeight: "700", marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: ONBOARDING_COLORS.border, paddingVertical: 8, gap: 10 },
  k: { color: ONBOARDING_COLORS.textSecondary, fontSize: 13, flex: 1 },
  v: { color: ONBOARDING_COLORS.textPrimary, fontSize: 13, fontWeight: "600", textAlign: "right", flex: 1 },
  energyRow: { flexDirection: "row", gap: 8 },
  energyCard: { flex: 1, backgroundColor: ONBOARDING_COLORS.bg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: ONBOARDING_COLORS.border },
  energyLabel: { color: ONBOARDING_COLORS.textSecondary, fontSize: 12 },
  energyValue: { color: ONBOARDING_COLORS.textPrimary, fontSize: 24, fontWeight: "700" },
  energyUnit: { color: ONBOARDING_COLORS.textTertiary, fontSize: 12 },
  targetCard: { marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: ONBOARDING_COLORS.border, padding: 14 },
  targetLabel: { color: ONBOARDING_COLORS.textSecondary, fontSize: 13 },
  targetValue: { color: ONBOARDING_COLORS.primary, fontSize: 40, fontWeight: "700", marginTop: 2 },
  targetUnit: { color: ONBOARDING_COLORS.textSecondary, fontSize: 13 },
  section: { color: ONBOARDING_COLORS.textPrimary, fontSize: 15, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  bar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 8 },
  seg: { height: "100%" },
  coachBox: { backgroundColor: ONBOARDING_COLORS.coachBg, borderRadius: 10, padding: 12, marginTop: 10 },
  coachLabel: { color: ONBOARDING_COLORS.primary, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
  coachText: { color: ONBOARDING_COLORS.coachText, fontSize: 13, lineHeight: 20 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, borderTopWidth: 1, borderTopColor: ONBOARDING_COLORS.border, backgroundColor: ONBOARDING_COLORS.bg },
  startBtn: { height: 52, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  startText: { color: ONBOARDING_COLORS.bg, fontSize: 15, fontWeight: "600" },
});
