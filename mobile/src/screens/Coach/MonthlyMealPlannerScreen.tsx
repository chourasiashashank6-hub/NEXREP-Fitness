import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  fetchMealPlanCurrent,
  fetchMealPlanDay,
  fetchProteinSuggestions,
  fetchSupplementRecommendations,
  fetchWeekPlan,
  fetchWeeksOverview,
  generateMealPlan,
  generateWeekPlan,
  regenerateMealPlanDay,
  regenerateRemainingMeals,
  regenerateWeek,
  swapMealPlanMeal,
} from "../../api/mealPlanner";
import { fetchOnboardingMe } from "../../api/onboarding";
import { PlannerMonthCalendar } from "../../components/Coach/PlannerMonthCalendar";
import { MEAL_SWAP_REASONS, SwapBottomSheet } from "../../components/SwapBottomSheet";
import { ScreenContainer } from "../../components/ScreenContainer";
import { auth } from "../../services/authService";
import { useAuthStore } from "../../store/authStore";
import { notifyUser } from "../../utils/notify";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { useAppTheme } from "../../theme";
import type {
  BudgetLevel,
  MealDayPlan,
  MealPlanCurrent,
  ProteinSuggestion,
  ProteinSuggestionIcon,
  SupplementIcon,
  SupplementRecommendation,
  WeekTab,
} from "../../types/planner";
import { isWeeklyPlannerCurrent } from "../../types/planner";
import { fullDayLabel, monthYearLabel } from "../../utils/localDate";

type RegenStatsSource = {
  day_regens_used?: number;
  day_regens_limit?: number;
  day_regens_remaining?: number;
  planner_limits_exempt?: boolean;
  planner_days_unlocked?: boolean;
};

const PLANNER_DAYS_UNLOCK_EMAILS = new Set(["shashank1@gmail.com"]);
const PLANNER_DAYS_UNLOCK_USER_IDS = new Set(["2"]);

function syncRegenStats(
  source: RegenStatsSource | null | undefined,
  setUsed: (n: number) => void,
  setLimit: (n: number) => void,
  setExempt?: (v: boolean) => void,
  setDaysUnlocked?: (v: boolean) => void,
) {
  if (source?.day_regens_used !== undefined) setUsed(source.day_regens_used);
  if (source?.day_regens_limit !== undefined) setLimit(source.day_regens_limit ?? 3);
  if (setExempt && source?.planner_limits_exempt !== undefined) setExempt(source.planner_limits_exempt);
  if (setDaysUnlocked && source?.planner_days_unlocked !== undefined) setDaysUnlocked(source.planner_days_unlocked);
}

const BUDGETS: { id: BudgetLevel; label: string; emoji: string }[] = [
  { id: "budget", label: "Budget", emoji: "🪙" },
  { id: "moderate", label: "Moderate", emoji: "💰" },
  { id: "flexible", label: "Flexible", emoji: "💎" },
];

const LOADING_MSGS = [
  "Planning meals with your local foods",
  "Making sure macros are balanced",
  "Adding some cheat day surprises",
  "Finalizing your monthly menu",
];

const MEAL_EMOJI: Record<string, string> = {
  Breakfast: "🌅",
  Lunch: "🍛",
  Snack: "🥜",
  Dinner: "🌙",
  Pre_Workout: "⚡",
  Post_Workout: "💪",
};

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function renderProteinIcon(icon: ProteinSuggestionIcon) {
  const map: Record<ProteinSuggestionIcon, keyof typeof Ionicons.glyphMap> = {
    shake: "water-outline",
    bar: "nutrition-outline",
    egg: "egg-outline",
    meal: "restaurant-outline",
    dairy: "cafe-outline",
    legume: "leaf-outline",
    meat: "fish-outline",
  };
  return <Ionicons name={map[icon] ?? "nutrition-outline"} size={18} color="#F87171" />;
}

function renderSupplementIcon(icon: SupplementIcon) {
  const map: Record<SupplementIcon, keyof typeof Ionicons.glyphMap> = {
    pill: "medical-outline",
    sun: "sunny-outline",
    mineral: "diamond-outline",
    fish: "fish-outline",
    shake: "water-outline",
    power: "flash-outline",
    leaf: "leaf-outline",
    metabolic: "pulse-outline",
  };
  return <Ionicons name={map[icon] ?? "medical-outline"} size={16} color="#A78BFA" />;
}

