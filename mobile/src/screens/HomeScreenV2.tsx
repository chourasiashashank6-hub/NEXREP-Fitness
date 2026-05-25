import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { useFonts } from "expo-font";
import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from "@expo-google-fonts/dm-sans";
import type { CalorieDayPayload } from "../api/caloriesLog";
import { getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { fetchOnboardingMe } from "../api/onboarding";
import { getProfile } from "../api/user";
import { getWorkoutHistory } from "../api/workout";
import { computeUserCaloriePlan } from "../utils/calorieEngine";
import { useAuthStore } from "../store/authStore";

const BG_MAIN = "#080c12";
const BG_CARD = "#0f1620";
const BG_SURFACE = "rgba(255,255,255,0.03)";
const ACCENT_GREEN = "#00e5a0";
const ACCENT_BLUE = "#00aaff";
const ACCENT_RED = "#f87171";
const ACCENT_PURPLE = "#a78bfa";
const TEXT_PRIMARY = "#ffffff";
const TEXT_MUTED = "rgba(255,255,255,0.35)";
const TEXT_DIM = "rgba(255,255,255,0.15)";
const BORDER = "rgba(255,255,255,0.07)";

type BurnProfile = {
  name: string;
  gender: "male" | "female";
  age: number;
  height_cm: number;
  current_weight_kg: number;
  target_weight_kg: number;
  goal_tag: "Fat Loss" | "Muscle Gain" | "Strength";
  goal_pace: "slow" | "moderate" | "fast";
  activity_level: "sedentary" | "light" | "moderate" | "active" | "very_active";
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const formatNum = (v: number) => Math.round(v || 0).toLocaleString();
const ffDisplay = "BebasNeue_400Regular";
const ffBody = "DMSans_400Regular";
const ffMedium = "DMSans_500Medium";
const ffSemi = "DMSans_600SemiBold";

function computeGreeting(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "GOOD MORNING";
  if (h >= 12 && h < 17) return "GOOD AFTERNOON";
  if (h >= 17 && h < 21) return "GOOD EVENING";
  return "GOOD NIGHT";
}

function formatHeaderDate(now: Date): string {
  const f = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const p = f.formatToParts(now);
  const weekday = p.find((x) => x.type === "weekday")?.value ?? "";
  const month = p.find((x) => x.type === "month")?.value ?? "";
  const day = p.find((x) => x.type === "day")?.value ?? "";
  const year = p.find((x) => x.type === "year")?.value ?? "";
  return weekday && month && day && year ? `${weekday}, ${month} ${day} · ${year}` : f.format(now);
}

function formatDisplayName(raw: string | null | undefined): string {
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Athlete";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function toBurnProfile(onboarding: any): BurnProfile | null {
  if (!onboarding || typeof onboarding !== "object") return null;
  const personal = onboarding.personal || {};
  const goal = onboarding.goal || {};
  const activity = onboarding.activity || {};
  const name = typeof personal.name === "string" ? personal.name.trim() : "";
  const age = Number(personal.age);
  const heightCm = Number(personal.height_cm);
  const weightKg = Number(personal.weight_kg);
  const targetKg = Number(goal.target_weight_kg || personal.weight_kg);
  if (!name || !Number.isFinite(age) || !Number.isFinite(heightCm) || !Number.isFinite(weightKg)) return null;
  const goalTypeMap: Record<string, BurnProfile["goal_tag"]> = { fat_loss: "Fat Loss", muscle_gain: "Muscle Gain", strength: "Strength" };
  const paceMap: Record<string, BurnProfile["goal_pace"]> = { slow: "slow", moderate: "moderate", aggressive: "fast", fast: "fast" };
  const activityMap: Record<string, BurnProfile["activity_level"]> = {
    sedentary: "sedentary",
    lightly_active: "light",
    moderate: "moderate",
    moderately_active: "moderate",
    very_active: "active",
    extremely_active: "very_active",
    active: "active",
  };
  return {
    name,
    gender: personal.sex === "male" ? "male" : "female",
    age,
    height_cm: heightCm,
    current_weight_kg: weightKg,
    target_weight_kg: Number.isFinite(targetKg) ? targetKg : weightKg,
    goal_tag: goalTypeMap[String(goal.type || "").toLowerCase()] || "Fat Loss",
    goal_pace: paceMap[String(goal.pace || "").toLowerCase()] || "moderate",
    activity_level: activityMap[String(activity.level || "").toLowerCase()] || "moderate",
  };
}

export const HomeScreen = () => {
  const token = useAuthStore((s) => s.token);
  useFonts({ BebasNeue_400Regular, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold });
  const [headerGreeting, setHeaderGreeting] = useState(() => computeGreeting(new Date()));
  const [headerDateLabel, setHeaderDateLabel] = useState(() => formatHeaderDate(new Date()));
  const [headerName, setHeaderName] = useState("Athlete");
  const [calorieDay, setCalorieDay] = useState<CalorieDayPayload | null>(null);
  const [burnProfile, setBurnProfile] = useState<BurnProfile | null>(null);
  const [totalWorkoutBurn, setTotalWorkoutBurn] = useState(0);
  const [timelineTargets, setTimelineTargets] = useState<Record<string, unknown> | null>(null);

  const sectionAnim = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const ringAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(
      80,
      sectionAnim.map((a) =>
        Animated.timing(a, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ),
    ).start();
  }, [sectionAnim]);

  const load = useCallback(async () => {
    const now = new Date();
    setHeaderGreeting(computeGreeting(now));
    setHeaderDateLabel(formatHeaderDate(now));
    if (!token) {
      setHeaderName("Athlete");
      setCalorieDay(null);
      setBurnProfile(null);
      setTotalWorkoutBurn(0);
      setTimelineTargets(null);
      return;
    }
    try {
      const [dayRes, onboardingRes, historyRes, profileRes] = await Promise.all([
        getDailyCalorieLog(todayLocal()).catch(() => null),
        fetchOnboardingMe().catch(() => null),
        getWorkoutHistory(24 * 7).catch(() => ({ items: [] })),
        getProfile().catch(() => null),
      ]);
      const today = new Date();
      const burnedToday = (historyRes.items ?? []).reduce((sum, item) => {
        const d = item?.date ? new Date(item.date) : null;
        if (!d) return sum;
        const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
        return isToday ? sum + (Number(item.caloriesBurned) || 0) : sum;
      }, 0);
      setCalorieDay(dayRes);
      setBurnProfile(toBurnProfile(onboardingRes?.onboarding));
      setTotalWorkoutBurn(Math.max(0, Math.round(burnedToday)));
      setTimelineTargets((onboardingRes?.targets as Record<string, unknown>) ?? null);
      setHeaderName(formatDisplayName(profileRes?.name || onboardingRes?.onboarding?.personal?.name));
    } catch {
      Alert.alert("Error", "Could not load home dashboard.");
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const log = calorieDay?.log;
  const intake = Number(log?.total_calories || 0);
  const targetKcal = Number(log?.target_calories || 0);
  const caloriesBurned = Math.max(0, Math.round(totalWorkoutBurn));
  const burnPlan = burnProfile ? computeUserCaloriePlan(burnProfile) : null;
  const dailyGoal = burnPlan?.dailyCalorieTarget ?? targetKcal || 1800;
  const foodIntake = Number.isFinite(intake) ? Math.round(intake) : 0;
  const intakePercent = dailyGoal > 0 ? clamp01(foodIntake / dailyGoal) : 0;
  const kcalToBurn = Math.max(0, foodIntake - dailyGoal - caloriesBurned);
  const stillToBurn = kcalToBurn;
  const netCalorieGap = foodIntake - dailyGoal - caloriesBurned;
  const remainingIntakeToGoal = netCalorieGap < 0 ? Math.abs(netCalorieGap) : 0;
  const needsBurnFromExercise = netCalorieGap > 0;
  const summaryTargetLabel = needsBurnFromExercise ? "Still to burn" : "Remaining Intake";
  const summaryTargetValue = needsBurnFromExercise ? stillToBurn : remainingIntakeToGoal;
  const summaryTargetPercent = dailyGoal > 0 ? clamp01(summaryTargetValue / dailyGoal) : 0;

  const timeline = (timelineTargets?.timeline as Record<string, unknown> | undefined) ?? {};
  const weeksToGoalRaw = Number(timeline.weeks_to_goal);
  const weeksToGoal = Number.isFinite(weeksToGoalRaw) ? Math.max(0, Math.round(weeksToGoalRaw)) : 12;
  const kgPerWeek = Number(timeline.weekly_delta_kg);
  const kgPerWeekLabel = Number.isFinite(kgPerWeek) ? `~${Math.abs(kgPerWeek).toFixed(1)} kg/week` : "~0.5 kg/week";
  const kcalDeficit = Number(timeline.daily_delta_kcal);
  const kcalDeficitValue = Number.isFinite(kcalDeficit) ? Math.round(Math.abs(kcalDeficit)) : 500;
  const kcalDeltaLabel = !Number.isFinite(kcalDeficit)
    ? "Deficit"
    : kcalDeficit < 0
      ? "Deficit"
      : kcalDeficit > 0
        ? "Surplus"
        : "Maintenance";
  const milestoneProgress = clamp01((12 - Math.max(0, weeksToGoal)) / 12);
  const burnedPercent = dailyGoal > 0 ? clamp01(caloriesBurned / dailyGoal) : 0;

  useEffect(() => {
    Animated.timing(ringAnim, { toValue: burnedPercent, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
  }, [burnedPercent, ringAnim]);

  const ringSize = 80;
  const strokeWidth = 7;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = ringAnim.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });

  const animatedStyle = (idx: number) => ({
    opacity: sectionAnim[idx],
    transform: [{ translateY: sectionAnim[idx].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  const BrandWord = () => {
    if (Platform.OS === "web") {
      return (
        <Svg width={100} height={28} viewBox="0 0 100 28">
          <Defs>
            <SvgLinearGradient id="nexrepBrandGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={ACCENT_GREEN} />
              <Stop offset="100%" stopColor={ACCENT_BLUE} />
            </SvgLinearGradient>
          </Defs>
          <SvgText x="0" y="22" fill="url(#nexrepBrandGradient)" fontSize="22" letterSpacing="2" fontFamily={ffDisplay}>
            NexRep
          </SvgText>
        </Svg>
      );
    }
    return (
      <Text style={[styles.brandMask, { color: ACCENT_GREEN }]}>NexRep</Text>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.headerWrap, animatedStyle(0)]}>
          <View style={styles.brandRow}><BrandWord /></View>
          <Text style={styles.greeting}>{headerGreeting}</Text>
          <Text style={styles.userName}>{headerName}</Text>
          <View style={styles.datePill}><View style={styles.dateDot} /><Text style={styles.dateText}>{headerDateLabel}</Text></View>
        </Animated.View>

        <Animated.View style={animatedStyle(1)}>
          <Text style={styles.sectionLabel}>Goal Overview</Text>
          <View style={styles.card}>
            <LinearGradient colors={["#7c3aed", ACCENT_PURPLE, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.accentTop} />
            <View style={styles.cardBody}>
              <Text style={styles.cardMicro}>GOAL TIMELINE</Text>
              <Text style={styles.cardTitle}>Weeks to goal milestone</Text>
              <View style={styles.goalTopRow}>
                <View>
                  <View style={styles.goalWeeksLine}><Text style={styles.goalWeeks}>{weeksToGoal}</Text><Text style={styles.goalWeeksUnit}>weeks</Text></View>
                  <Text style={styles.goalSub}>{kgPerWeekLabel}</Text>
                </View>
                <View style={styles.goalRight}>
                  <Text style={styles.goalKcal}>{formatNum(kcalDeficitValue)} kcal</Text>
                  <Text style={styles.goalPerDay}>/day</Text>
                  <Text style={styles.goalSub}>{kcalDeltaLabel}</Text>
                </View>
              </View>
              <View style={styles.progressHead}><Text style={styles.cardMicro}>MILESTONE PROGRESS</Text><Text style={styles.progressPct}>{Math.round(milestoneProgress * 100)}%</Text></View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={["#7c3aed", ACCENT_PURPLE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${Math.round(milestoneProgress * 100)}%` }]} />
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View style={animatedStyle(2)}>
          <Text style={styles.sectionLabel}>Today's Burn</Text>
          <View style={styles.card}>
            <LinearGradient colors={["#ef4444", ACCENT_RED, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.accentTop} />
            <View style={styles.cardBody}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardMicro}>CALORIES TO BURN TODAY</Text>
                <View style={styles.burnBadge}><Text style={styles.burnBadgeText}>Burn needed</Text></View>
              </View>
              <View style={styles.userChip}><Text style={styles.userChipText}>{`${headerName} · ${Math.round(burnProfile?.current_weight_kg || 70)}kg · ${burnProfile?.activity_level || "moderate"} · Age ${burnProfile?.age || 25}`}</Text></View>
              <View style={styles.centerRow}>
                <View style={styles.ringWrap}>
                  <Svg width={ringSize} height={ringSize}>
                    <Circle cx={ringSize / 2} cy={ringSize / 2} r={radius} stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth} fill="none" />
                    <AnimatedCircle cx={ringSize / 2} cy={ringSize / 2} r={radius} stroke="#1a3a5c" strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={dashOffset as unknown as number} transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`} />
                  </Svg>
                  <View style={styles.ringCenter}><Text style={styles.ringPct}>{Math.round(burnedPercent * 100)}%</Text><Text style={styles.ringLabel}>burned</Text></View>
                </View>
                <View style={styles.centerCopy}>
                  <Text style={styles.kcalBig}>{formatNum(kcalToBurn)}</Text>
                  <Text style={styles.kcalLine}>kcal to burn from exercise</Text>
                  <Text style={styles.aiLine}>Your AI coach will suggest sessions to close the remaining burn target.</Text>
                </View>
              </View>
              <View style={styles.statsGrid}>
                <View style={styles.statCell}><Text style={styles.statLabel}>Body weight</Text><Text style={styles.statValue}>{Math.round(burnProfile?.current_weight_kg || 70)}</Text><Text style={styles.statUnit}>kg</Text></View>
                <View style={styles.statCell}><Text style={styles.statLabel}>TDEE</Text><Text style={styles.statValue}>{formatNum(burnPlan?.tdee || 2200)}</Text><Text style={styles.statUnit}>kcal/day</Text></View>
                <View style={styles.statCell}><Text style={styles.statLabel}>Daily goal</Text><Text style={styles.statValue}>{formatNum(dailyGoal)}</Text><Text style={styles.statUnit}>kcal target</Text></View>
              </View>
              <View style={styles.infoRow}><Text style={styles.infoLeft}>FOOD INTAKE VS TARGET</Text><Text style={styles.infoRight}>{`${formatNum(foodIntake)} / ${formatNum(dailyGoal)} kcal`}</Text></View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${Math.round(intakePercent * 100)}%` }]} />
              </View>
              <View style={styles.infoRow}><Text style={styles.infoLeft}>CALORIES BURNED SO FAR</Text><Text style={[styles.infoRight, { color: ACCENT_GREEN }]}>{`${formatNum(caloriesBurned)} kcal`}</Text></View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${Math.round(burnedPercent * 100)}%` }]} />
              </View>
              <View style={styles.infoRow}><Text style={styles.infoLeft}>{summaryTargetLabel.toUpperCase()}</Text><Text style={[styles.infoRight, { color: needsBurnFromExercise ? ACCENT_RED : ACCENT_GREEN }]}>{`${formatNum(summaryTargetValue)} kcal`}</Text></View>
              <View style={styles.progressTrack}>
                <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.progressFill, { width: `${Math.round(summaryTargetPercent * 100)}%` }]} />
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View style={animatedStyle(3)}>
          <Text style={styles.sectionLabel}>Calculation Breakdown</Text>
          <View style={styles.card}>
            <LinearGradient colors={[ACCENT_GREEN, ACCENT_BLUE, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.accentTop} />
            <View style={styles.cardBody}>
              <View style={styles.breakdownRow}><Text style={styles.breakLabel}>Calories eaten today</Text><Text style={styles.breakValueMuted}>{`${formatNum(foodIntake)} kcal`}</Text></View>
              <View style={styles.breakdownRow}><Text style={styles.breakLabel}>Minus daily calorie goal</Text><Text style={styles.breakValueRed}>{`−${formatNum(dailyGoal)} kcal`}</Text></View>
              <View style={[styles.breakdownRow, { borderBottomWidth: 0 }]}><Text style={styles.breakLabel}>Minus already burned</Text><Text style={styles.breakValueGreen}>{`−${formatNum(caloriesBurned)} kcal`}</Text></View>
              <View style={styles.stillRow}><Text style={styles.stillLabel}>{summaryTargetLabel}</Text><Text style={[styles.stillValue, { color: needsBurnFromExercise ? ACCENT_RED : ACCENT_GREEN }]}>{`${formatNum(summaryTargetValue)} kcal`}</Text></View>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG_MAIN },
  scroll: { flex: 1, backgroundColor: BG_MAIN },
  content: { paddingHorizontal: 16, paddingBottom: 34, paddingTop: 20 },
  headerWrap: { alignItems: "center", width: "100%", paddingBottom: 6 },
  brandRow: { alignItems: "center", justifyContent: "center" },
  brandMask: { fontFamily: ffDisplay, fontSize: 22, letterSpacing: 2, color: "#000" },
  brandGradient: { width: 98, height: 28 },
  greeting: { marginTop: 10, fontFamily: ffMedium, fontSize: 11, letterSpacing: 2.4, color: ACCENT_GREEN },
  userName: { fontFamily: ffDisplay, fontSize: 42, letterSpacing: 1.5, color: TEXT_PRIMARY, marginTop: 6 },
  datePill: { marginTop: 12, paddingVertical: 5, paddingHorizontal: 14, borderRadius: 100, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER, flexDirection: "row", alignItems: "center", gap: 8 },
  dateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: ACCENT_GREEN },
  dateText: { fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED },
  sectionLabel: { marginTop: 20, marginBottom: 10, fontFamily: ffMedium, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" },
  card: { backgroundColor: BG_CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: "hidden", marginBottom: 12 },
  accentTop: { height: 3, width: "100%" },
  cardBody: { padding: 16 },
  cardMicro: { fontFamily: ffMedium, fontSize: 9, letterSpacing: 2, color: TEXT_MUTED, textTransform: "uppercase" },
  cardTitle: { marginTop: 4, fontFamily: ffSemi, fontSize: 13, color: TEXT_PRIMARY },
  goalTopRow: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  goalWeeksLine: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  goalWeeks: { fontFamily: ffDisplay, fontSize: 48, color: TEXT_PRIMARY, lineHeight: 48 },
  goalWeeksUnit: { fontFamily: ffSemi, fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 8 },
  goalSub: { fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED, marginTop: 2 },
  goalRight: { alignItems: "flex-end" },
  goalKcal: { fontFamily: ffDisplay, fontSize: 28, color: ACCENT_GREEN, lineHeight: 28 },
  goalPerDay: { fontFamily: ffBody, fontSize: 11, color: "rgba(0,229,160,0.6)" },
  progressHead: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressPct: { fontFamily: ffSemi, fontSize: 12, color: "rgba(255,255,255,0.5)" },
  progressTrack: { marginTop: 8, width: "100%", height: 4, borderRadius: 100, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 100 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  burnBadge: { backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  burnBadgeText: { fontFamily: ffSemi, fontSize: 11, color: ACCENT_RED },
  userChip: { marginTop: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  userChipText: { fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED },
  centerRow: { marginTop: 14, flexDirection: "row", gap: 16, alignItems: "center" },
  ringWrap: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  ringCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  ringPct: { fontFamily: ffSemi, fontSize: 14, color: TEXT_PRIMARY },
  ringLabel: { fontFamily: ffBody, fontSize: 9, color: TEXT_MUTED },
  centerCopy: { flex: 1 },
  kcalBig: { fontFamily: ffDisplay, fontSize: 44, color: ACCENT_RED, lineHeight: 44 },
  kcalLine: { fontFamily: ffSemi, fontSize: 12, color: TEXT_PRIMARY },
  aiLine: { marginTop: 4, fontFamily: ffBody, fontSize: 11, color: TEXT_MUTED, lineHeight: 16 },
  statsGrid: { marginTop: 14, flexDirection: "row", gap: 8 },
  statCell: { flex: 1, backgroundColor: BG_SURFACE, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8 },
  statLabel: { fontFamily: ffMedium, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: TEXT_MUTED },
  statValue: { marginTop: 4, fontFamily: ffDisplay, fontSize: 24, color: TEXT_PRIMARY, lineHeight: 24 },
  statUnit: { marginTop: 2, fontFamily: ffBody, fontSize: 10, color: TEXT_MUTED },
  infoRow: { marginTop: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: BORDER, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  infoLeft: { fontFamily: ffMedium, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: TEXT_MUTED },
  infoRight: { fontFamily: ffMedium, fontSize: 11, color: TEXT_PRIMARY },
  breakdownRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  breakLabel: { fontFamily: ffBody, fontSize: 13, color: TEXT_PRIMARY },
  breakValueMuted: { fontFamily: ffMedium, fontSize: 13, color: TEXT_MUTED },
  breakValueRed: { fontFamily: ffMedium, fontSize: 13, color: ACCENT_RED },
  breakValueGreen: { fontFamily: ffMedium, fontSize: 13, color: ACCENT_GREEN },
  stillRow: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stillLabel: { fontFamily: ffDisplay, fontSize: 22, letterSpacing: 1, color: TEXT_PRIMARY },
  stillValue: { fontFamily: ffDisplay, fontSize: 28, color: ACCENT_RED },
});

