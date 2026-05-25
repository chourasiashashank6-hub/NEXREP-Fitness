import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { addMeal, getCalories } from "../api/calorie";
import { getDailyCalorieLog, todayLocal, type CalorieDayPayload } from "../api/caloriesLog";
import { AppButton } from "../components/AppButton";
import { AppCard } from "../components/AppCard";
import { AppInput } from "../components/AppInput";
import { HeroHeader } from "../components/HeroHeader";
import { ScreenContainer } from "../components/ScreenContainer";
import { useAppTheme } from "../theme";

const GOAL = 2200;
const CAL_MILESTONE_PCTS = [25, 50, 75, 100] as const;

function num(n: unknown): number {
  if (n === undefined || n === null) return NaN;
  const x = typeof n === "string" ? Number(n) : Number(n);
  return Number.isFinite(x) ? x : NaN;
}

function fmtInt(n: unknown): string {
  const x = num(n);
  if (Number.isNaN(x)) return "—";
  return String(Math.round(x));
}

function fmt1(n: unknown): string {
  const x = num(n);
  if (Number.isNaN(x)) return "—";
  return x.toFixed(1);
}

function clamp01(x: number): number {
  if (Number.isNaN(x) || !Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function pctOf(current: number, target: number): number {
  if (target <= 0 || Number.isNaN(target)) return 0;
  return (current / target) * 100;
}

function AnimatedProgressBar({
  ratio,
  fillColor,
  trackColor,
  height,
  dangerColor,
}: {
  ratio: number;
  fillColor: string;
  trackColor: string;
  height: number;
  dangerColor: string;
}) {
  const [trackW, setTrackW] = useState(0);
  const widthAnim = useRef(new Animated.Value(0)).current;
  const capped = clamp01(ratio);
  const over = ratio > 1;

  useEffect(() => {
    if (trackW <= 0) return;
    Animated.spring(widthAnim, {
      toValue: capped * trackW,
      useNativeDriver: false,
      friction: 9,
      tension: 40,
    }).start();
  }, [capped, trackW, widthAnim]);

  const fill = over ? dangerColor : fillColor;
  return (
    <View onLayout={(e) => setTrackW(e.nativeEvent.layout.width)} style={[styles.barTrack, { height, backgroundColor: trackColor, borderRadius: height / 2 }]}>
      <Animated.View style={{ height, width: widthAnim, backgroundColor: fill, borderRadius: height / 2 }} />
    </View>
  );
}

function MilestoneStrip({
  currentPct,
  steps,
  dotColor,
  muted,
  border,
}: {
  currentPct: number;
  steps: readonly number[];
  dotColor: string;
  muted: string;
  border: string;
}) {
  return (
    <View style={styles.milestoneRow}>
      {steps.map((step) => {
        const hit = currentPct >= step;
        return (
          <View key={step} style={styles.milestoneItem}>
            <View style={[styles.milestoneDot, { borderColor: hit ? dotColor : border, backgroundColor: hit ? dotColor : "transparent" }]} />
            <Text style={[styles.milestoneLabel, { color: muted }]}>{step}%</Text>
          </View>
        );
      })}
    </View>
  );
}

function MacroProgressRow({
  label,
  current,
  target,
  color,
  trackColor,
  labelColor,
  numsColor,
  unit = "g",
}: {
  label: string;
  current: number;
  target: number;
  color: string;
  trackColor: string;
  labelColor: string;
  numsColor: string;
  unit?: string;
}) {
  const safeCur = Number.isFinite(current) ? current : 0;
  const safeTgt = Number.isFinite(target) && target > 0 ? target : 0;
  const ratio = safeTgt > 0 ? safeCur / safeTgt : 0;
  const formatVal = unit === "L" ? fmt1 : fmtInt;

  return (
    <View style={styles.macroBlock}>
      <View style={styles.macroHead}>
        <Text style={[styles.macroLabel, { color: labelColor }]}>{label}</Text>
        <Text style={[styles.macroNums, { color: numsColor }]}>
          {formatVal(safeCur)} / {Number.isFinite(target) && target > 0 ? formatVal(target) : "—"} {unit}
        </Text>
      </View>
      <View style={[styles.macroTrack, { backgroundColor: trackColor }]}>
        <View style={[styles.macroFill, { width: `${Math.min(100, ratio * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export const CalorieScreen = () => {
  const { colors } = useAppTheme();
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [data, setData] = useState<any>({ totalCalories: 0, items: [] });
  const [calorieDay, setCalorieDay] = useState<CalorieDayPayload | null>(null);

  const load = async () => {
    const [meals, day] = await Promise.all([getCalories(), getDailyCalorieLog(todayLocal()).catch(() => null)]);
    setData(meals);
    setCalorieDay(day);
  };
  useEffect(() => {
    load();
  }, []);

  const progress = useMemo(() => Math.min(100, Math.round((data.totalCalories / GOAL) * 100)), [data.totalCalories]);
  const log = calorieDay?.log;
  const water = calorieDay?.water;
  const mealCount = calorieDay?.meals?.length ?? 0;
  const intake = log ? num(log.total_calories) : NaN;
  const targetKcal = log ? num(log.target_calories) : NaN;
  const calRatio = log && targetKcal > 0 ? intake / targetKcal : 0;
  const calPctDisplay = log && targetKcal > 0 && Number.isFinite(intake) ? pctOf(intake, targetKcal) : 0;
  const waterCur = log ? num(water?.total_water_l ?? log.total_water_l) : NaN;
  const waterTgt = log ? num(water?.target_water_l ?? log.target_water_l) : NaN;
  const waterRatio = log && waterTgt > 0 ? waterCur / waterTgt : 0;
  const waterPctDisplay = log && waterTgt > 0 && Number.isFinite(waterCur) ? pctOf(waterCur, waterTgt) : 0;
  const fiberCur = log ? num((log as Record<string, unknown>).total_fiber_g) : NaN;
  const fiberTgt = log ? num((log as Record<string, unknown>).target_fiber_g) : NaN;

  const submit = async () => {
    try {
      await addMeal({
        name,
        calories: Number(calories),
        protein: protein ? Number(protein) : undefined,
        carbs: carbs ? Number(carbs) : undefined,
        fat: fat ? Number(fat) : undefined,
      });
      setName("");
      setCalories("");
      setProtein("");
      setCarbs("");
      setFat("");
      load();
    } catch {
      Alert.alert("Error", "Failed to save meal.");
    }
  };

  return (
    <ScreenContainer>
      <HeroHeader title="Calorie Tracker" subtitle="Stay within your daily nutrition target" />
      <AppCard>
        <View style={styles.cardChrome}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={[styles.cardEyebrow, { color: colors.muted }]}>NUTRITION</Text>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Calories</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open Calorie Log" style={[styles.openPill, { borderColor: colors.border }]}>
              <Text style={[styles.openPillText, { color: colors.primary }]}>Open log</Text>
              <Text style={[styles.cardChev, { color: colors.muted }]}>›</Text>
            </Pressable>
          </View>
          <Text style={[styles.cardSub, { color: colors.muted }]}>Today · {calorieDay?.date ?? todayLocal()}</Text>

          {log ? (
            <>
              {log.is_goal_met ? (
                <View style={[styles.badge, { borderColor: colors.primary, backgroundColor: `${colors.primary}22` }]}>
                  <Text style={[styles.badgeText, { color: colors.primary }]}>Daily calorie target reached</Text>
                </View>
              ) : null}
              <View style={[styles.heroRing, { borderColor: colors.border }]}>
                <Text style={[styles.heroPct, { color: colors.text }]}>{calPctDisplay >= 100 ? "100+" : `${Math.round(Math.min(999, calPctDisplay))}`}</Text>
                <Text style={[styles.heroPctUnit, { color: colors.muted }]}>% of goal</Text>
              </View>
              <View style={styles.block}>
                <View style={styles.blockHead}>
                  <Text style={[styles.blockLabel, { color: colors.muted }]}>Energy</Text>
                  <Text style={[styles.blockValue, { color: colors.text }]}>{fmtInt(intake)} / {fmtInt(targetKcal)} kcal</Text>
                </View>
                <AnimatedProgressBar ratio={calRatio} fillColor={colors.primary} trackColor={colors.inputBg} height={14} dangerColor={colors.danger} />
                <Text style={[styles.barCaption, { color: colors.muted }]}>
                  {calRatio >= 1 ? "At or above target — fine-tune in Calorie Log." : `${fmtInt(log.calories_remaining)} kcal remaining`}
                </Text>
                <MilestoneStrip currentPct={calPctDisplay} steps={CAL_MILESTONE_PCTS} dotColor={colors.primary} muted={colors.muted} border={colors.border} />
              </View>
              <View style={styles.block}>
                <View style={styles.blockHead}>
                  <Text style={[styles.blockLabel, { color: colors.muted }]}>Hydration</Text>
                  <Text style={[styles.blockValue, { color: colors.text }]}>
                    {fmt1(waterCur)} / {fmt1(waterTgt)} L
                    {water?.is_target_met ? <Text style={{ color: colors.primary }}> · Met</Text> : null}
                  </Text>
                </View>
                <AnimatedProgressBar ratio={waterRatio} fillColor={colors.secondary} trackColor={colors.inputBg} height={12} dangerColor={colors.danger} />
                <MilestoneStrip currentPct={waterPctDisplay} steps={CAL_MILESTONE_PCTS} dotColor={colors.primary} muted={colors.muted} border={colors.border} />
              </View>
              <View style={styles.block}>
                <Text style={[styles.blockLabel, { color: colors.muted, marginBottom: 10 }]}>Macros</Text>
                <MacroProgressRow
                  label="Protein"
                  current={num(log.total_protein_g)}
                  target={num(log.target_protein_g)}
                  color={colors.primary}
                  trackColor={colors.inputBg}
                  labelColor={colors.text}
                  numsColor={colors.muted}
                />
                <MacroProgressRow
                  label="Carbs"
                  current={num(log.total_carbs_g)}
                  target={num(log.target_carbs_g)}
                  color="#5BC0EB"
                  trackColor={colors.inputBg}
                  labelColor={colors.text}
                  numsColor={colors.muted}
                />
                <MacroProgressRow
                  label="Fat"
                  current={num(log.total_fat_g)}
                  target={num(log.target_fat_g)}
                  color="#E8A54B"
                  trackColor={colors.inputBg}
                  labelColor={colors.text}
                  numsColor={colors.muted}
                />
                <MacroProgressRow
                  label="Water"
                  current={waterCur}
                  target={waterTgt}
                  color={colors.secondary}
                  trackColor={colors.inputBg}
                  labelColor={colors.text}
                  numsColor={colors.muted}
                  unit="L"
                />
                <MacroProgressRow
                  label="Fibre"
                  current={fiberCur}
                  target={fiberTgt}
                  color="#9B8AFB"
                  trackColor={colors.inputBg}
                  labelColor={colors.text}
                  numsColor={colors.muted}
                />
              </View>
              <View style={[styles.mealChipRow, { backgroundColor: colors.inputBg }]}>
                <Text style={[styles.mealChipStrong, { color: colors.text }]}>{mealCount}</Text>
                <Text style={[styles.mealChipMuted, { color: colors.muted }]}>meals logged today</Text>
              </View>
              {calorieDay?.macro_split_label ? <Text style={[styles.hint, { color: colors.muted }]}>{calorieDay.macro_split_label}</Text> : null}
            </>
          ) : (
            <Text style={[styles.emptyCard, { color: colors.muted }]}>Today's calorie log could not be loaded. Use Open log to open Calorie Log and retry.</Text>
          )}
        </View>
      </AppCard>

      <AppCard>
        <Text style={[styles.goal, { color: colors.text }]}>{data.totalCalories} / {GOAL} kcal</Text>
        <View style={[styles.progressWrap, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: colors.secondary }]} />
        </View>
        <Text style={[styles.goalSub, { color: colors.muted }]}>{progress}% of daily goal</Text>
      </AppCard>

      <AppCard>
        <AppInput label="Food Name" value={name} onChangeText={setName} placeholder="Example: Chicken salad" />
        <AppInput label="Calories" value={calories} onChangeText={setCalories} keyboardType="number-pad" />
        <AppInput label="Protein (optional)" value={protein} onChangeText={setProtein} keyboardType="number-pad" />
        <AppInput label="Carbs (optional)" value={carbs} onChangeText={setCarbs} keyboardType="number-pad" />
        <AppInput label="Fat (optional)" value={fat} onChangeText={setFat} keyboardType="number-pad" />
        <AppButton label="Add Meal" onPress={submit} />
      </AppCard>

      <AppCard>
        <Text style={[styles.section, { color: colors.text }]}>Recent Meals</Text>
        {data.items.length === 0 ? (
          <Text style={[styles.item, { color: colors.muted }]}>No meals logged yet.</Text>
        ) : (
          data.items.map((item: any) => (
            <View key={item.id} style={styles.mealRow}>
              <Text style={[styles.mealName, { color: colors.text }]}>{item.name}</Text>
              <Text style={[styles.item, { color: colors.muted }]}>{item.calories} kcal</Text>
            </View>
          ))
        )}
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  cardChrome: { overflow: "hidden" },
  cardHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 },
  cardEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 2 },
  cardTitle: { fontSize: 20, fontWeight: "800" },
  openPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  openPillText: { fontSize: 12, fontWeight: "800" },
  cardChev: { fontSize: 18, fontWeight: "700" },
  cardSub: { fontSize: 12, marginBottom: 14 },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 12,
  },
  badgeText: { fontSize: 12, fontWeight: "800" },
  heroRing: {
    alignSelf: "center",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  heroPct: { fontSize: 32, fontWeight: "900", lineHeight: 38 },
  heroPctUnit: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  block: { marginBottom: 18 },
  blockHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 12 },
  blockLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", flexShrink: 0 },
  blockValue: { fontSize: 13, fontWeight: "700", textAlign: "right", flex: 1 },
  barTrack: { width: "100%", overflow: "hidden" },
  barCaption: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  milestoneRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingHorizontal: 2 },
  milestoneItem: { alignItems: "center", flex: 1 },
  milestoneDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  milestoneLabel: { fontSize: 10, fontWeight: "700", marginTop: 6 },
  macroBlock: { marginBottom: 10 },
  macroHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  macroLabel: { fontSize: 13, fontWeight: "700" },
  macroNums: { fontSize: 12, fontWeight: "600" },
  macroTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  macroFill: { height: 8, borderRadius: 4 },
  mealChipRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, borderRadius: 12 },
  mealChipStrong: { fontSize: 22, fontWeight: "900" },
  mealChipMuted: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12, marginTop: 4, fontStyle: "italic" },
  emptyCard: { fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 8 },
  goal: { fontWeight: "800", fontSize: 18, marginBottom: 10 },
  goalSub: { marginTop: 8, fontSize: 12 },
  progressWrap: { height: 12, borderRadius: 999 },
  progressFill: { height: 12, borderRadius: 999 },
  section: { fontWeight: "800", marginBottom: 8 },
  mealRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  mealName: { fontWeight: "600" },
  item: {},
});
