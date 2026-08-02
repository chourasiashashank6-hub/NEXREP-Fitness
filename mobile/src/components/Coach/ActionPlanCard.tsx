import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { loadOnboardingWithFallback } from "../../api/onboarding";
import i18n from "../../i18n";
import { useAuthStore } from "../../store/authStore";
import { type AICoachResponse, type DietTipItem, type NutritionData, type Task } from "../../types/coach";

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
const PURPLE_LIGHT = "#F1EEFF";
const GOLD = "#FFD700";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";

type FilterValue = "all" | "water" | "food" | "log" | "move";

const todayKey = () => new Date().toISOString().slice(0, 10);
const STREAK_KEY = "streak_data";

type StreakData = Record<string, boolean>;

type DietTip = {
  emoji: string;
  title: string;
  body: string;
  tag: string;
  category: string;
  tagBg: string;
  tagText: string;
  iconBg: string;
};

function buildMealLogTasks(mealsPerDay: number, mealsLogged: number): Task[] {
  const normalizedMeals = Number.isFinite(mealsPerDay) ? Math.max(1, Math.min(8, Math.round(mealsPerDay))) : 3;
  const mealLabels = ["breakfast", "lunch", "dinner", "snack", "pre-workout meal", "post-workout meal"];
  const firstMeals = mealLabels.slice(0, Math.min(normalizedMeals, mealLabels.length));
  const mealList = firstMeals.join(", ");
  const left = Math.max(0, normalizedMeals - mealsLogged);

  const dynamicLogTask: Task = {
    id: "plan-meal-target",
    name: left > 0 ? `Log ${left} more meal(s)` : "Meal logging target completed",
    description:
      left > 0
        ? `Onboarding target is ${normalizedMeals} meals/day. Planned meals: ${mealList}.`
        : `Great consistency. You already logged ${mealsLogged} meal(s) against your ${normalizedMeals} meal target.`,
    tag: "log",
    priority: left > 0 ? "high" : "low",
    done: false,
  };

  const dynamicTimingTask: Task = {
    id: "plan-meal-timing",
    name: "Log each meal right after eating",
    description: "Log meals within 15 minutes to keep calories and macros accurate for AI coaching.",
    tag: "log",
    priority: "medium",
    done: false,
  };

  return [dynamicLogTask, dynamicTimingTask];
}

function buildIntakeDrivenTasks(nutritionData: NutritionData | null, mealsPerDay: number): Task[] {
  const consumed = Number(nutritionData?.caloriesConsumed || 0);
  const target = Number(nutritionData?.tdee || 0);
  const remaining = Math.round(target - consumed);
  const waterMl = Number(nutritionData?.waterMl || 0);
  const proteinG = Number(nutritionData?.proteinG || 0);
  const mealsLogged = Number(nutritionData?.mealsLogged || 0);
  const burned = Number(nutritionData?.burnedKcal || 0);
  const waterTargetMl = 2500;
  const proteinTargetG = Math.max(90, Math.round((target * 0.25) / 4));
  const waterLeft = Math.max(0, waterTargetMl - waterMl);
  const proteinLeft = Math.max(0, Math.round(proteinTargetG - proteinG));
  const mealLeft = Math.max(0, mealsPerDay - mealsLogged);
  const tasks: Task[] = [];

  const mealTasks = buildMealLogTasks(mealsPerDay, mealsLogged);
  const mealTargetTask = mealTasks[0];
  const mealTimingTask = mealTasks[1];
  if (mealTargetTask) {
    tasks.push({ ...mealTargetTask, done: mealLeft === 0 });
  }
  if (mealTimingTask) {
    tasks.push({ ...mealTimingTask, done: mealLeft === 0 });
  }

  tasks.push(
    remaining < 0
      ? {
          id: "plan-calories",
          name: "Hold intake and choose very light options",
          description: `You are over target by ${Math.abs(remaining)} kcal. Keep intake minimal and hydration high.`,
          tag: "food",
          priority: "high",
          done: true,
        }
      : {
          id: "plan-calories",
          name: "Plan a balanced meal under remaining calories",
          description:
            remaining > 250
              ? `${remaining} kcal left today. Prioritize high-protein and high-fiber foods in this budget.`
              : "Calorie budget is on track. Keep meals balanced and within your remaining target.",
          tag: "food",
          priority: remaining > 250 ? "medium" : "low",
          done: remaining <= 250,
        },
  );

  tasks.push({
    id: "plan-water",
    name: "Complete hydration target",
    description:
      waterLeft > 0
        ? `${waterLeft} ml water left to hit ~${waterTargetMl} ml today.`
        : `Hydration goal achieved. You reached ~${waterTargetMl} ml today.`,
    tag: "water",
    priority: waterLeft > 1000 ? "high" : "medium",
    done: waterLeft === 0,
  });

  tasks.push({
    id: "plan-protein",
    name: "Close protein gap",
    description:
      proteinLeft > 0
        ? `${proteinLeft}g protein left. Add lean options like curd, paneer, eggs, chicken, tofu, or whey.`
        : `Protein target reached. Keep meal quality high for recovery and satiety.`,
    tag: "food",
    priority: proteinLeft > 25 ? "high" : "medium",
    done: proteinLeft === 0,
  });

  const movementNeeded = burned < 250 && remaining < 0;
  tasks.push({
    id: "plan-move",
    name: movementNeeded ? "Add a short movement session" : "Movement target covered for now",
    description: movementNeeded
      ? "Add a 15-20 min walk or light workout to support calorie balance."
      : "You have enough movement logged for the current calorie balance. Keep activity steady.",
    tag: "move",
    priority: burned < 150 ? "high" : "medium",
    done: !movementNeeded,
  });

  return tasks;
}