function SupplementItem({ supplement }: { supplement: SupplementRecommendation }) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  return (
    <Pressable
      onPress={toggleExpanded}
      style={({ pressed }) => [
        styles.supplementItem,
        expanded && styles.supplementItemExpanded,
        pressed && styles.supplementItemPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={supplement.name}
    >
      <View style={styles.supplementItemIcon}>{renderSupplementIcon(supplement.icon)}</View>
      <View style={styles.supplementItemBody}>
        <View style={styles.supplementItemRow}>
          <Text style={styles.supplementItemName}>{supplement.name}</Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color="#475569" />
        </View>
        <Text style={styles.supplementMeta} numberOfLines={expanded ? undefined : 2}>
          {supplement.dose} · {supplement.when}
        </Text>
        <View style={styles.benefitTagsRow}>
          {supplement.tags.map((tag, i) => (
            <View key={i} style={styles.benefitTag}>
              <Text style={styles.benefitTagText}>{tag}</Text>
            </View>
          ))}
        </View>
        {expanded ? <Text style={styles.supplementBenefit}>{supplement.benefit}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function MonthlyMealPlannerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { colors, radius } = useAppTheme();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [plannerMode, setPlannerMode] = useState<"weekly" | "monthly">("weekly");
  const [weeks, setWeeks] = useState<WeekTab[]>([]);
  const [selectedWeekStart, setSelectedWeekStart] = useState<number | null>(null);
  const [plan, setPlan] = useState<MealPlanCurrent | null>(null);
  const [selectedDay, setSelectedDay] = useState(now.getDate());
  const [dayDetail, setDayDetail] = useState<MealDayPlan | null>(null);
  const [budget, setBudget] = useState<BudgetLevel>("budget");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [onboardingPreview, setOnboardingPreview] = useState({ meals: 3, kcal: 2200 });
  const [plannerLimitsExempt, setPlannerLimitsExempt] = useState(false);
  const [plannerDaysUnlocked, setPlannerDaysUnlocked] = useState(false);
  const [showRegenerateSheet, setShowRegenerateSheet] = useState(false);
  const [showRegenerateDaySheet, setShowRegenerateDaySheet] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateDayTarget, setRegenerateDayTarget] = useState<number | null>(null);
  const [swappingMeal, setSwappingMeal] = useState<string | null>(null);
  const [showSwapSheet, setShowSwapSheet] = useState(false);
  const [swapTarget, setSwapTarget] = useState<{ day: number; mealType: string } | null>(null);
  const [mealSwapsUsed, setMealSwapsUsed] = useState(0);
  const [isRegeneratingDay, setIsRegeneratingDay] = useState(false);
  const [dayRegensUsed, setDayRegensUsed] = useState(0);
  const [dayRegensLimit, setDayRegensLimit] = useState(3);
  const [proteinSuggestions, setProteinSuggestions] = useState<ProteinSuggestion[] | null>(null);
  const [proteinGap, setProteinGap] = useState(0);
  const [loadingProteinSuggestions, setLoadingProteinSuggestions] = useState(false);
  const [supplements, setSupplements] = useState<SupplementRecommendation[] | null>(null);
  const [supplementGoalLabel, setSupplementGoalLabel] = useState("General Health");
  const [loadingSupplements, setLoadingSupplements] = useState(false);
  const [supplementsLoaded, setSupplementsLoaded] = useState(false);
  const [supplementsCardExpanded, setSupplementsCardExpanded] = useState(false);
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const signedInEmail = String(auth.currentUser?.email || "")
    .trim()
    .toLowerCase();
  const plannerDaysUnlockedByIdentity =
    PLANNER_DAYS_UNLOCK_EMAILS.has(signedInEmail) ||
    (sessionUserId ? PLANNER_DAYS_UNLOCK_USER_IDS.has(sessionUserId) : false);
  const plannerLimitsExemptByIdentity =
    PLANNER_DAYS_UNLOCK_EMAILS.has(signedInEmail) ||
    (sessionUserId ? PLANNER_DAYS_UNLOCK_USER_IDS.has(sessionUserId) : false);
  const effectiveLimitsExempt = plannerLimitsExempt || plannerLimitsExemptByIdentity;
  const canViewFutureDays = plannerDaysUnlocked || plannerDaysUnlockedByIdentity;
  const mealSwapsLimit = 5;
  const dayRegensRemaining = Math.max(0, dayRegensLimit - dayRegensUsed);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialLoadDoneRef = useRef(false);
  const loadSeqRef = useRef(0);
  const lastDayFetchRef = useRef<{ planId: number; day: number } | null>(null);

  const selectedOverview = plan?.month_overview.find((d) => d.day === selectedDay);
  const isCurrentOrFuture = Boolean(selectedOverview && !selectedOverview.is_past && plan);
  const canSwapMeals = Boolean(selectedOverview && (canViewFutureDays || !selectedOverview.is_future) && plan);
  const swapsRemaining = mealSwapsLimit - mealSwapsUsed;

  const dailyTargets = useMemo(() => {
    const kcal = dayDetail?.target_kcal ?? plan?.targets?.kcal ?? onboardingPreview.kcal;
    const protein = dayDetail?.target_protein_g ?? plan?.targets?.protein_g;
    const carbs = dayDetail?.target_carbs_g ?? plan?.targets?.carbs_g;
    const fat = dayDetail?.target_fat_g ?? plan?.targets?.fat_g;
    return { kcal, protein, carbs, fat };
  }, [dayDetail, plan?.targets, onboardingPreview.kcal]);

  const loadWeekPlan = useCallback(async (weekStart: number, weekMeta: WeekTab) => {
    if (!weekMeta.is_generated) {
      setPlan(null);
      return;
    }
    try {
      const weekPlan = await fetchWeekPlan(weekStart);
      syncRegenStats(weekPlan, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      setPlan(weekPlan);
      setSelectedDay((prev) => {
        if (weekPlan.month_overview.some((d) => d.day === prev)) return prev;
        const todayInWeek = weekPlan.month_overview.find((d) => d.is_today);
        if (todayInWeek) return todayInWeek.day;
        return weekPlan.month_overview[0]?.day ?? prev;
      });
      lastDayFetchRef.current = null;
    } catch {
      setPlan(null);
    }
  }, []);

  const loadPlan = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++loadSeqRef.current;
    if (!opts?.silent && !initialLoadDoneRef.current) {
      setLoading(true);
    }
    try {
      const overview = await fetchWeeksOverview();
      if (seq !== loadSeqRef.current) return;

      setWeeks(overview.weeks);
      const currentWeek = overview.weeks.find((w) => w.is_current) ?? overview.weeks[0];

      setSelectedWeekStart((prev) => {
        if (prev != null && overview.weeks.some((w) => w.start_day === prev)) return prev;
        return currentWeek?.start_day ?? null;
      });

      const current = await fetchMealPlanCurrent();
      if (seq !== loadSeqRef.current) return;

      if (current && isWeeklyPlannerCurrent(current)) {
        setPlannerMode("weekly");
        syncRegenStats(current, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        if (current.current_week) {
          syncRegenStats(current.current_week, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
          setPlan(current.current_week);
          setSelectedDay((prev) => {
            const cw = current.current_week!;
            if (cw.month_overview.some((d) => d.day === prev)) return prev;
            return cw.today?.day ?? cw.month_overview.find((d) => d.is_today)?.day ?? prev;
          });
          lastDayFetchRef.current = null;
        } else if (currentWeek?.is_generated) {
          await loadWeekPlan(currentWeek.start_day, currentWeek);
        } else {
          setPlan(null);
          setDayDetail(null);
        }
      } else if (current) {
        setPlannerMode("monthly");
        syncRegenStats(current, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        setPlan(current);
        setSelectedDay((prev) => current.today?.day ?? prev);
        lastDayFetchRef.current = null;
      } else if (currentWeek) {
        setPlannerMode("weekly");
        if (currentWeek.is_generated) {
          await loadWeekPlan(currentWeek.start_day, currentWeek);
        } else {
          setPlan(null);
          setDayDetail(null);
        }
      }
    } catch {
      if (seq === loadSeqRef.current) {
        setPlan(null);
        setDayDetail(null);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        initialLoadDoneRef.current = true;
        setLoading(false);
      }
    }
  }, [loadWeekPlan]);

  useFocusEffect(
    useCallback(() => {
      void loadPlan({ silent: initialLoadDoneRef.current });
    }, [loadPlan]),
  );

  useEffect(() => {
    void (async () => {
      try {
        const ob = await fetchOnboardingMe();
        const dietary = ob?.onboarding?.dietary;
        const targets = ob?.targets;
        setOnboardingPreview({
          meals: Number(dietary?.meals_per_day ?? 3),
          kcal: Number(targets?.target_kcal ?? 2200),
        });
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  useEffect(() => {
    if (!plan) {
      setDayDetail(null);
      return;
    }

    const overview = plan.month_overview.find((d) => d.day === selectedDay);
    if (overview?.is_future && !canViewFutureDays) {
      setDayDetail({
        day: selectedDay,
        is_cheat_day: false,
        locked: true,
        message: `This plan unlocks on ${fullDayLabel(month, year, selectedDay)}`,
        meals: [],
        total_calories: 0,
        total_protein_g: 0,
        total_carbs_g: 0,
        total_fat_g: 0,
        total_fiber_g: 0,
      });
      return;
    }

    const planWithDays = plan as MealPlanCurrent & { days?: MealDayPlan[] };
    const embedded = planWithDays.days?.find((d) => d.day === selectedDay);
    if (embedded?.meals?.length) {
      lastDayFetchRef.current = { planId: plan.plan_id, day: selectedDay };
      setDayDetail(embedded);
      if (typeof embedded.swaps_used_today === "number") setMealSwapsUsed(embedded.swaps_used_today);
      syncRegenStats(embedded, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      syncRegenStats(plan, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      return;
    }

    const fetchKey = { planId: plan.plan_id, day: selectedDay };
    if (lastDayFetchRef.current?.planId === fetchKey.planId && lastDayFetchRef.current?.day === fetchKey.day) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchMealPlanDay(selectedDay);
        if (cancelled) return;
        lastDayFetchRef.current = fetchKey;
        setDayDetail(d);
        if (typeof d.swaps_used_today === "number") setMealSwapsUsed(d.swaps_used_today);
        syncRegenStats(d, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      } catch {
        if (!cancelled) setDayDetail(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan, selectedDay, month, year, canViewFutureDays]);

  const loadDayExtras = useCallback(
    async (dayData: MealDayPlan) => {
      if (dayData.locked || !plan) {
        setProteinGap(0);
        setProteinSuggestions(null);
        return;
      }

      const target = dayData.target_protein_g ?? dailyTargets.protein ?? 0;
      const consumed = dayData.total_protein_g ?? 0;
      const gap = Math.max(0, target - consumed);
      setProteinGap(gap);

      if (gap > 10) {
        setLoadingProteinSuggestions(true);
        try {
          const res = await fetchProteinSuggestions(plan.plan_id, selectedDay);
          setProteinSuggestions(res.suggestions);
        } catch {
          setProteinSuggestions(null);
        } finally {
          setLoadingProteinSuggestions(false);
        }
      } else {
        setProteinSuggestions([]);
      }

      if (!supplementsLoaded) {
        setLoadingSupplements(true);
        try {
          const res = await fetchSupplementRecommendations();
          setSupplements(res.supplements);
          setSupplementGoalLabel(res.goal_label);
          setSupplementsLoaded(true);
        } catch {
          setSupplements(null);
        } finally {
          setLoadingSupplements(false);
        }
      }
    },
    [plan, selectedDay, dailyTargets.protein, supplementsLoaded],
  );

  useEffect(() => {
    if (dayDetail && !dayDetail.locked) {
      void loadDayExtras(dayDetail);
    } else {
      setProteinGap(0);
      setProteinSuggestions(null);
    }
  }, [dayDetail, loadDayExtras]);

  const startGenerateWeek = async () => {
    if (selectedWeekStart == null) return;
    setGenerating(true);
    try {
      const created = await generateWeekPlan(budget, selectedWeekStart);
      lastDayFetchRef.current = null;
      setPlan(created);
      if (created.today?.day) setSelectedDay(created.today.day);
      const overview = await fetchWeeksOverview();
      setWeeks(overview.weeks);
      syncRegenStats(created, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      notifyUser("Done", "Week meals generated!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not generate week";
      Alert.alert("Generation failed", msg);
    } finally {
      setGenerating(false);
    }
  };

  const startGenerate = async () => {
    if (plannerMode === "weekly") {
      await startGenerateWeek();
      return;
    }
    setGenerating(true);
    setGenStep(0);
    progressTimer.current = setInterval(() => {
      setGenStep((s) => Math.min(s + 1, 4));
    }, 5000);
    try {
      const created = await generateMealPlan(budget);
      lastDayFetchRef.current = null;
      setPlan(created);
      if (created.today?.day) setSelectedDay(created.today.day);
      syncRegenStats(created, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not generate meal plan";
      Alert.alert("Generation failed", msg);
    } finally {
      if (progressTimer.current) clearInterval(progressTimer.current);
      setGenerating(false);
    }
  };

  const handleSelectWeek = (week: WeekTab) => {
    if (week.start_day === selectedWeekStart) return;

    setSelectedWeekStart(week.start_day);
    lastDayFetchRef.current = null;

    if (week.is_generated) {
      const sameWeekPlan = plan?.week_start_day === week.start_day;
      if (!sameWeekPlan) {
        void loadWeekPlan(week.start_day, week);
      }
      setSelectedDay((prev) => {
        if (week.start_day <= prev && prev <= week.end_day) return prev;
        return week.is_current ? now.getDate() : week.start_day;
      });
    } else {
      setPlan(null);
      setDayDetail(null);
      setSelectedDay(week.is_current ? now.getDate() : week.start_day);
    }
  };

  const handleSwapPress = (day: number, mealType: string) => {
    if (!canSwapMeals || swapsRemaining <= 0) {
      notifyUser("Swap limit", swapsRemaining <= 0 ? "5/5 swaps used today" : "Future days cannot be edited");
      return;
    }
    setSwapTarget({ day, mealType });
    setShowSwapSheet(true);
  };

  const handleSwapConfirm = async (reason?: string) => {
    if (!swapTarget || !plan) return;
    setShowSwapSheet(false);
    setSwappingMeal(swapTarget.mealType);
    try {
      const updated = await swapMealPlanMeal({
        plan_id: plan.plan_id,
        day: swapTarget.day,
        meal_type: swapTarget.mealType,
        reason,
      });
      setDayDetail(updated);
      if (typeof updated.swaps_used_today === "number") setMealSwapsUsed(updated.swaps_used_today);
      notifyUser("Done", "Meal replaced!");
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number; data?: { detail?: string } } })?.response?.status;
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 429) {
        setMealSwapsUsed(mealSwapsLimit);
        notifyUser("Swap limit", detail || "You've used all your swaps for today.");
      } else {
        Alert.alert("Error", "Could not replace meal. Try again.");
      }
    } finally {
      setSwappingMeal(null);
      setSwapTarget(null);
    }
  };

  const apiErrorMessage = (e: unknown, fallback: string) => {
    const data = (e as { response?: { data?: { detail?: unknown } } })?.response?.data;
    const detail = data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const msg = detail
        .map((item) => (typeof item === "object" && item && "msg" in item ? String((item as { msg: string }).msg) : String(item)))
        .filter(Boolean)
        .join("\n");
      if (msg) return msg;
    }
    if ((e as { code?: string }).code === "ECONNABORTED") {
      return "Regeneration is taking longer than expected. Wait a moment, refresh the plan, and try again if the meals did not update.";
    }
    return fallback;
  };

  const handleRegenerateDay = (day: number) => {
    if (!plan) return;
    if (!effectiveLimitsExempt && dayRegensRemaining <= 0) {
      Alert.alert(
        "No Refreshes Remaining",
        "You have used all 3 day refreshes for this month. You can still swap individual meals using the swap icon on each meal card.",
      );
      return;
    }
    setRegenerateDayTarget(day);
    setShowRegenerateDaySheet(true);
  };

  const handleRegenerateDayConfirm = async () => {
    if (!plan || regenerateDayTarget == null) return;
    const day = regenerateDayTarget;
    setShowRegenerateDaySheet(false);
    setRegenerateDayTarget(null);
    setIsRegeneratingDay(true);
    try {
      const existingMealNames =
        dayDetail?.meals?.flatMap((meal) => meal.items.map((item) => item.food)) ?? [];
      const updated = await regenerateMealPlanDay({
        plan_id: plan.plan_id,
        day,
        exclude_foods: [...new Set(existingMealNames)],
        exclude_dishes:
          dayDetail?.meals?.map((m) => ({
            meal_type: m.meal_type,
            foods: m.items.map((i) => i.food),
          })) ?? [],
      });
      setDayDetail(updated);
      syncRegenStats(updated, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      if (selectedWeekStart != null) {
        const refreshedWeek = await fetchWeekPlan(selectedWeekStart);
        lastDayFetchRef.current = null;
        syncRegenStats(refreshedWeek, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        setPlan(refreshedWeek);
      }
      notifyUser("Done", "Day meals regenerated!");
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        setDayRegensUsed(dayRegensLimit);
        notifyUser("Limit reached", apiErrorMessage(e, "You've used all day refreshes for this month."));
      } else {
        notifyUser("Error", apiErrorMessage(e, "Could not regenerate meals. Try again."));
      }
    } finally {
      setIsRegeneratingDay(false);
    }
  };

  const handleRegeneratePress = () => {
    setShowRegenerateSheet(true);
  };

  const handleRegenerateConfirm = async () => {
    setShowRegenerateSheet(false);
    setIsRegenerating(true);
    const currentDay = now.getDate();
    const monthName = now.toLocaleString(undefined, { month: "long" });
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const weekEndDay = selectedWeekMeta?.end_day ?? lastDayOfMonth;
    try {
      if (plannerMode === "weekly" && selectedWeekStart != null) {
        const currentWeekFoods =
          (plan as MealPlanCurrent & { days?: MealDayPlan[] }).days?.flatMap(
            (day) => day.meals?.flatMap((meal) => meal.items.map((item) => item.food)) ?? [],
          ) ?? [];

        const currentWeekDishes =
          (plan as MealPlanCurrent & { days?: MealDayPlan[] }).days?.flatMap(
            (day) =>
              day.meals?.map((meal) => ({
                meal_type: meal.meal_type,
                foods: meal.items.map((i) => i.food),
              })) ?? [],
          ) ?? [];

        const updated = await regenerateWeek(selectedWeekStart, currentDay, {
          exclude_foods: [...new Set(currentWeekFoods)],
          exclude_dishes: currentWeekDishes,
        });
        lastDayFetchRef.current = null;
        syncRegenStats(updated, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        setPlan(updated);
        const viewDay = selectedDay >= currentDay ? selectedDay : currentDay;
        const selectedDayInUpdatedPlan = updated.month_overview.some((d) => d.day === viewDay) ? viewDay : currentDay;
        setSelectedDay(selectedDayInUpdatedPlan);
        const updatedDays = (updated as MealPlanCurrent & { days?: MealDayPlan[] }).days;
        const embeddedDay = updatedDays?.find((d) => d.day === selectedDayInUpdatedPlan);
        if (embeddedDay?.meals?.length) {
          lastDayFetchRef.current = { planId: updated.plan_id, day: selectedDayInUpdatedPlan };
          setDayDetail(embeddedDay);
          if (typeof embeddedDay.swaps_used_today === "number") setMealSwapsUsed(embeddedDay.swaps_used_today);
        } else {
          const dayData = await fetchMealPlanDay(selectedDayInUpdatedPlan);
          lastDayFetchRef.current = { planId: updated.plan_id, day: selectedDayInUpdatedPlan };
          setDayDetail(dayData);
          if (typeof dayData.swaps_used_today === "number") setMealSwapsUsed(dayData.swaps_used_today);
        }
        notifyUser("Done", "Meals regenerated for this week!");
      } else {
        const currentWeekFoods =
          (plan as MealPlanCurrent & { days?: MealDayPlan[] }).days?.flatMap(
            (day) => day.meals?.flatMap((meal) => meal.items.map((item) => item.food)) ?? [],
          ) ?? [];
        const currentWeekDishes =
          (plan as MealPlanCurrent & { days?: MealDayPlan[] }).days?.flatMap(
            (day) =>
              day.meals?.map((meal) => ({
                meal_type: meal.meal_type,
                foods: meal.items.map((i) => i.food),
              })) ?? [],
          ) ?? [];
        const updated = await regenerateRemainingMeals(currentDay, {
          exclude_foods: [...new Set(currentWeekFoods)],
          exclude_dishes: currentWeekDishes,
        });
        lastDayFetchRef.current = null;
        syncRegenStats(updated, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        setPlan(updated);
        const viewDay = selectedDay >= currentDay ? selectedDay : currentDay;
        const selectedDayInUpdatedPlan = updated.month_overview.some((d) => d.day === viewDay) ? viewDay : currentDay;
        setSelectedDay(selectedDayInUpdatedPlan);
        const updatedDays = (updated as MealPlanCurrent & { days?: MealDayPlan[] }).days;
        const embeddedDay = updatedDays?.find((d) => d.day === selectedDayInUpdatedPlan);
        if (embeddedDay?.meals?.length) {
          lastDayFetchRef.current = { planId: updated.plan_id, day: selectedDayInUpdatedPlan };
          setDayDetail(embeddedDay);
          if (typeof embeddedDay.swaps_used_today === "number") setMealSwapsUsed(embeddedDay.swaps_used_today);
        } else {
          const dayData = await fetchMealPlanDay(selectedDayInUpdatedPlan);
          lastDayFetchRef.current = { planId: updated.plan_id, day: selectedDayInUpdatedPlan };
          setDayDetail(dayData);
          if (typeof dayData.swaps_used_today === "number") setMealSwapsUsed(dayData.swaps_used_today);
        }
        notifyUser("Done", `Meals regenerated from ${monthName} ${currentDay}!`);
      }
    } catch (e: unknown) {
      Alert.alert("Error", apiErrorMessage(e, "Could not regenerate meals. Try again."));
    } finally {
      setIsRegenerating(false);
    }
  };

  const selectedWeekMeta = useMemo(
    () => weeks.find((w) => w.start_day === selectedWeekStart) ?? null,
    [weeks, selectedWeekStart],
  );

  const calendarDays = useMemo(() => {
    const source = plan?.month_overview ?? [];
    if (plannerMode === "weekly" && selectedWeekMeta) {
      return source
        .filter((d) => d.day >= selectedWeekMeta.start_day && d.day <= selectedWeekMeta.end_day)
        .map((d) => ({
          day: d.day,
          is_past: d.is_past,
          is_today: d.is_today,
          is_future: d.is_future,
          is_cheat_day: d.is_cheat_day,
        }));
    }
    return source.map((d) => ({
      day: d.day,
      is_past: d.is_past,
      is_today: d.is_today,
      is_future: d.is_future,
      is_cheat_day: d.is_cheat_day,
    }));
  }, [plan, plannerMode, selectedWeekMeta]);

  const totalCost = useMemo(() => {
    if (!dayDetail?.meals) return 0;
    return dayDetail.meals.reduce((s, m) => s + (m.estimated_cost_inr || 0), 0);
  }, [dayDetail]);

  const totalPrep = useMemo(() => {
    if (!dayDetail?.meals) return 0;
    return dayDetail.meals.reduce((s, m) => s + (m.prep_time_min || 0), 0);
  }, [dayDetail]);

  const headerTitle = monthYearLabel(month, year);
  const currentDay = now.getDate();
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const monthName = now.toLocaleString(undefined, { month: "long" });
  const weekEndDay = selectedWeekMeta?.end_day ?? lastDayOfMonth;
  const shouldShowRegenerate = effectiveLimitsExempt && Boolean(plan) && currentDay <= weekEndDay;
  const regenRangeLabel =
    plannerMode === "weekly"
      ? `${monthName} ${currentDay} – ${monthName} ${weekEndDay}`
      : `${monthName} ${currentDay} – ${monthName} ${lastDayOfMonth}`;
  const showWeekGeneratePanel = plannerMode === "weekly" && !plan && !generating && selectedWeekMeta?.can_generate;
  const showMonthlyGeneratePanel = plannerMode === "monthly" && !plan && !generating;

  if (loading) {
    return (
      <ScreenContainer>
        <ActivityIndicator color="#22d3ee" style={{ marginTop: 40 }} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={[styles.backBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.md }]}>
          <Text style={{ color: colors.text }}>←</Text>
        </Pressable>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Monthly Meal Planner</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{headerTitle}</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {(showWeekGeneratePanel || showMonthlyGeneratePanel) ? (
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>
              {plannerMode === "weekly" && selectedWeekMeta
                ? `Generate meals for ${selectedWeekMeta.label}`
                : `Generate your meal plan for ${headerTitle}`}
            </Text>
            <Text style={[styles.label, { color: colors.muted }]}>Budget preference:</Text>
            <View style={styles.pills}>
              {BUDGETS.map((b) => (
                <Pressable key={b.id} style={[styles.pill, budget === b.id && styles.pillOn]} onPress={() => setBudget(b.id)}>
                  <Text style={[styles.pillText, budget === b.id && styles.pillTextOn]}>{b.emoji} {b.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ {onboardingPreview.meals} meals per day</Text>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ ~{onboardingPreview.kcal} kcal daily target</Text>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ Foods available in your area</Text>
            <Text style={[styles.bullet, { color: colors.muted }]}>✓ Respects your dietary preferences</Text>
            {plannerMode === "monthly" ? (
              <Text style={[styles.bullet, { color: colors.muted }]}>✓ 2 surprise cheat days</Text>
            ) : (
              <Text style={[styles.bullet, { color: colors.muted }]}>✓ One week at a time — fast & reliable</Text>
            )}
            <Pressable style={styles.genBtn} onPress={() => void startGenerate()}>
              <Text style={styles.genBtnText}>
                {plannerMode === "weekly" ? "🤖 Generate This Week" : "🤖 Generate My Meal Plan"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {generating ? (
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>
              {plannerMode === "weekly" ? "🍳 Planning your week..." : "🍳 Cooking up your meal plan..."}
            </Text>
            {plannerMode === "monthly" ? (
              <>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, (genStep / 4) * 100)}%` }]} />
                </View>
                <Text style={{ color: colors.muted, marginTop: 8 }}>Week {Math.min(4, Math.max(1, genStep))} of 4</Text>
                <Text style={{ color: colors.muted, marginTop: 12 }}>{LOADING_MSGS[genStep % LOADING_MSGS.length]}</Text>
              </>
            ) : (
              <Text style={{ color: colors.muted, marginTop: 12 }}>This takes about 10 seconds</Text>
            )}
            <ActivityIndicator color="#22d3ee" style={{ marginTop: 16 }} />
          </View>
        ) : null}

        {plannerMode === "weekly" && weeks.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekTabsScroll}>
            {weeks.map((w) => {
              const selected = w.start_day === selectedWeekStart;
              const icon = w.is_generated ? "✓" : w.is_current ? "●" : "";
              return (
                <Pressable
                  key={w.start_day}
                  onPress={() => handleSelectWeek(w)}
                  style={[
                    styles.weekTab,
                    {
                      borderColor: selected ? "#22d3ee" : colors.border,
                      backgroundColor: selected ? "rgba(34,211,238,0.12)" : colors.card,
                    },
                  ]}
                >
                  <Text style={{ color: selected ? "#22d3ee" : colors.text, fontWeight: "700", fontSize: 12 }}>
                    Week {w.week_number} {icon}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>
                    {w.start_day}–{w.end_day}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {plan && !generating ? (
          <>
            {plan.week_label ? (
              <Text style={{ color: colors.muted, marginBottom: 8, fontSize: 13 }}>{plan.week_label}</Text>
            ) : null}
            <PlannerMonthCalendar
              month={plan.month}
              year={plan.year}
              days={calendarDays}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              mode="meal"
              allowFutureSelection={canViewFutureDays}
            />

            {dayDetail?.locked ? (
              <View style={[styles.locked, { borderColor: colors.border, borderRadius: radius.lg }]}>
                <Text style={{ fontSize: 32 }}>🔒</Text>
                <Text style={{ color: colors.muted, marginTop: 8 }}>{dayDetail.message}</Text>
              </View>
            ) : dayDetail ? (
              <>
                {dayDetail.is_cheat_day ? (
                  <LinearGradient colors={["#f97316", "#fbbf24"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.cheatBanner, { borderRadius: radius.lg }]}>
                    <Text style={styles.cheatTitle}>🎉 CHEAT DAY!</Text>
                    <Text style={styles.cheatBody}>Enjoy something special today. Calories can go ~20% over your target. You've earned it!</Text>
                  </LinearGradient>
                ) : null}

                <View style={[styles.dayHeader, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
                  <View style={styles.dayHeaderTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.dayTitle, { color: colors.text }]}>
                        📅 Day {dayDetail.day} — {fullDayLabel(plan.month, plan.year, dayDetail.day)}
                        {plan.month_overview.find((d) => d.day === dayDetail.day)?.is_past ? " — Completed" : ""}
                      </Text>
                    </View>
                    {isCurrentOrFuture ? (
                      <Pressable
                        onPress={() => handleRegenerateDay(dayDetail.day)}
                        style={[
                          styles.regenerateDayButton,
                          (isRegeneratingDay || (!effectiveLimitsExempt && dayRegensRemaining <= 0)) &&
                            styles.regenerateDayButtonDisabled,
                        ]}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        disabled={isRegeneratingDay || (!effectiveLimitsExempt && dayRegensRemaining <= 0)}
                      >
                        {isRegeneratingDay ? (
                          <ActivityIndicator size="small" color="#22D3EE" />
                        ) : (
                          <>
                            <Ionicons
                              name="refresh"
                              size={14}
                              color={effectiveLimitsExempt || dayRegensRemaining > 0 ? "#22D3EE" : "#475569"}
                            />
                            <Text
                              style={[
                                styles.regenerateDayButtonText,
                                !effectiveLimitsExempt && dayRegensRemaining <= 0 && styles.regenerateDayButtonTextDisabled,
                              ]}
                            >
                              Day
                            </Text>
                          </>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.muted }}>Daily Target: {dailyTargets.kcal} kcal</Text>
                  {dailyTargets.protein != null && dailyTargets.carbs != null && dailyTargets.fat != null ? (
                    <Text style={{ color: colors.muted, marginTop: 4 }}>
                      P: {dailyTargets.protein}g · C: {dailyTargets.carbs}g · F: {dailyTargets.fat}g
                    </Text>
                  ) : null}
                </View>

                <View style={styles.regenCounterBar}>
                  <Ionicons
                    name="refresh-circle-outline"
                    size={16}
                    color={effectiveLimitsExempt || dayRegensRemaining > 0 ? "#22D3EE" : "#475569"}
                  />
                  <Text style={[styles.regenCounterText, !effectiveLimitsExempt && dayRegensRemaining === 0 && styles.regenCounterTextExhausted]}>
                    {effectiveLimitsExempt
                      ? "Test account — unlimited day refreshes, swaps, and full regeneration"
                      : dayRegensRemaining > 0
                        ? `${dayRegensRemaining} of ${dayRegensLimit} day refreshes remaining this month`
                        : "No day refreshes remaining this month — swap individual meals instead"}
                  </Text>
                </View>

                {canSwapMeals && swapsRemaining <= 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>5/5 meal swaps used today</Text>
                ) : null}

                {isRegeneratingDay ? (
                  <View style={styles.dayRegeneratingOverlay}>
                    <ActivityIndicator size="large" color="#22D3EE" />
                    <Text style={styles.dayRegeneratingText}>Generating fresh meals for this day...</Text>
                    <Text style={styles.dayRegeneratingSubtext}>Takes about 5–10 seconds</Text>
                  </View>
                ) : (
                  dayDetail.meals.map((meal) => {
                  const key = `${dayDetail.day}-${meal.meal_type}`;
                  const isCollapsed = collapsed[key];
                  const isSwapping = swappingMeal === meal.meal_type;
                  return (
                    <View key={key} style={[styles.mealCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
                      <View style={styles.mealHeaderRow}>
                        <Pressable style={{ flex: 1 }} onPress={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}>
                          <Text style={[styles.mealTitle, { color: colors.text }]}>
                            {MEAL_EMOJI[meal.meal_type] ?? "🍽"} {meal.meal_type.replace("_", " ")} · {meal.time}
                          </Text>
                          <Text style={{ color: colors.muted, marginTop: 4 }}>
                            ⏱ {meal.prep_time_min} min · ₹{meal.estimated_cost_inr}
                          </Text>
                        </Pressable>
                        {canSwapMeals && swapsRemaining > 0 ? (
                          <Pressable
                            style={styles.swapButton}
                            onPress={() => handleSwapPress(dayDetail.day, meal.meal_type)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Ionicons name="swap-horizontal" size={18} color="#22D3EE" />
                          </Pressable>
                        ) : null}
                      </View>
                      {isSwapping ? (
                        <View style={styles.swapLoadingContainer}>
                          <ActivityIndicator color="#22D3EE" size="small" />
                          <Text style={styles.swapLoadingText}>Finding a replacement...</Text>
                        </View>
                      ) : !isCollapsed ? (
                        <View style={{ marginTop: 10 }}>
                          {meal.items.map((item, idx) => (
                            <View key={idx} style={styles.foodRow}>
                              <Text style={{ color: colors.text, flex: 1 }}>{item.food}</Text>
                              <Text style={{ color: colors.muted }}>{item.quantity_g}g</Text>
                              <Text style={{ color: colors.muted, width: 72, textAlign: "right" }}>{item.calories} kcal</Text>
                            </View>
                          ))}
                          <Text style={{ color: colors.muted, marginTop: 8 }}>
                            Total: {meal.total_calories} kcal · P: {meal.total_protein}g · C: {meal.total_carbs}g · F: {meal.total_fat}g
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                  })
                )}

                <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}>
                  <Text style={[styles.summaryTitle, { color: colors.text }]}>DAILY SUMMARY</Text>
                  <Text style={{ color: colors.muted, marginTop: 8 }}>
                    {dayDetail.total_calories} / {dailyTargets.kcal} kcal
                  </Text>
                  <Text style={{ color: dayDetail.total_protein_g >= (dailyTargets.protein ?? 0) ? "#4ade80" : colors.muted, marginTop: 6 }}>
                    Protein {dayDetail.total_protein_g}g{dailyTargets.protein != null ? ` / ${dailyTargets.protein}g` : ""}
                    {dailyTargets.protein != null && dayDetail.total_protein_g >= dailyTargets.protein ? " ✓" : ""}
                  </Text>
                  <Text style={{ color: dayDetail.total_carbs_g >= (dailyTargets.carbs ?? 0) ? "#4ade80" : colors.muted }}>
                    Carbs {dayDetail.total_carbs_g}g{dailyTargets.carbs != null ? ` / ${dailyTargets.carbs}g` : ""}
                    {dailyTargets.carbs != null && dayDetail.total_carbs_g >= dailyTargets.carbs ? " ✓" : ""}
                  </Text>
                  <Text style={{ color: dayDetail.total_fat_g >= (dailyTargets.fat ?? 0) ? "#4ade80" : colors.muted }}>
                    Fat {dayDetail.total_fat_g}g{dailyTargets.fat != null ? ` / ${dailyTargets.fat}g` : ""}
                    {dailyTargets.fat != null && dayDetail.total_fat_g >= dailyTargets.fat ? " ✓" : ""}
                  </Text>
                  <Text style={{ color: colors.muted, marginTop: 10 }}>Estimated cost: ₹{totalCost}</Text>
                  <Text style={{ color: colors.muted }}>Total prep time: ~{totalPrep} min</Text>
                </View>

                {proteinGap > 10 ? (
                  <View style={styles.suggestionCard}>
                    <View style={styles.suggestionHeader}>
                      <View style={styles.suggestionHeaderLeft}>
                        <Ionicons name="barbell-outline" size={18} color="#F87171" />
                        <Text style={styles.suggestionTitle}>Protein Gap: {proteinGap}g short</Text>
                      </View>
                      <View style={styles.proteinGapBadge}>
                        <Text style={styles.proteinGapBadgeText}>
                          {dayDetail.total_protein_g}g / {dayDetail.target_protein_g ?? dailyTargets.protein ?? 0}g
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.suggestionSubtitle}>Add these to hit your protein target today:</Text>
                    {loadingProteinSuggestions ? (
                      <View style={styles.suggestionLoading}>
                        <ActivityIndicator size="small" color="#F87171" />
                        <Text style={styles.suggestionLoadingText}>Finding protein sources...</Text>
                      </View>
                    ) : (
                      proteinSuggestions?.map((s, i) => (
                        <View key={`${s.title}-${i}`} style={styles.suggestionItem}>
                          <View style={styles.suggestionItemIcon}>{renderProteinIcon(s.icon)}</View>
                          <View style={styles.suggestionItemContent}>
                            <View style={styles.suggestionItemHeader}>
                              <Text style={styles.suggestionItemTitle}>{s.title}</Text>
                              <Text style={styles.suggestionItemProtein}>+{s.protein_g}g</Text>
                            </View>
                            <Text style={styles.suggestionItemDesc}>{s.description}</Text>
                            <View style={styles.suggestionItemMeta}>
                              <Ionicons name="time-outline" size={12} color="#64748B" />
                              <Text style={styles.suggestionItemTime}>{s.time_suggestion}</Text>
                              <Text style={styles.suggestionItemCost}>≈ ₹{s.estimated_cost_inr}</Text>
                            </View>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}

                {loadingSupplements ? (
                  <View style={styles.supplementCard}>
                    <ActivityIndicator size="small" color="#A78BFA" />
                    <Text style={[styles.supplementSubtitle, { marginTop: 8 }]}>Loading supplement recommendations...</Text>
                  </View>
                ) : supplements && supplements.length > 0 ? (
                  <View style={styles.supplementCard}>
                    <Pressable
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setSupplementsCardExpanded((prev) => !prev);
                      }}
                      style={({ pressed }) => [
                        styles.supplementHeaderPressable,
                        supplementsCardExpanded && styles.supplementHeaderPressableExpanded,
                        pressed && styles.supplementHeaderPressablePressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: supplementsCardExpanded }}
                      accessibilityLabel={`Supplements for ${supplementGoalLabel} goal`}
                    >
                      <Ionicons name="fitness-outline" size={18} color="#A78BFA" />
                      <View style={styles.supplementHeaderText}>
                        <Text style={styles.supplementTitle}>For Your {supplementGoalLabel} Goal</Text>
                        <Text style={styles.supplementSubtitle}>
                          {supplements.length} key supplements — updated monthly
                        </Text>
                      </View>
                      <Ionicons
                        name={supplementsCardExpanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color="#94A3B8"
                      />
                    </Pressable>
                    {supplementsCardExpanded
                      ? supplements.map((s, i) => <SupplementItem key={`${s.name}-${i}`} supplement={s} />)
                      : null}
                  </View>
                ) : null}

                {shouldShowRegenerate ? (
                  <View style={[styles.regen, { borderColor: colors.border, borderRadius: radius.lg }]}>
                    <Text style={{ color: colors.muted }}>Test mode — regenerate upcoming meals</Text>
                    <Pressable
                      disabled={isRegenerating}
                      onPress={handleRegeneratePress}
                      style={[styles.regenBtn, isRegenerating && { opacity: 0.5 }]}
                    >
                      <Text style={{ color: "#22d3ee", fontWeight: "700" }}>Regenerate {regenRangeLabel}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {isRegenerating ? (
        <View style={styles.regeneratingOverlay}>
          <ActivityIndicator size="large" color="#22D3EE" />
          <Text style={styles.regeneratingText}>Regenerating upcoming meals...</Text>
          <Text style={styles.regeneratingSubtext}>Your past meals are safe</Text>
        </View>
      ) : null}
      </View>

      <Modal visible={showRegenerateSheet} transparent animationType="slide" onRequestClose={() => setShowRegenerateSheet(false)}>
        <View style={styles.regenSheetBackdrop}>
          <Pressable style={styles.regenSheetBackdropTap} onPress={() => setShowRegenerateSheet(false)} />
          <View style={[styles.regenSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.regenSheetTitle, { color: colors.text }]}>Regenerate Upcoming Meals (Test)</Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>{regenRangeLabel}</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 12, lineHeight: 20 }}>
              {plannerMode === "weekly"
                ? `Regenerate meals from today through ${monthName} ${weekEndDay} for this week.`
                : `Regenerate your meal plan from today through ${monthName} ${lastDayOfMonth}.`}
            </Text>
            <View style={styles.regenSheetActions}>
              <Pressable style={[styles.regenSheetCancel, { borderColor: colors.border }]} onPress={() => setShowRegenerateSheet(false)}>
                <Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.regenSheetConfirm} onPress={() => void handleRegenerateConfirm()}>
                <Text style={{ color: "#0f172a", fontWeight: "800" }}>Regenerate</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRegenerateDaySheet}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowRegenerateDaySheet(false);
          setRegenerateDayTarget(null);
        }}
      >
        <View style={styles.regenSheetBackdrop}>
          <Pressable
            style={styles.regenSheetBackdropTap}
            onPress={() => {
              setShowRegenerateDaySheet(false);
              setRegenerateDayTarget(null);
            }}
          />
          <View style={[styles.regenSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.regenSheetTitle, { color: colors.text }]}>Regenerate this day?</Text>
            {regenerateDayTarget != null ? (
              <Text style={{ color: colors.muted, marginTop: 4 }}>
                {fullDayLabel(plan?.month ?? month, plan?.year ?? year, regenerateDayTarget)}
              </Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 12, lineHeight: 20 }}>
              This replaces every meal on this day with a fresh plan. Other days stay unchanged. You have{" "}
              {dayRegensRemaining} refresh{dayRegensRemaining !== 1 ? "es" : ""} remaining this month.
            </Text>
            <View style={styles.regenSheetActions}>
              <Pressable
                style={[styles.regenSheetCancel, { borderColor: colors.border }]}
                onPress={() => {
                  setShowRegenerateDaySheet(false);
                  setRegenerateDayTarget(null);
                }}
              >
                <Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.regenSheetConfirm} onPress={() => void handleRegenerateDayConfirm()}>
                <Text style={{ color: "#0f172a", fontWeight: "800" }}>
                  Regenerate ({dayRegensRemaining} left)
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <SwapBottomSheet
        visible={showSwapSheet}
        title={swapTarget ? `Replace ${swapTarget.mealType.replace("_", " ")}?` : "Replace meal?"}
        reasons={MEAL_SWAP_REASONS}
        confirmLabel="Replace Meal"
        onConfirm={(reason) => void handleSwapConfirm(reason)}
        onCancel={() => {
          setShowSwapSheet(false);
          setSwapTarget(null);
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  title: { fontSize: 20, fontWeight: "800" },
  sub: { fontSize: 13 },
  panel: { borderWidth: 1, padding: 16, marginBottom: 14 },
  panelTitle: { fontSize: 17, fontWeight: "700", marginBottom: 12 },
  label: { fontSize: 13, marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { borderWidth: 1, borderColor: "#334155", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  pillOn: { borderColor: "#22d3ee", backgroundColor: "rgba(34,211,238,0.12)" },
  pillText: { color: "#9AA8C4", fontSize: 13 },
  pillTextOn: { color: "#22d3ee", fontWeight: "700" },
  bullet: { fontSize: 13, marginBottom: 4 },
  genBtn: { marginTop: 16, backgroundColor: "#22d3ee", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  genBtnText: { color: "#0f172a", fontWeight: "800", fontSize: 15 },
  progressTrack: { height: 8, backgroundColor: "#1e293b", borderRadius: 4, overflow: "hidden", marginTop: 12 },
  progressFill: { height: 8, backgroundColor: "#22d3ee" },
  locked: { borderWidth: 1, padding: 32, alignItems: "center", marginVertical: 16 },
  cheatBanner: { padding: 14, marginBottom: 12 },
  cheatTitle: { color: "#fff", fontWeight: "800", fontSize: 16 },
  cheatBody: { color: "#fff", marginTop: 6, fontSize: 13 },
  dayHeader: { borderWidth: 1, padding: 14, marginBottom: 10 },
  dayHeaderTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  dayTitle: { fontSize: 15, fontWeight: "700" },
  regenerateDayButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(34, 211, 238, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(34, 211, 238, 0.3)",
  },
  regenerateDayButtonText: { color: "#22D3EE", fontSize: 12, fontWeight: "600" },
  regenerateDayButtonDisabled: {
    backgroundColor: "rgba(100, 116, 139, 0.06)",
    borderColor: "rgba(100, 116, 139, 0.15)",
  },
  regenerateDayButtonTextDisabled: { color: "#475569" },
  regenCounterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: "rgba(34, 211, 238, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(34, 211, 238, 0.12)",
  },
  regenCounterText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  regenCounterTextExhausted: { color: "#64748B" },
  dayRegeneratingOverlay: { padding: 40, alignItems: "center", justifyContent: "center", gap: 12 },
  dayRegeneratingText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600", textAlign: "center" },
  dayRegeneratingSubtext: { color: "#64748B", fontSize: 13, textAlign: "center" },
  mealCard: { borderWidth: 1, padding: 14, marginBottom: 10 },
  mealHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  swapButton: { padding: 6, borderRadius: 8, backgroundColor: "rgba(34, 211, 238, 0.1)" },
  swapLoadingContainer: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, paddingVertical: 8 },
  swapLoadingText: { color: "#22D3EE", fontSize: 13 },
  mealTitle: { fontSize: 15, fontWeight: "700" },
  foodRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  summary: { borderWidth: 1, padding: 14, marginTop: 4, marginBottom: 12 },
  summaryTitle: { fontWeight: "800", letterSpacing: 0.5 },
  suggestionCard: {
    backgroundColor: "#0F1A2A",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.2)",
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  suggestionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  suggestionTitle: { color: "#F87171", fontSize: 14, fontWeight: "700" },
  proteinGapBadge: {
    backgroundColor: "rgba(248, 113, 113, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  proteinGapBadgeText: { color: "#F87171", fontSize: 11, fontWeight: "600" },
  suggestionSubtitle: { color: "#94A3B8", fontSize: 12, marginBottom: 12 },
  suggestionLoading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  suggestionLoadingText: { color: "#94A3B8", fontSize: 12 },
  suggestionItem: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  suggestionItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(248, 113, 113, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionItemContent: { flex: 1 },
  suggestionItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  suggestionItemTitle: { color: "#E2E8F0", fontSize: 13, fontWeight: "600", flex: 1, marginRight: 8 },
  suggestionItemProtein: { color: "#4ADE80", fontSize: 13, fontWeight: "700" },
  suggestionItemDesc: { color: "#94A3B8", fontSize: 12, marginBottom: 4, lineHeight: 17 },
  suggestionItemMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  suggestionItemTime: { color: "#64748B", fontSize: 11, flex: 1 },
  suggestionItemCost: { color: "#64748B", fontSize: 11 },
  supplementCard: {
    backgroundColor: "#0F1A2A",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(167, 139, 250, 0.2)",
  },
  supplementHeaderPressable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    marginHorizontal: -4,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  supplementHeaderPressableExpanded: {
    marginBottom: 14,
  },
  supplementHeaderPressablePressed: {
    backgroundColor: "rgba(167, 139, 250, 0.08)",
  },
  supplementHeaderText: { flex: 1, minWidth: 0 },
  supplementTitle: { color: "#E2E8F0", fontSize: 15, fontWeight: "700" },
  supplementSubtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  supplementItem: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
  },
  supplementItemExpanded: {
    backgroundColor: "rgba(167, 139, 250, 0.06)",
    borderColor: "rgba(167, 139, 250, 0.15)",
  },
  supplementItemPressed: {
    backgroundColor: "rgba(167, 139, 250, 0.1)",
  },
  supplementItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(167, 139, 250, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  supplementItemBody: { flex: 1, minWidth: 0 },
  supplementItemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  supplementItemName: { color: "#E2E8F0", fontSize: 13, fontWeight: "600", flex: 1 },
  supplementMeta: { color: "#64748B", fontSize: 11, marginTop: 2, marginBottom: 4 },
  benefitTagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  benefitTag: {
    backgroundColor: "rgba(167, 139, 250, 0.1)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  benefitTagText: { color: "#A78BFA", fontSize: 10, fontWeight: "500" },
  supplementBenefit: {
    color: "#94A3B8",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  regen: { borderWidth: 1, padding: 14, marginBottom: 24, alignItems: "center" },
  regenBtn: { marginTop: 10 },
  regeneratingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  regeneratingText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600", marginTop: 16 },
  regeneratingSubtext: { color: "#94A3B8", fontSize: 13, marginTop: 6 },
  regenSheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  regenSheetBackdropTap: { ...StyleSheet.absoluteFillObject },
  regenSheet: { borderWidth: 1, padding: 20, paddingBottom: 32, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  regenSheetTitle: { fontSize: 18, fontWeight: "800" },
  regenSheetActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  regenSheetCancel: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  regenSheetConfirm: { flex: 1, backgroundColor: "#22d3ee", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  weekTabsScroll: { marginBottom: 12, maxHeight: 56 },
  weekTab: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    minWidth: 72,
    alignItems: "center",
  },
});