function buildFallbackTips(n: NutritionData, mealsLogged: number, mealsPerDay: number): DietTip[] {
  const proteinTarget = n.proteinTargetG ?? Math.max(90, Math.round((n.tdee * 0.25) / 4));
  const waterTarget = n.waterTargetMl ?? 2500;
  const fatTarget = n.fatTargetG ?? Math.round((n.tdee * 0.2) / 9);
  const tips: DietTip[] = [
    {
      emoji: "🥦",
      title: "Add fermented foods today",
      body: "Curd, buttermilk or idli feed gut bacteria and improve digestion and immunity.",
      tag: "Gut",
      tagBg: GREEN_LIGHT,
      tagText: GREEN,
      iconBg: GREEN_LIGHT,
      category: "gut",
    },
  ];

  if (n.proteinG < proteinTarget * 0.5) {
    tips.push({
      emoji: "⏰",
      title: "Eat protein within 30 min of waking",
      body: `Protein is at ${Math.round(n.proteinG)}g of ${Math.round(proteinTarget)}g. Early protein stabilises blood sugar and reduces cortisol spikes.`,
      tag: "Protein",
      tagBg: BLUE_LIGHT,
      tagText: BLUE,
      iconBg: BLUE_LIGHT,
      category: "protein",
    });
  }

  if (n.waterMl >= waterTarget) {
    tips.push({
      emoji: "💧",
      title: "Drink water 20 min before meals",
      body: "You've hit your water target! Drinking water before (not during) meals improves digestion and prevents overeating.",
      tag: "Digestion",
      tagBg: BLUE_LIGHT,
      tagText: BLUE,
      iconBg: BLUE_LIGHT,
      category: "digestion",
    });
  }

  if (n.waterMl < waterTarget * 0.5) {
    tips.push({
      emoji: "💧",
      title: "Stay hydrated for better digestion",
      body: `You're at ${Math.round(n.waterMl)}ml of ${Math.round(waterTarget)}ml. Dehydration slows digestion — drink a glass now.`,
      tag: "Digestion",
      tagBg: BLUE_LIGHT,
      tagText: BLUE,
      iconBg: BLUE_LIGHT,
      category: "digestion",
    });
  }

  if (n.fatG >= fatTarget * 0.7) {
    tips.push({
      emoji: "🥑",
      title: "Healthy fats protect your gut lining",
      body: "Almonds and olive oil reduce gut inflammation and help absorb fat-soluble vitamins A, D, E, K.",
      tag: "Gut",
      tagBg: AMBER_LIGHT,
      tagText: AMBER_TEXT,
      iconBg: AMBER_LIGHT,
      category: "fat",
    });
  }

  if (mealsLogged > mealsPerDay) {
    tips.push({
      emoji: "🕐",
      title: "Space meals 3–4 hours apart",
      body: `You've logged ${mealsLogged} meals today. Spacing meals lets your gut rest, reducing bloating and improving absorption.`,
      tag: "Timing",
      tagBg: PURPLE_LIGHT,
      tagText: PURPLE,
      iconBg: PURPLE_LIGHT,
      category: "timing",
    });
  }

  tips.push({
    emoji: "🍽️",
    title: "Chew slowly — digestion starts in the mouth",
    body: "Chewing each bite 20–30 times reduces digestive load and prevents bloating after meals.",
    tag: "Gut",
    tagBg: GREEN_LIGHT,
    tagText: GREEN,
    iconBg: GREEN_LIGHT,
    category: "gut",
  });

  return tips.slice(0, 5);
}

function tipTone(category: DietTipItem["category"]) {
  if (category === "protein") return { tagBg: BLUE_LIGHT, tagText: BLUE, iconBg: BLUE_LIGHT };
  if (category === "digestion") return { tagBg: BLUE_LIGHT, tagText: BLUE, iconBg: BLUE_LIGHT };
  if (category === "timing") return { tagBg: PURPLE_LIGHT, tagText: PURPLE, iconBg: PURPLE_LIGHT };
  if (category === "fat") return { tagBg: AMBER_LIGHT, tagText: AMBER_TEXT, iconBg: AMBER_LIGHT };
  return { tagBg: GREEN_LIGHT, tagText: GREEN, iconBg: GREEN_LIGHT };
}

function mapApiTipToLocal(t: DietTipItem): DietTip {
  const tone = tipTone(t.category);
  return {
    emoji: t.emoji || "🌿",
    title: t.title,
    body: t.body,
    tag: t.tag || "Gut",
    category: t.category,
    ...tone,
  };
}

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: i18n.t("coach.actionPlan.filters.all") },
  { value: "water", label: i18n.t("coach.actionPlan.filters.water") },
  { value: "food", label: i18n.t("coach.actionPlan.filters.food") },
  { value: "log", label: i18n.t("coach.actionPlan.filters.log") },
  { value: "move", label: i18n.t("coach.actionPlan.filters.move") },
];

function tagTone(tag: Task["tag"]) {
  if (tag === "food") return { bg: GREEN_LIGHT, color: GREEN, label: i18n.t("coach.actionPlan.tags.food") };
  if (tag === "water") return { bg: BLUE_LIGHT, color: BLUE, label: i18n.t("coach.actionPlan.tags.water") };
  if (tag === "move") return { bg: GREEN_LIGHT, color: GREEN, label: i18n.t("coach.actionPlan.tags.move") };
  if (tag === "rest") return { bg: AMBER_LIGHT, color: AMBER_TEXT, label: i18n.t("coach.actionPlan.tags.rest") };
  return { bg: BG, color: "#555555", label: i18n.t("coach.actionPlan.tags.log") };
}

function priorityColor(priority: Task["priority"]) {
  if (priority === "high") return "#E24B4A";
  if (priority === "medium") return "#EF9F27";
  return "#97C459";
}

function ProgressBarView({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.progressPct}>{pct}%</Text>
    </View>
  );
}

function FilterTabs({ value, onChange }: { value: FilterValue; onChange: (next: FilterValue) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
      {FILTERS.map((item) => {
        const active = value === item.value;
        const waterActive = active && item.value === "water";
        return (
          <Pressable
            key={item.value}
            onPress={() => onChange(item.value)}
            style={[styles.filterTab, active && styles.filterTabActive, waterActive && styles.filterTabWaterActive]}
          >
            <Text style={[styles.filterText, active && styles.filterTextActive, waterActive && styles.filterTextWaterActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function TaskItem({ task }: { task: Task }) {
  const tag = tagTone(task.tag);
  return (
    <View style={styles.taskCard}>
      <View style={[styles.checkCircle, task.done && styles.checkCircleDone]}>
        {task.done ? <Ionicons name="checkmark" size={13} color={WHITE} /> : null}
      </View>
      <View style={styles.taskBody}>
        <Text style={[styles.taskTitle, task.done && styles.taskTitleDone]}>{task.name}</Text>
        <Text style={styles.taskSubtitle}>{task.description}</Text>
        <View style={styles.taskMetaRow}>
          <View style={[styles.tagPill, { backgroundColor: tag.bg }]}>
            <Text style={[styles.tagText, { color: tag.color }]}>{tag.label}</Text>
          </View>
          <View style={[styles.priorityDot, { backgroundColor: priorityColor(task.priority) }]} />
        </View>
      </View>
    </View>
  );
}

function DietTipsSection({ tips }: { tips: DietTip[] }) {
  const { t } = useTranslation();
  if (!tips.length) return null;

  return (
    <View style={styles.tipsSection}>
      <View style={styles.tipsHeaderRow}>
        <View>
          <Text style={styles.tipsTitle}>{t("coach.actionPlan.healthTips")}</Text>
          <Text style={styles.tipsSubtitle}>{t("coach.actionPlan.tipsSubtitle")}</Text>
        </View>
        <View style={styles.gutBadge}>
          <Text style={styles.gutBadgeText}>{t("coach.actionPlan.gutHealth")}</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tipsScrollContent}>
        {tips.map((tip, index) => (
          <View key={`${tip.title}-${index}`} style={styles.tipCard}>
            <View style={styles.tipHeader}>
              <View style={[styles.tipIconTile, { backgroundColor: tip.iconBg }]}>
                <Text style={styles.tipEmoji}>{tip.emoji}</Text>
              </View>
              <View style={[styles.tipTag, { backgroundColor: tip.tagBg }]}>
                <Text style={[styles.tipTagText, { color: tip.tagText }]}>{tip.tag}</Text>
              </View>
            </View>
            <Text style={styles.tipTitle}>{tip.title}</Text>
            <Text style={styles.tipBody}>{tip.body}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.actionDivider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t("coach.actionPlan.todaysActionPlan")}</Text>
        <View style={styles.dividerLine} />
      </View>
    </View>
  );
}

export function ActionPlanCard({ nutritionData, coachResult }: { nutritionData: NutritionData | null; coachResult?: AICoachResponse | null; accentColor?: string }) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [mealsPerDay, setMealsPerDay] = useState(3);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [streakData, setStreakData] = useState<StreakData>({});
  const [dietTips, setDietTips] = useState<DietTip[]>([]);
  const [actionPlanExpanded, setActionPlanExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let preferredMeals = 3;
        if (token) {
          const { profile } = await loadOnboardingWithFallback(token);
          preferredMeals = profile?.dietary?.meals_per_day ?? 3;
        }
        if (!cancelled) setMealsPerDay(preferredMeals);

        const savedStreak = await AsyncStorage.getItem(STREAK_KEY);
        if (cancelled) return;
        if (savedStreak) {
          const parsed = JSON.parse(savedStreak) as StreakData;
          if (parsed && typeof parsed === "object") setStreakData(parsed);
        }
      } catch {
        // silently use memory state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const apiTips = coachResult?.dietTips;
    if (apiTips && apiTips.length > 0) {
      setDietTips(apiTips.map((tip) => mapApiTipToLocal(tip)));
      return;
    }
    if (!nutritionData) {
      setDietTips([]);
      return;
    }
    const mealsLogged = Number(nutritionData.mealsLogged || 0);
    setDietTips(buildFallbackTips(nutritionData, mealsLogged, mealsPerDay));
  }, [coachResult, nutritionData, mealsPerDay]);

  const tasks = useMemo(() => buildIntakeDrivenTasks(nutritionData, mealsPerDay), [nutritionData, mealsPerDay]);

  useEffect(() => {
    const doneCount = tasks.filter((t) => t.done).length;
    const achieved = doneCount >= 4;
    const next = { ...streakData, [todayKey()]: achieved };
    setStreakData(next);
    void AsyncStorage.setItem(STREAK_KEY, JSON.stringify(next)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const done = tasks.filter((t) => t.done).length;
  const filtered = useMemo(() => (filter === "all" ? tasks : tasks.filter((t) => t.tag === filter)), [filter, tasks]);

  return (
    <View>
      <DietTipsSection tips={dietTips} />
      <View style={styles.card}>
        <Pressable
          style={styles.headRow}
          onPress={() => setActionPlanExpanded((next) => !next)}
          accessibilityRole="button"
          accessibilityLabel={actionPlanExpanded ? t("coach.actionPlan.collapse") : t("coach.actionPlan.expand")}
        >
          <Text style={styles.title}>{t("coach.actionPlan.title")}</Text>
          <View style={styles.headRight}>
            <View style={styles.donePill}>
              <Text style={styles.doneText}>
                {t("coach.actionPlan.doneCount", { done, total: tasks.length })}
              </Text>
            </View>
            <View style={styles.expandBtn}>
              <Ionicons name={actionPlanExpanded ? "chevron-up" : "chevron-down"} size={16} color={GREEN} />
            </View>
          </View>
        </Pressable>

        {actionPlanExpanded ? (
          <>
            <ProgressBarView done={done} total={tasks.length} />
            <FilterTabs value={filter} onChange={setFilter} />

            {filtered.length === 0 ? (
              <Text style={styles.empty}>{t("coach.actionPlan.empty")}</Text>
            ) : (
              filtered.map((task) => <TaskItem key={task.id} task={task} />)
            )}

          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tipsSection: { marginBottom: 12 },
  tipsHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  tipsTitle: { color: MUTED, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  tipsSubtitle: { color: MUTED, fontSize: 11, marginTop: 3 },
  gutBadge: { backgroundColor: GREEN_LIGHT, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 9 },
  gutBadgeText: { color: GREEN, fontSize: 10, fontWeight: "900" },
  tipsScrollContent: { paddingBottom: 4, gap: 10 },
  tipCard: { width: 160, backgroundColor: WHITE, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 8 },
  tipHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tipIconTile: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tipEmoji: { fontSize: 18 },
  tipTag: { borderRadius: 99, paddingVertical: 2, paddingHorizontal: 8, flexShrink: 0 },
  tipTagText: { fontSize: 9, fontWeight: "900" },
  tipTitle: { color: TEXT, fontSize: 12, fontWeight: "900", lineHeight: 16 },
  tipBody: { color: "#777777", fontSize: 10, lineHeight: 15 },
  actionDivider: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  dividerText: { color: MUTED, fontSize: 10, fontWeight: "900" },
  card: {
    backgroundColor: WHITE,
    marginBottom: 12,
  },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: TEXT, fontSize: 15, fontWeight: "900", letterSpacing: 0.2 },
  donePill: { backgroundColor: GREEN_LIGHT, borderRadius: 99, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 6 },
  doneText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  expandBtn: { width: 28, height: 28, borderRadius: 99, backgroundColor: GREEN_LIGHT, alignItems: "center", justifyContent: "center" },
  progressWrap: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: { height: 8, flex: 1, borderRadius: 99, backgroundColor: TRACK, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 99, backgroundColor: GREEN },
  progressPct: { color: MUTED, fontSize: 11, fontWeight: "900", width: 36, textAlign: "right" },
  filterRow: { flexDirection: "row", gap: 8, paddingVertical: 12 },
  filterTab: { backgroundColor: BG, borderRadius: 99, paddingVertical: 5, paddingHorizontal: 13 },
  filterTabActive: { backgroundColor: GREEN },
  filterTabWaterActive: { backgroundColor: BLUE_LIGHT },
  filterText: { color: MUTED, fontSize: 11, fontWeight: "900" },
  filterTextActive: { color: WHITE },
  filterTextWaterActive: { color: BLUE },
  taskCard: { backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingVertical: 12, paddingHorizontal: 13, flexDirection: "row", gap: 10, marginBottom: 8 },
  checkCircle: { width: 20, height: 20, borderRadius: 99, borderWidth: 1.5, borderColor: BORDER, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkCircleDone: { backgroundColor: GREEN, borderColor: GREEN },
  taskBody: { flex: 1 },
  taskTitle: { color: TEXT, fontSize: 12, fontWeight: "900" },
  taskTitleDone: { color: MUTED, textDecorationLine: "line-through" },
  taskSubtitle: { color: MUTED, fontSize: 10, lineHeight: 15, marginTop: 3 },
  taskMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  tagPill: { borderRadius: 99, paddingVertical: 2, paddingHorizontal: 8 },
  tagText: { fontSize: 9, fontWeight: "900" },
  priorityDot: { width: 6, height: 6, borderRadius: 99 },
  empty: { color: MUTED, fontSize: 12, marginVertical: 8 },
});
