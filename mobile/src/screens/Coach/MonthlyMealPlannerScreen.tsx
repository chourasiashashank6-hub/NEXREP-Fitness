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
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
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
  regenerateWeek,
  swapMealPlanMeal,
} from "../../api/mealPlanner";
import {
  deleteCalorieMeal,
  getDailyCalorieLog,
  postCalorieMeal,
  type CalorieDayPayload,
  type MealType,
} from "../../api/caloriesLog";
import { fetchOnboardingMe } from "../../api/onboarding";
import { getFastingPreferences, type FastingPreference } from "../../api/fasting";
import { PlannerMonthCalendar } from "../../components/Coach/PlannerMonthCalendar";
import { PlannerLockedUpsell } from "../../components/PlannerLockedUpsell";
import { StalePlanBanner } from "../../components/StalePlanBanner";
import { MEAL_SWAP_REASONS, SwapBottomSheet } from "../../components/SwapBottomSheet";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import { getFirebaseAuth } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";
import { notifyUser } from "../../utils/notify";
import {
  getNotificationPermissionState,
  requestNotificationPermissions,
  rescheduleMealNotifications,
} from "../../services/notificationService";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import type {
  BudgetLevel,
  MealDayPlan,
  MealPlanCurrent,
  ProteinSuggestion,
  ProteinSuggestionIcon,
  MealPlanMeal,
  SupplementIcon,
  SupplementRecommendation,
  WeekTab,
} from "../../types/planner";
import { isWeeklyPlannerCurrent } from "../../types/planner";
import { fullDayLabel, monthYearLabel } from "../../utils/localDate";

const GREEN = '#0F6E56';
const GREEN_LIGHT = '#E8F5EE';
const BLUE = '#4A90D9';
const BLUE_LIGHT = '#EEF4FB';
const ORANGE = '#D85A30';
const ORANGE_LIGHT = '#FFF1EE';
const AMBER = '#FFB800';
const AMBER_LIGHT = '#FFF8E8';
const AMBER_TEXT = '#C08000';
const PURPLE = '#7B68CC';
const PURPLE_LIGHT = '#F0EEF9';
const BG = '#F7F6F3';
const WHITE = '#FFFFFF';
const TEXT = '#1A1A18';
const MUTED = '#BBBBBB';
const TRACK = '#E5E4E0';
const BORDER = '#ECEAE5';
const SCREEN_BG = '#FFFFFF';

const MEAL_ACCENT: Record<string, { bg: string; text: string; btn: string; strip: string }> = {
  Breakfast:     { bg: AMBER_LIGHT,  text: AMBER_TEXT, btn: AMBER,   strip: AMBER_LIGHT },
  Lunch:         { bg: GREEN_LIGHT,  text: GREEN,      btn: GREEN,   strip: GREEN_LIGHT },
  Dinner:        { bg: BLUE_LIGHT,   text: BLUE,       btn: BLUE,    strip: BLUE_LIGHT  },
  Snack:         { bg: PURPLE_LIGHT, text: PURPLE,     btn: PURPLE,  strip: PURPLE_LIGHT},
  "Mid-Morning Snack": { bg: PURPLE_LIGHT, text: PURPLE, btn: PURPLE, strip: PURPLE_LIGHT },
  "Afternoon Snack":   { bg: PURPLE_LIGHT, text: PURPLE, btn: PURPLE, strip: PURPLE_LIGHT },
  "Evening Snack":     { bg: ORANGE_LIGHT, text: ORANGE, btn: ORANGE, strip: ORANGE_LIGHT },
  Pre_Workout:   { bg: ORANGE_LIGHT, text: ORANGE,     btn: ORANGE,  strip: ORANGE_LIGHT},
  Post_Workout:  { bg: GREEN_LIGHT,  text: GREEN,      btn: GREEN,   strip: GREEN_LIGHT },
};
const defaultAccent = { bg: BG, text: MUTED, btn: MUTED, strip: BG };

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
  { id: "budget", label: i18n.t("coach.mealPlannerScreen.budgets.budget"), emoji: "🪙" },
  { id: "moderate", label: i18n.t("coach.mealPlannerScreen.budgets.moderate"), emoji: "💰" },
  { id: "flexible", label: i18n.t("coach.mealPlannerScreen.budgets.flexible"), emoji: "💎" },
];

const LOADING_MSGS = [
  i18n.t("coach.mealPlannerScreen.loadingMessages.localFoods"),
  i18n.t("coach.mealPlannerScreen.loadingMessages.macros"),
  i18n.t("coach.mealPlannerScreen.loadingMessages.cheatDays"),
  i18n.t("coach.mealPlannerScreen.loadingMessages.finalizing"),
];

const MEAL_EMOJI: Record<string, string> = {
  Breakfast: "🌅",
  Lunch: "🍛",
  Snack: "🥜",
  "Mid-Morning Snack": "🍎",
  "Afternoon Snack": "🍌",
  "Evening Snack": "🥛",
  Dinner: "🌙",
  Pre_Workout: "⚡",
  Post_Workout: "💪",
};

function toCalorieMealType(mealType: string): MealType {
  const key = mealType.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
  if (key.includes("breakfast")) return "Breakfast";
  if (key.includes("lunch")) return "Lunch";
  if (key.includes("dinner")) return "Dinner";
  if (key.includes("pre_workout") || key.includes("preworkout")) return "Pre_Workout";
  if (key.includes("post_workout") || key.includes("postworkout")) return "Post_Workout";
  return "Snack";
}

function mealLogKey(meal: MealPlanMeal): string {
  if (meal.recipe_id != null) return `r:${meal.recipe_id}`;
  const name = meal.recipe_name || meal.items[0]?.food || meal.meal_type;
  return `n:${meal.slot_order ?? 0}:${name}`;
}

function mealServingGrams(meal: MealPlanMeal): number {
  if (meal.serving_grams != null && meal.serving_grams > 0) return meal.serving_grams;
  const fromItems = meal.items.reduce((sum, item) => sum + (Number(item.quantity_g) || 0), 0);
  return Math.max(1, fromItems || 100);
}

function per100FromTotal(total: number, grams: number): number {
  return grams > 0 ? (total / grams) * 100 : 0;
}

function findPlannerLogEntry(dayMeals: CalorieDayPayload["meals"], meal: MealPlanMeal) {
  const dishName = meal.recipe_name || meal.items[0]?.food || meal.meal_type;
  return dayMeals.find((entry) => {
    if (entry.source_type !== "meal_planner") return false;
    if (meal.recipe_id != null && entry.food_id === meal.recipe_id) return true;
    if (meal.recipe_id == null && entry.food_name === dishName) return true;
    return false;
  });
}

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
  return <Ionicons name={map[icon] ?? "nutrition-outline"} size={17} color={BLUE} />;
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
  return <Ionicons name={map[icon] ?? "medical-outline"} size={16} color={PURPLE} />;
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
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={MUTED} />
        </View>
        <Text style={styles.supplementMeta}>
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

type Props = {
  /** When true, hide back button and nest safely inside Log tab. */
  embedded?: boolean;
};

export default function MonthlyMealPlannerScreen({ embedded = false }: Props) {
  const { t } = useTranslation();
  const { hasFeatureAccess } = useFeatureAccess();
  const hasMealPlannerAccess = hasFeatureAccess("meal_plan_generation");
  const canUseFastingMeals = hasFeatureAccess("fasting_aware_meals");
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
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
  const [showRegenerateDaySheet, setShowRegenerateDaySheet] = useState(false);
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
  const [supplementGoalLabel, setSupplementGoalLabel] = useState(t("coach.mealPlannerScreen.generalHealth"));
  const [loadingSupplements, setLoadingSupplements] = useState(false);
  const [supplementsLoaded, setSupplementsLoaded] = useState(false);
  const [supplementsCardExpanded, setSupplementsCardExpanded] = useState(false);
  const [recipeSheetMeal, setRecipeSheetMeal] = useState<MealPlanMeal | null>(null);
  const [loggedMealIds, setLoggedMealIds] = useState<Record<string, number>>({});
  const [loggingMealKey, setLoggingMealKey] = useState<string | null>(null);
  const [staleFields, setStaleFields] = useState<string[]>([]);
  const [isRegeneratingStale, setIsRegeneratingStale] = useState(false);
  const [activeFasting, setActiveFasting] = useState<FastingPreference | null>(null);
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const signedInEmail = String(getFirebaseAuth().currentUser?.email || "")
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
        const weekStart =
          current.current_week?.week_start_day ??
          (currentWeek?.is_generated ? currentWeek.start_day : null);
        if (weekStart != null) {
          try {
            const refreshedWeek = await generateWeekPlan(budget, weekStart);
            if (seq !== loadSeqRef.current) return;
            syncRegenStats(refreshedWeek, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
            setPlan(refreshedWeek);
            setSelectedDay((prev) => {
              if (refreshedWeek.month_overview.some((d) => d.day === prev)) return prev;
              return refreshedWeek.today?.day ?? refreshedWeek.month_overview.find((d) => d.is_today)?.day ?? prev;
            });
            lastDayFetchRef.current = null;
          } catch {
            // Keep an already-generated week visible if refresh/migration fails.
            if (seq !== loadSeqRef.current) return;
            if (current.current_week) {
              setPlan(current.current_week);
              lastDayFetchRef.current = null;
            } else if (currentWeek?.is_generated) {
              await loadWeekPlan(currentWeek.start_day, currentWeek);
            } else {
              setPlan(null);
              setDayDetail(null);
            }
          }
        } else {
          setPlan(null);
          setDayDetail(null);
        }
      } else if (current) {
        const refreshed = await generateMealPlan(budget);
        if (seq !== loadSeqRef.current) return;
        setPlannerMode("monthly");
        syncRegenStats(refreshed, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        setPlan(refreshed);
        setSelectedDay((prev) => refreshed.today?.day ?? prev);
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
  }, [budget, loadWeekPlan]);

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
      if (!canUseFastingMeals) return;
      try {
        const fasting = await getFastingPreferences();
        setActiveFasting(fasting.active ?? null);
      } catch {
        setActiveFasting(null);
      }
    })();
  }, [canUseFastingMeals]);

  // Derive stale fields from the plan response (server computes this).
  useEffect(() => {
    setStaleFields(plan?.stale_fields ?? []);
  }, [plan]);

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
        message: t("coach.mealPlannerScreen.unlocksOn", { date: fullDayLabel(month, year, selectedDay) }),
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
  }, [plan, selectedDay, month, year, canViewFutureDays, t]);

  const selectedLogDate = useMemo(() => {
    const y = plan?.year ?? year;
    const m = plan?.month ?? month;
    return `${y}-${String(m).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
  }, [plan?.year, plan?.month, year, month, selectedDay]);

  const syncLoggedMeals = useCallback((dayPayload: CalorieDayPayload, meals: MealPlanMeal[]) => {
    const next: Record<string, number> = {};
    for (const meal of meals) {
      const entry = findPlannerLogEntry(dayPayload.meals, meal);
      if (entry) next[mealLogKey(meal)] = entry.meal_id;
    }
    setLoggedMealIds(next);
  }, []);

  useEffect(() => {
    if (!dayDetail?.meals?.length) {
      setLoggedMealIds({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const dayPayload = await getDailyCalorieLog(selectedLogDate);
        if (cancelled) return;
        syncLoggedMeals(dayPayload, dayDetail.meals);
      } catch {
        if (!cancelled) setLoggedMealIds({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayDetail, selectedLogDate, syncLoggedMeals]);

  useFocusEffect(
    useCallback(() => {
      if (!dayDetail?.meals?.length) return;
      let cancelled = false;
      void (async () => {
        try {
          const dayPayload = await getDailyCalorieLog(selectedLogDate);
          if (cancelled) return;
          syncLoggedMeals(dayPayload, dayDetail.meals);
        } catch {
          /* keep previous logged state */
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [dayDetail, selectedLogDate, syncLoggedMeals]),
  );

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

      if (gap > 5) {
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

  useEffect(() => {
    if (!plan) return;
    void (async () => {
      const permission = await getNotificationPermissionState().catch(() => null);
      if (permission?.granted) {
        await rescheduleMealNotifications(plan).catch(() => undefined);
      }
    })();
  }, [plan]);

  const startGenerateWeek = async () => {
    if (selectedWeekStart == null) return;
    setGenerating(true);
    try {
      await requestNotificationPermissions("meal_planner").catch(() => undefined);
      const created = await generateWeekPlan(budget, selectedWeekStart);
      lastDayFetchRef.current = null;
      setPlan(created);
      await rescheduleMealNotifications(created).catch(() => undefined);
      if (created.today?.day) setSelectedDay(created.today.day);
      const overview = await fetchWeeksOverview();
      setWeeks(overview.weeks);
      syncRegenStats(created, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      notifyUser(t("coach.mealPlannerScreen.alerts.done"), t("coach.mealPlannerScreen.alerts.weekGenerated"));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("coach.mealPlannerScreen.alerts.couldNotGenerateWeek");
      Alert.alert(t("coach.mealPlannerScreen.alerts.generationFailed"), msg);
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
      await requestNotificationPermissions("meal_planner").catch(() => undefined);
      const created = await generateMealPlan(budget);
      lastDayFetchRef.current = null;
      setPlan(created);
      await rescheduleMealNotifications(created).catch(() => undefined);
      if (created.today?.day) setSelectedDay(created.today.day);
      syncRegenStats(created, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("coach.mealPlannerScreen.alerts.couldNotGenerateMonth");
      Alert.alert(t("coach.mealPlannerScreen.alerts.generationFailed"), msg);
    } finally {
      if (progressTimer.current) clearInterval(progressTimer.current);
      setGenerating(false);
    }
  };

  const handleSelectWeek = (week: WeekTab, day?: number) => {
    if (week.start_day === selectedWeekStart) return;

    setSelectedWeekStart(week.start_day);
    lastDayFetchRef.current = null;

    const pickDay = () => {
      if (day != null && day >= week.start_day && day <= week.end_day) return day;
      return week.is_current ? now.getDate() : week.start_day;
    };

    if (week.is_generated) {
      const sameWeekPlan = plan?.week_start_day === week.start_day;
      if (!sameWeekPlan) {
        void loadWeekPlan(week.start_day, week);
      }
      setSelectedDay(pickDay());
    } else {
      setPlan(null);
      setDayDetail(null);
      setSelectedDay(pickDay());
    }
  };

  const handleSelectDay = (day: number) => {
    setSelectedDay(day);
    if (plannerMode !== "weekly" || weeks.length === 0) return;
    const weekForDay = weeks.find((w) => day >= w.start_day && day <= w.end_day);
    if (!weekForDay || weekForDay.start_day === selectedWeekStart) return;
    handleSelectWeek(weekForDay, day);
  };

  const handleSwapPress = (day: number, mealType: string) => {
    if (!canSwapMeals || swapsRemaining <= 0) {
      notifyUser(
        t("coach.mealPlannerScreen.alerts.swapLimit"),
        swapsRemaining <= 0 ? t("coach.mealPlannerScreen.swapLimitUsed") : t("coach.mealPlannerScreen.alerts.futureDaysLocked"),
      );
      return;
    }
    setSwapTarget({ day, mealType });
    setShowSwapSheet(true);
  };

  const handleToggleLogMeal = async (meal: MealPlanMeal) => {
    const key = mealLogKey(meal);
    const existingId = loggedMealIds[key];
    setLoggingMealKey(key);
    try {
      if (existingId) {
        const dayPayload = await deleteCalorieMeal(existingId);
        syncLoggedMeals(dayPayload, dayDetail?.meals ?? [meal]);
        return;
      }
      const grams = mealServingGrams(meal);
      const dishName = meal.recipe_name || meal.items[0]?.food || meal.meal_type;
      const dayPayload = await postCalorieMeal({
        log_date: selectedLogDate,
        meal_type: toCalorieMealType(meal.meal_type),
        source_type: "meal_planner",
        food_id: meal.recipe_id ?? meal.items[0]?.food_id ?? null,
        food_name: dishName,
        quantity_g: grams,
        calories_per_100g: per100FromTotal(meal.total_calories, grams),
        protein_per_100g: per100FromTotal(meal.total_protein, grams),
        carbs_per_100g: per100FromTotal(meal.total_carbs, grams),
        fat_per_100g: per100FromTotal(meal.total_fat, grams),
        fiber_per_100g: per100FromTotal(meal.total_fiber ?? meal.items.reduce((s, i) => s + (i.fiber || 0), 0), grams),
      });
      syncLoggedMeals(dayPayload, dayDetail?.meals ?? [meal]);
    } catch {
      notifyUser(t("coach.mealPlannerScreen.alerts.error"), t("coach.mealPlannerScreen.alerts.logMealFailed"));
    } finally {
      setLoggingMealKey(null);
    }
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
      notifyUser(t("coach.mealPlannerScreen.alerts.done"), t("coach.mealPlannerScreen.alerts.mealReplaced"));
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number; data?: { detail?: string } } })?.response?.status;
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 429) {
        setMealSwapsUsed(mealSwapsLimit);
        notifyUser(t("coach.mealPlannerScreen.alerts.swapLimit"), detail || t("coach.mealPlannerScreen.alerts.swapsUsed"));
      } else {
        Alert.alert(t("coach.mealPlannerScreen.alerts.error"), t("coach.mealPlannerScreen.alerts.replaceFailed"));
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
      return t("coach.mealPlannerScreen.alerts.timeout");
    }
    return fallback;
  };

  const handleRegenerateStale = async () => {
    if (!plan || selectedWeekStart == null) return;
    setIsRegeneratingStale(true);
    try {
      // Soft generate-week skips rebuild when the week already exists; use force regen
      // so meals refresh AND onboarding_snapshot_json is rewritten (clears banner).
      const fromDay = Math.max(selectedWeekStart, now.getDate());
      const created = await regenerateWeek(selectedWeekStart, fromDay);
      lastDayFetchRef.current = null;
      setPlan(created);
      setStaleFields(created.stale_fields ?? []);
      syncRegenStats(created, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      notifyUser(t("stalePlan.regenerated"), t("stalePlan.regenerated"));
    } catch {
      Alert.alert(t("common.error"), t("stalePlan.regenerateFailed"));
    } finally {
      setIsRegeneratingStale(false);
    }
  };

  const handleRegenerateDay = (day: number) => {
    if (!plan) return;
    if (!effectiveLimitsExempt && dayRegensRemaining <= 0) {
      Alert.alert(
        t("coach.mealPlannerScreen.alerts.noRefreshesTitle"),
        t("coach.mealPlannerScreen.alerts.noRefreshesBody"),
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
      const updated = await regenerateMealPlanDay({
        plan_id: plan.plan_id,
        day,
      });
      setDayDetail(updated);
      syncRegenStats(updated, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
      if (selectedWeekStart != null) {
        const refreshedWeek = await fetchWeekPlan(selectedWeekStart);
        lastDayFetchRef.current = null;
        syncRegenStats(refreshedWeek, setDayRegensUsed, setDayRegensLimit, setPlannerLimitsExempt, setPlannerDaysUnlocked);
        setPlan(refreshedWeek);
      }
      notifyUser(t("coach.mealPlannerScreen.alerts.done"), t("coach.mealPlannerScreen.alerts.dayRegenerated"));
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        setDayRegensUsed(dayRegensLimit);
        notifyUser(t("coach.mealPlannerScreen.alerts.limitReached"), apiErrorMessage(e, t("coach.mealPlannerScreen.alerts.dayRefreshesUsed")));
      } else {
        notifyUser(t("coach.mealPlannerScreen.alerts.error"), apiErrorMessage(e, t("coach.mealPlannerScreen.alerts.regenerateFailed")));
      }
    } finally {
      setIsRegeneratingDay(false);
    }
  };

  const selectedWeekMeta = useMemo(
    () => weeks.find((w) => w.start_day === selectedWeekStart) ?? null,
    [weeks, selectedWeekStart],
  );

  const calendarDays = useMemo(() => {
    const source = plan?.month_overview ?? [];
    // Full-month strip (week tabs removed) — fill gaps for days outside the loaded week.
    const byDay = new Map(source.map((d) => [d.day, d]));
    const last = new Date(year, month, 0).getDate();
    const out = [];
    for (let day = 1; day <= last; day++) {
      const existing = byDay.get(day);
      if (existing) {
        out.push({
          day: existing.day,
          is_past: existing.is_past,
          is_today: existing.is_today,
          is_future: existing.is_future,
          is_cheat_day: existing.is_cheat_day,
        });
        continue;
      }
      const isToday = day === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
      const isPast = year < now.getFullYear() || (year === now.getFullYear() && (month < now.getMonth() + 1 || (month === now.getMonth() + 1 && day < now.getDate())));
      out.push({
        day,
        is_past: isPast && !isToday,
        is_today: isToday,
        is_future: !isPast && !isToday,
        is_cheat_day: false,
      });
    }
    return out;
  }, [plan, month, year, now]);

  const totalCost = useMemo(() => {
    if (!dayDetail?.meals) return 0;
    return dayDetail.meals.reduce((s, m) => s + (m.estimated_cost_inr || 0), 0);
  }, [dayDetail]);

  const totalPrep = useMemo(() => {
    if (!dayDetail?.meals) return 0;
    return dayDetail.meals.reduce((s, m) => s + (m.prep_time_min || 0), 0);
  }, [dayDetail]);

  const isV3Day = Boolean(dayDetail?.meals?.some((m) => m.engine === "v3"));
  const showCost = !isV3Day && totalCost > 0;

  const headerTitle = monthYearLabel(month, year);
  const shouldShowWeekGenerate =
    plannerMode === "weekly" &&
    Boolean(selectedWeekMeta) &&
    !selectedWeekMeta?.is_generated &&
    !generating;
  const showWeekGeneratePanel =
    plannerMode === "weekly" && !plan && !generating && Boolean(selectedWeekMeta) &&
    (selectedWeekMeta?.can_generate || !selectedWeekMeta?.is_generated || selectedWeekMeta?.is_current);
  const showMonthlyGeneratePanel = plannerMode === "monthly" && !plan && !generating;
  const showWeekEmptyFallback =
    plannerMode === "weekly" && !plan && !generating && !showWeekGeneratePanel && Boolean(selectedWeekMeta);

  if (!hasMealPlannerAccess) {
    return (
      <ScreenContainer bg={SCREEN_BG} embedded={embedded}>
        <PlannerLockedUpsell
          feature="meal_plan_generation"
          featureName={t("coach.home.mealPlanner.name")}
          featureDescription={t("coach.home.mealPlanner.gateDescription")}
          featureEmoji="🍽️"
          accentColor={BLUE}
        />
      </ScreenContainer>
    );
  }

  if (loading) {
    return (
      <ScreenContainer bg={SCREEN_BG} embedded={embedded}>
        <ActivityIndicator color={BLUE} style={styles.loadingSpinner} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer bg={SCREEN_BG} embedded={embedded}>
      <View style={styles.header}>
        {!embedded ? (
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
        ) : null}
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title}>{t("coach.mealPlannerScreen.title")}</Text>
          <Text style={styles.sub}>{headerTitle}</Text>
        </View>
        <View style={styles.headerActions}>
          {dayDetail && !dayDetail.locked && isCurrentOrFuture ? (
            <Pressable
              onPress={() => handleRegenerateDay(dayDetail.day)}
              style={[
                styles.regenerateDayButton,
                (isRegeneratingDay || (!effectiveLimitsExempt && dayRegensRemaining <= 0)) && styles.regenerateDayButtonDisabled,
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={isRegeneratingDay || (!effectiveLimitsExempt && dayRegensRemaining <= 0)}
            >
              {isRegeneratingDay ? (
                <ActivityIndicator size="small" color={BLUE} />
              ) : (
                <>
                  <Ionicons name="refresh" size={14} color={effectiveLimitsExempt || dayRegensRemaining > 0 ? BLUE : MUTED} />
                  <Text style={[styles.regenerateDayButtonText, !effectiveLimitsExempt && dayRegensRemaining <= 0 && styles.regenerateDayButtonTextDisabled]}>
                    {t("coach.mealPlannerScreen.day")}
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
          {shouldShowWeekGenerate ? (
            <Pressable disabled={generating} onPress={() => void startGenerateWeek()} style={[styles.regenerateWeekButton, generating && styles.regenBtnDisabled]}>
              <Ionicons name="refresh-circle-outline" size={14} color={WHITE} />
              <Text style={styles.regenerateWeekButtonText}>{t("coach.mealPlannerScreen.week")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.screenBody}>
        {staleFields.length > 0 && plan ? (
          <StalePlanBanner
            staleFields={staleFields}
            onRegenerate={() => void handleRegenerateStale()}
            regenerating={isRegeneratingStale}
          />
        ) : null}
        {activeFasting ? (
          <View style={styles.fastingBanner}>
            <Text style={styles.fastingBannerTitle}>{t("fasting.plannerBannerTitle")}</Text>
            <Text style={styles.fastingBannerBody}>
              {t("fasting.plannerBannerBody", {
                period: t(`fasting.periods.${activeFasting.period_type}`),
                start: activeFasting.start_date,
                end: activeFasting.end_date,
              })}
            </Text>
          </View>
        ) : null}
        <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {showWeekGeneratePanel || showMonthlyGeneratePanel ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>
                {plannerMode === "weekly" && selectedWeekMeta
                  ? t("coach.mealPlannerScreen.generateWeekTitle", { week: selectedWeekMeta.label })
                  : t("coach.mealPlannerScreen.generateMonthTitle", { month: headerTitle })}
              </Text>
              <Text style={styles.label}>{t("coach.mealPlannerScreen.budgetPreference")}</Text>
              <View style={styles.pills}>
                {BUDGETS.map((b) => (
                  <Pressable key={b.id} style={[styles.pill, budget === b.id && styles.pillOn]} onPress={() => setBudget(b.id)}>
                    <Text style={[styles.pillText, budget === b.id && styles.pillTextOn]}>{b.emoji} {b.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.bullet}>{t("coach.mealPlannerScreen.mealsPerDay", { count: onboardingPreview.meals })}</Text>
              <Text style={styles.bullet}>{t("coach.mealPlannerScreen.kcalTarget", { kcal: onboardingPreview.kcal })}</Text>
              <Text style={styles.bullet}>{t("coach.mealPlannerScreen.localFoods")}</Text>
              <Text style={styles.bullet}>{t("coach.mealPlannerScreen.dietaryPreferences")}</Text>
              {plannerMode === "monthly" ? (
                <Text style={styles.bullet}>{t("coach.mealPlannerScreen.cheatDays")}</Text>
              ) : (
                <Text style={styles.bullet}>{t("coach.mealPlannerScreen.oneWeek")}</Text>
              )}
              <Pressable style={styles.genBtn} onPress={() => void startGenerate()}>
                <Text style={styles.genBtnText}>
                  {plannerMode === "weekly" ? t("coach.mealPlannerScreen.generateWeek") : t("coach.mealPlannerScreen.generateMonth")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {showWeekEmptyFallback ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{t("coach.mealPlannerScreen.generateWeekTitle", { week: selectedWeekMeta?.label ?? "" })}</Text>
              <Text style={styles.bullet}>{t("coach.mealPlannerScreen.alerts.couldNotGenerateMonth")}</Text>
              <Pressable style={styles.genBtn} onPress={() => void startGenerate()}>
                <Text style={styles.genBtnText}>{t("coach.mealPlannerScreen.generateWeek")}</Text>
              </Pressable>
            </View>
          ) : null}

          {generating ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>
                {plannerMode === "weekly" ? t("coach.mealPlannerScreen.planningWeek") : t("coach.mealPlannerScreen.planningMonth")}
              </Text>
              {plannerMode === "monthly" ? (
                <>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.min(100, (genStep / 4) * 100)}%` }]} />
                  </View>
                  <Text style={styles.progressMeta}>{t("coach.mealPlannerScreen.weekProgress", { week: Math.min(4, Math.max(1, genStep)) })}</Text>
                  <Text style={styles.progressStep}>{LOADING_MSGS[genStep % LOADING_MSGS.length]}</Text>
                </>
              ) : (
                <Text style={styles.progressStep}>{t("coach.mealPlannerScreen.tenSeconds")}</Text>
              )}
              <ActivityIndicator color={BLUE} style={styles.generatingSpinner} />
            </View>
          ) : null}

          {plan && !generating ? (
            <>
              <PlannerMonthCalendar
                month={plan.month}
                year={plan.year}
                days={calendarDays}
                selectedDay={selectedDay}
                onSelectDay={handleSelectDay}
                mode="meal"
                allowFutureSelection={canViewFutureDays}
              />

              {dayDetail?.locked ? (
                <View style={styles.locked}>
                  <Ionicons name="lock-closed-outline" size={24} color={MUTED} />
                  <Text style={styles.lockedText}>{t("coach.mealPlannerScreen.dayLocked")}</Text>
                  <Text style={styles.lockedMessage}>{dayDetail.message}</Text>
                </View>
              ) : dayDetail ? (
                <>
                  {dayDetail.is_cheat_day ? (
                    <View style={styles.cheatBanner}>
                      <View style={styles.cheatCircle} />
                      <Text style={styles.cheatTitle}>{t("coach.mealPlannerScreen.cheatTitle")}</Text>
                      <Text style={styles.cheatBody}>{t("coach.mealPlannerScreen.cheatBody")}</Text>
                    </View>
                  ) : null}

                  <View style={styles.dayHeader}>
                    <View style={styles.dayHeaderTopRow}>
                      <View style={styles.dayHeaderTitleWrap}>
                        <Text style={styles.dayTitle}>
                          {t("coach.mealPlannerScreen.dayTitle", {
                            day: dayDetail.day,
                            suffix: plan.month_overview.find((d) => d.day === dayDetail.day)?.is_past ? t("coach.mealPlannerScreen.completedSuffix") : "",
                          })}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.calorieSummaryRow}>
                      <View>
                        <Text style={styles.summaryTitle}>{t("coach.mealPlannerScreen.dailySummary")}</Text>
                        <Text style={styles.calorieValue}>{dayDetail.total_calories}</Text>
                        <Text style={styles.calorieTarget}>/ {dailyTargets.kcal} kcal</Text>
                      </View>
                      <View style={styles.remainingWrap}>
                        <Text style={styles.remainingLabel}>
                          {dayDetail.total_calories > dailyTargets.kcal
                            ? t("coach.mealPlannerScreen.exceeded")
                            : t("coach.mealPlannerScreen.remaining")}
                        </Text>
                        <Text style={[styles.remainingValue, dayDetail.total_calories > dailyTargets.kcal && styles.remainingValueOver]}>
                          {Math.abs(dailyTargets.kcal - dayDetail.total_calories)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.summaryProgressTrack}>
                      <View style={[styles.summaryProgressFill, { width: `${Math.min(dayDetail.total_calories / dailyTargets.kcal, 1) * 100}%` }]} />
                    </View>
                    {dailyTargets.protein != null && dailyTargets.carbs != null && dailyTargets.fat != null ? (
                      <View style={styles.summaryMacroTiles}>
                        <View style={styles.summaryMacroTile}>
                          <Text style={[styles.summaryMacroValue, styles.macroProtein]}>{dayDetail.total_protein_g}g</Text>
                          <Text style={styles.summaryMacroLabel}>/ {dailyTargets.protein} P</Text>
                        </View>
                        <View style={styles.summaryMacroTile}>
                          <Text style={[styles.summaryMacroValue, styles.macroCarbs]}>{dayDetail.total_carbs_g}g</Text>
                          <Text style={styles.summaryMacroLabel}>/ {dailyTargets.carbs} C</Text>
                        </View>
                        <View style={styles.summaryMacroTile}>
                          <Text style={[styles.summaryMacroValue, styles.macroFat]}>{dayDetail.total_fat_g}g</Text>
                          <Text style={styles.summaryMacroLabel}>/ {dailyTargets.fat} F</Text>
                        </View>
                      </View>
                    ) : null}
                    <View style={styles.summaryFooter}>
                      {showCost ? (
                        <View style={styles.summaryFooterItem}>
                          <Ionicons name="cash-outline" size={14} color={MUTED} />
                          <Text style={styles.summaryFooterText}>{t("coach.mealPlannerScreen.estimatedCost", { cost: totalCost })}</Text>
                        </View>
                      ) : null}
                      <View style={styles.summaryFooterItem}>
                        <Ionicons name="time-outline" size={14} color={MUTED} />
                        <Text style={styles.summaryFooterText}>{t("coach.mealPlannerScreen.prep", { minutes: totalPrep })}</Text>
                      </View>
                    </View>
                  </View>

                  {effectiveLimitsExempt ? (
                    <View style={styles.testNoticeBar}>
                      <Ionicons name="information-circle-outline" size={15} color={AMBER_TEXT} />
                      <Text style={styles.testNoticeText}>{t("coach.mealPlannerScreen.testNotice")}</Text>
                    </View>
                  ) : null}

                  {canSwapMeals && swapsRemaining <= 0 ? (
                    <View style={styles.swapLimitNotice}>
                      <Text style={styles.swapLimitNoticeText}>{t("coach.mealPlannerScreen.swapLimitUsed")}</Text>
                    </View>
                  ) : null}

                  {isRegeneratingDay ? (
                    <View style={styles.dayRegeneratingOverlay}>
                      <ActivityIndicator size="large" color={BLUE} />
                      <Text style={styles.dayRegeneratingText}>{t("coach.mealPlannerScreen.regenerating")}</Text>
                    </View>
                  ) : (
                    dayDetail.meals.map((meal) => {
                      const key = `${dayDetail.day}-${meal.slot_order ?? meal.slot ?? meal.meal_type}`;
                      const logKey = mealLogKey(meal);
                      const isLogged = loggedMealIds[logKey] != null;
                      const isLogging = loggingMealKey === logKey;
                      const isCollapsed = collapsed[key];
                      const isSwapping = swappingMeal === meal.meal_type;
                      const accent = MEAL_ACCENT[meal.meal_type] ?? defaultAccent;
                      const isV3Meal = meal.engine === "v3";
                      const dishName = meal.recipe_name || meal.items[0]?.food || meal.meal_type;
                      const mealLabel = meal.meal_type.replace(/_/g, " ");
                      const mult = meal.multiplier ?? meal.items[0]?.units ?? 1;
                      const grams = meal.serving_grams ?? meal.items[0]?.quantity_g ?? 0;
                      const p = meal.total_protein || 0;
                      const c = meal.total_carbs || 0;
                      const f = meal.total_fat || 0;
                      const macroSum = p + c + f;
                      return (
                        <View key={key} style={[styles.mealCard, isLogged && styles.mealCardLogged]}>
                          <View style={[styles.mealAccentStrip, { backgroundColor: accent.strip }]}>
                            <Pressable style={styles.mealHeaderPressable} onPress={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}>
                              <View style={styles.mealTitleRow}>
                                <Text style={[styles.mealTitle, { color: accent.text }]}>
                                  {MEAL_EMOJI[meal.meal_type] ?? "🍽"} {mealLabel}
                                </Text>
                                {isLogged ? (
                                  <View style={styles.loggedBadge}>
                                    <Ionicons name="checkmark" size={10} color={WHITE} />
                                    <Text style={styles.loggedBadgeText}>{t("coach.mealPlannerScreen.loggedBadge")}</Text>
                                  </View>
                                ) : null}
                              </View>
                              <View style={styles.mealMetaRow}>
                                <Ionicons name="time-outline" size={11} color={accent.text} />
                                <Text style={[styles.mealMetaText, { color: accent.text }]}>
                                  {isV3Meal || meal.estimated_cost_inr == null
                                    ? t("coach.mealPlannerScreen.prep", { minutes: meal.prep_time_min })
                                    : t("coach.mealPlannerScreen.mealPrepCost", { minutes: meal.prep_time_min, cost: meal.estimated_cost_inr })}
                                </Text>
                              </View>
                            </Pressable>
                            <View style={styles.mealHeaderActions}>
                              <Pressable
                                style={[styles.logButton, isLogged ? styles.logButtonLogged : styles.logButtonIdle]}
                                onPress={() => void handleToggleLogMeal(meal)}
                                disabled={isLogging}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                accessibilityLabel={
                                  isLogged
                                    ? t("coach.mealPlannerScreen.unlogMeal")
                                    : t("coach.mealPlannerScreen.logMeal")
                                }
                              >
                                {isLogging ? (
                                  <ActivityIndicator size="small" color={isLogged ? WHITE : GREEN} />
                                ) : (
                                  <Ionicons name="checkmark" size={16} color={isLogged ? WHITE : GREEN} />
                                )}
                              </Pressable>
                              {canSwapMeals && swapsRemaining > 0 ? (
                                <Pressable
                                  style={[styles.swapButton, { backgroundColor: isLogged ? MUTED : accent.btn }]}
                                  onPress={() => {
                                    if (isLogged) {
                                      notifyUser(
                                        t("coach.mealPlannerScreen.alerts.swapLockedTitle"),
                                        t("coach.mealPlannerScreen.alerts.swapLockedBody"),
                                      );
                                      return;
                                    }
                                    handleSwapPress(dayDetail.day, meal.meal_type);
                                  }}
                                  disabled={isLogged}
                                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                  <Ionicons name={isLogged ? "lock-closed" : "refresh"} size={16} color={WHITE} />
                                </Pressable>
                              ) : null}
                            </View>
                          </View>
                          {isSwapping ? (
                            <View style={styles.swapLoadingContainer}>
                              <ActivityIndicator color={accent.btn} size="small" />
                              <Text style={styles.swapLoadingText}>{t("coach.mealPlannerScreen.findingReplacement")}</Text>
                            </View>
                          ) : !isCollapsed ? (
                            <View style={styles.mealBody}>
                              {isV3Meal ? (
                                <>
                                  <Text style={styles.foodName}>{dishName}</Text>
                                  <Text style={styles.foodServing}>
                                    {`${Number(mult)}× serving · ${grams}g${meal.recipe_category ? ` · ${meal.recipe_category}` : ""}`}
                                  </Text>
                                  <Pressable onPress={() => setRecipeSheetMeal(meal)} hitSlop={6}>
                                    <Text style={styles.viewRecipeLink}>{t("coach.mealPlannerScreen.viewRecipe")}</Text>
                                  </Pressable>
                                  <View style={styles.mealTotalsBubble}>
                                    <Text style={styles.mealTotalsLine}>
                                      {t("coach.mealPlannerScreen.mealTotalsLine", {
                                        calories: meal.total_calories,
                                        protein: p,
                                        carbs: c,
                                        fat: f,
                                      })}
                                    </Text>
                                  </View>
                                  {macroSum > 0 ? (
                                    <View style={styles.macroBarTrack}>
                                      <View style={[styles.macroBarSeg, styles.macroBarProtein, { flex: Math.max(p, 0.01) }]} />
                                      <View style={[styles.macroBarSeg, styles.macroBarCarbs, { flex: Math.max(c, 0.01) }]} />
                                      <View style={[styles.macroBarSeg, styles.macroBarFat, { flex: Math.max(f, 0.01) }]} />
                                    </View>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  {meal.items.map((item, idx) => {
                                    const unitsRounded =
                                      item.units != null
                                        ? Number(Number(item.units).toFixed(1)).toString().replace(/\.0$/, "")
                                        : null;
                                    const servingLine =
                                      unitsRounded != null && item.unit_label
                                        ? `${unitsRounded} ${item.unit_label}${item.quantity_g ? ` (${item.quantity_g}g)` : ""}`
                                        : item.quantity_g
                                          ? `${item.quantity_g}g`
                                          : "";
                                    return (
                                    <View key={idx} style={styles.foodRow}>
                                      <View style={styles.foodTextWrap}>
                                        <Text style={styles.foodName}>{item.food}</Text>
                                        {servingLine ? <Text style={styles.foodServing}>{servingLine}</Text> : null}
                                      </View>
                                      <View style={styles.foodMeta}>
                                        <Text style={styles.foodKcal}>{item.calories} kcal</Text>
                                      </View>
                                    </View>
                                    );
                                  })}
                                  <View style={styles.mealTotalsBubble}>
                                    <Text style={styles.mealTotalsLine}>
                                      {t("coach.mealPlannerScreen.mealTotalsLine", {
                                        calories: meal.total_calories,
                                        protein: meal.total_protein,
                                        carbs: meal.total_carbs,
                                        fat: meal.total_fat,
                                      })}
                                    </Text>
                                  </View>
                                </>
                              )}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  )}

                  {proteinGap > 5 ? (
                    <View style={styles.suggestionCard}>
                      <View style={styles.suggestionHeader}>
                        <View style={styles.suggestionHeaderLeft}>
                          <Ionicons name="trending-up-outline" size={18} color={BLUE} />
                          <View>
                            <Text style={styles.suggestionTitle}>{t("coach.mealPlannerScreen.proteinGap", { grams: proteinGap })}</Text>
                            <Text style={styles.suggestionSubtitle}>{t("coach.mealPlannerScreen.proteinSubtitle")}</Text>
                          </View>
                        </View>
                        <View style={styles.proteinGapBadge}>
                          <Text style={styles.proteinGapBadgeText}>{dayDetail.total_protein_g}g / {dayDetail.target_protein_g ?? dailyTargets.protein ?? 0}g</Text>
                        </View>
                      </View>
                      {loadingProteinSuggestions ? (
                        <View style={styles.suggestionLoading}>
                          <ActivityIndicator size="small" color={BLUE} />
                          <Text style={styles.suggestionLoadingText}>{t("coach.mealPlannerScreen.findingProtein")}</Text>
                        </View>
                      ) : (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.suggestionScrollerContent}
                        >
                          {proteinSuggestions
                            ?.filter((_, i) => i % 2 === 0)
                            .map((_, columnIndex) => (
                              <View key={`protein-column-${columnIndex}`} style={styles.suggestionColumn}>
                                {proteinSuggestions.slice(columnIndex * 2, columnIndex * 2 + 2).map((s, i) => (
                                  <View key={`${s.title}-${columnIndex}-${i}`} style={styles.suggestionItem}>
                                    <View style={styles.suggestionItemIcon}>{renderProteinIcon(s.icon)}</View>
                                    <View style={styles.suggestionItemContent}>
                                      <Text style={styles.suggestionItemTitle} numberOfLines={2}>{s.title}</Text>
                                      {s.description ? (
                                        <Text style={styles.suggestionItemDesc} numberOfLines={1}>{s.description}</Text>
                                      ) : null}
                                    </View>
                                    <View style={styles.suggestionRight}>
                                      <Text style={styles.suggestionItemProtein}>+{s.protein_g}g</Text>
                                      {s.estimated_cost_inr != null && s.estimated_cost_inr > 0 ? (
                                        <Text style={styles.suggestionItemCost}>≈₹{s.estimated_cost_inr}</Text>
                                      ) : null}
                                    </View>
                                  </View>
                                ))}
                              </View>
                            ))}
                        </ScrollView>
                      )}
                    </View>
                  ) : null}

                  {loadingSupplements ? (
                    <View style={styles.supplementCard}>
                      <ActivityIndicator size="small" color={GREEN} />
                      <Text style={styles.supplementSubtitleLoading}>{t("coach.mealPlannerScreen.loadingSupplements")}</Text>
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
                        accessibilityLabel={t("coach.mealPlannerScreen.supplementAccessibility", { goal: supplementGoalLabel })}
                      >
                        <View style={styles.supplementHeaderLeft}>
                          <View style={styles.supplementHeaderIcon}>
                            <Ionicons name="fitness-outline" size={18} color={GREEN} />
                          </View>
                          <View style={styles.supplementHeaderText}>
                            <Text style={styles.supplementTitle}>{t("coach.mealPlannerScreen.supplementTitle", { goal: supplementGoalLabel })}</Text>
                            <Text style={styles.supplementSubtitle}>{t("coach.mealPlannerScreen.supplementSubtitle", { count: supplements.length })}</Text>
                          </View>
                        </View>
                        <Ionicons name={supplementsCardExpanded ? "chevron-up" : "chevron-down"} size={18} color={MUTED} />
                      </Pressable>
                      {supplementsCardExpanded ? (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.supplementItemsScrollerContent}
                        >
                          {supplements
                            .filter((_, i) => i % 2 === 0)
                            .map((_, columnIndex) => (
                              <View key={`supplement-column-${columnIndex}`} style={styles.supplementItemsColumn}>
                                {supplements.slice(columnIndex * 2, columnIndex * 2 + 2).map((s, i) => (
                                  <SupplementItem key={`${s.name}-${columnIndex}-${i}`} supplement={s} />
                                ))}
                              </View>
                            ))}
                        </ScrollView>
                      ) : null}
                    </View>
                  ) : null}

                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>

      </View>

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
          <View style={styles.regenSheet}>
            <Text style={styles.regenSheetTitle}>{t("coach.mealPlannerScreen.regenDayTitle")}</Text>
            {regenerateDayTarget != null ? (
              <Text style={styles.regenSheetSubtitle}>{fullDayLabel(plan?.month ?? month, plan?.year ?? year, regenerateDayTarget)}</Text>
            ) : null}
            <Text style={styles.regenSheetBody}>
              {t("coach.mealPlannerScreen.regenDayBody", { count: dayRegensRemaining, plural: dayRegensRemaining !== 1 ? "es" : "" })}
            </Text>
            <View style={styles.regenSheetActions}>
              <Pressable
                style={styles.regenSheetCancel}
                onPress={() => {
                  setShowRegenerateDaySheet(false);
                  setRegenerateDayTarget(null);
                }}
              >
                <Text style={styles.regenSheetCancelText}>{t("coach.mealPlannerScreen.cancel")}</Text>
              </Pressable>
              <Pressable style={styles.regenSheetConfirm} onPress={() => void handleRegenerateDayConfirm()}>
                <Text style={styles.regenSheetConfirmText}>{t("coach.mealPlannerScreen.regenerateLeft", { count: dayRegensRemaining })}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(recipeSheetMeal)}
        transparent
        animationType="slide"
        onRequestClose={() => setRecipeSheetMeal(null)}
      >
        <View style={styles.regenSheetBackdrop}>
          <Pressable style={styles.regenSheetBackdropTap} onPress={() => setRecipeSheetMeal(null)} />
          <View style={styles.recipeSheet}>
            <Text style={styles.recipeSheetTitle}>{recipeSheetMeal?.recipe_name || recipeSheetMeal?.items[0]?.food}</Text>
            {recipeSheetMeal?.recipe_category ? (
              <Text style={styles.recipeSheetMeta}>{recipeSheetMeal.recipe_category}</Text>
            ) : null}
            <ScrollView style={styles.recipeSheetScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.recipeSectionLabel}>Ingredients</Text>
              {(recipeSheetMeal?.recipe_items || []).map((ing, idx) => (
                <Text key={`${ing.key || ing.label}-${idx}`} style={styles.recipeIngredient}>
                  {ing.label} — {ing.grams}g
                </Text>
              ))}
              <Text style={[styles.recipeSectionLabel, { marginTop: 14 }]}>Method</Text>
              {(recipeSheetMeal?.recipe_steps || []).map((step, idx) => (
                <Text key={`step-${idx}`} style={styles.recipeStep}>
                  {idx + 1}. {step}
                </Text>
              ))}
            </ScrollView>
            <Pressable style={styles.recipeSheetClose} onPress={() => setRecipeSheetMeal(null)}>
              <Text style={styles.recipeSheetCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <SwapBottomSheet
        visible={showSwapSheet}
        title={swapTarget ? t("coach.mealPlannerScreen.replaceTitle", { meal: swapTarget.mealType.replace("_", " ") }) : t("coach.mealPlannerScreen.replaceMeal")}
        reasons={MEAL_SWAP_REASONS}
        confirmLabel={t("coach.mealPlannerScreen.replaceConfirm")}
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
  loadingSpinner: { marginTop: 40 },
  screenBody: { flex: 1 },
  fastingBanner: {
    backgroundColor: GREEN_LIGHT,
    borderWidth: 1,
    borderColor: "#CFE8DC",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  fastingBannerTitle: { color: GREEN, fontSize: 13, fontWeight: "800" },
  fastingBannerBody: { color: MUTED, fontSize: 12, marginTop: 4, lineHeight: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  headerActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: BG,
  },
  backBtnText: { color: TEXT, fontSize: 17, fontWeight: "700" },
  title: { color: TEXT, fontSize: 16, fontWeight: "800" },
  sub: { color: MUTED, fontSize: 11, marginTop: 2 },
  panel: { backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, marginBottom: 14 },
  panelTitle: { color: TEXT, fontSize: 15, fontWeight: "800", marginBottom: 12 },
  label: { color: TEXT, fontSize: 12, fontWeight: "700", marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { borderWidth: 1, borderColor: BORDER, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: WHITE },
  pillOn: { borderColor: BLUE, backgroundColor: BLUE_LIGHT },
  pillText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  pillTextOn: { color: BLUE },
  bullet: { color: TEXT, fontSize: 12, marginBottom: 5 },
  genBtn: { marginTop: 16, backgroundColor: BLUE, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  genBtnText: { color: WHITE, fontWeight: "800", fontSize: 14 },
  progressTrack: { height: 8, backgroundColor: TRACK, borderRadius: 99, overflow: "hidden", marginTop: 12 },
  progressFill: { height: 8, backgroundColor: BLUE },
  progressMeta: { color: MUTED, fontSize: 11, marginTop: 8 },
  progressStep: { color: MUTED, fontSize: 12, marginTop: 12 },
  generatingSpinner: { marginTop: 16 },
  locked: { backgroundColor: BG, borderRadius: 18, padding: 28, alignItems: "center", marginVertical: 16 },
  lockedText: { color: MUTED, fontSize: 13, fontWeight: "800", marginTop: 8 },
  lockedMessage: { color: MUTED, fontSize: 11, marginTop: 4, textAlign: "center" },
  cheatBanner: { backgroundColor: AMBER, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12, overflow: "hidden" },
  cheatCircle: { position: "absolute", right: -28, top: -32, width: 86, height: 86, borderRadius: 43, backgroundColor: "rgba(255,255,255,0.08)" },
  cheatTitle: { color: WHITE, fontWeight: "800", fontSize: 14 },
  cheatBody: { color: "rgba(255,255,255,0.85)", marginTop: 5, fontSize: 11, lineHeight: 16 },
  dayHeader: { backgroundColor: BG, borderRadius: 18, padding: 18, marginBottom: 10 },
  dayHeaderTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  dayHeaderTitleWrap: { flex: 1 },
  dayTitle: { color: TEXT, fontSize: 14, fontWeight: "800", lineHeight: 19 },
  regenerateDayButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: BLUE_LIGHT },
  regenerateDayButtonText: { color: BLUE, fontSize: 11, fontWeight: "800" },
  regenerateDayButtonDisabled: { backgroundColor: TRACK },
  regenerateDayButtonTextDisabled: { color: MUTED },
  regenerateWeekButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: BLUE },
  regenerateWeekButtonText: { color: WHITE, fontSize: 11, fontWeight: "800" },
  macroProtein: { color: BLUE },
  macroCarbs: { color: GREEN },
  macroFat: { color: AMBER_TEXT },
  testNoticeBar: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: AMBER_LIGHT, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8, marginBottom: 8 },
  testNoticeText: { color: AMBER_TEXT, fontSize: 11, fontWeight: "700", flex: 1 },
  swapLimitNotice: { backgroundColor: ORANGE_LIGHT, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8, marginBottom: 8 },
  swapLimitNoticeText: { color: ORANGE, fontSize: 11, fontWeight: "700" },
  dayRegeneratingOverlay: { backgroundColor: "rgba(255,255,255,0.82)", borderRadius: 18, padding: 40, alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 12 },
  dayRegeneratingText: { color: MUTED, fontSize: 13, fontWeight: "700", textAlign: "center" },
  mealCard: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 18, overflow: "hidden", marginBottom: 10 },
  mealCardLogged: { borderColor: GREEN, borderWidth: 1.5, shadowColor: GREEN, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
  mealAccentStrip: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mealHeaderPressable: { flex: 1, paddingRight: 8 },
  mealTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  mealTitle: { fontSize: 13, fontWeight: "800" },
  loggedBadge: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, flexDirection: "row", alignItems: "center", gap: 3 },
  loggedBadgeText: { color: WHITE, fontSize: 10, fontWeight: "700" },
  mealHeaderActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  logButton: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  logButtonIdle: { backgroundColor: WHITE, borderWidth: 1.5, borderColor: GREEN },
  logButtonLogged: { backgroundColor: GREEN, borderWidth: 0 },
  mealMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5, opacity: 0.72 },
  mealMetaText: { fontSize: 10, fontWeight: "700" },
  swapButton: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  swapLoadingContainer: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  swapLoadingText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  mealBody: { paddingHorizontal: 16, paddingVertical: 12 },
  foodRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  foodTextWrap: { flex: 1, gap: 2 },
  foodName: { color: TEXT, fontSize: 14, fontWeight: "500" },
  viewRecipeLink: { color: BLUE, fontSize: 12, fontWeight: "700", marginTop: 4, marginBottom: 2 },
  foodServing: { color: MUTED, fontSize: 12, fontWeight: "400" },
  foodMeta: { alignItems: "flex-end" },
  foodWeight: { color: MUTED, fontSize: 11 },
  foodKcal: { color: TEXT, fontSize: 11, fontWeight: "800", marginTop: 2 },
  mealTotalsBubble: { backgroundColor: BG, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 4 },
  mealTotalsLine: { color: TEXT, fontSize: 11, fontWeight: "600" },
  mealTotalsCalories: { color: TEXT, fontSize: 11, fontWeight: "800" },
  mealTotalsMacros: { color: MUTED, fontSize: 10, marginTop: 2 },
  macroBarTrack: { flexDirection: "row", height: 6, borderRadius: 99, overflow: "hidden", marginTop: 8, backgroundColor: TRACK },
  macroBarSeg: { height: 6 },
  macroBarProtein: { backgroundColor: BLUE },
  macroBarCarbs: { backgroundColor: GREEN },
  macroBarFat: { backgroundColor: AMBER_TEXT },
  recipeSheet: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: "78%",
  },
  recipeSheetTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  recipeSheetMeta: { color: MUTED, fontSize: 12, marginTop: 4, marginBottom: 10 },
  recipeSheetScroll: { maxHeight: 420 },
  recipeSectionLabel: { color: TEXT, fontSize: 13, fontWeight: "800", marginBottom: 6 },
  recipeIngredient: { color: TEXT, fontSize: 12, lineHeight: 18, marginBottom: 2 },
  recipeStep: { color: TEXT, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  recipeSheetClose: {
    marginTop: 12,
    backgroundColor: BLUE,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  recipeSheetCloseText: { color: WHITE, fontSize: 13, fontWeight: "800" },
  summaryTitle: { color: MUTED, fontWeight: "800", fontSize: 10, letterSpacing: 0.8 },
  calorieSummaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 },
  calorieValue: { color: TEXT, fontSize: 22, fontWeight: "900" },
  calorieTarget: { color: MUTED, fontSize: 11, marginTop: -2 },
  remainingWrap: { alignItems: "flex-end" },
  remainingLabel: { color: MUTED, fontSize: 11 },
  remainingValue: { color: BLUE, fontSize: 18, fontWeight: "900", marginTop: 2 },
  remainingValueOver: { color: ORANGE },
  summaryProgressTrack: { height: 7, backgroundColor: TRACK, borderRadius: 99, overflow: "hidden", marginTop: 12 },
  summaryProgressFill: { height: 7, backgroundColor: BLUE },
  summaryMacroTiles: { flexDirection: "row", gap: 8, marginTop: 12 },
  summaryMacroTile: { flex: 1, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 8 },
  summaryMacroValue: { fontSize: 13, fontWeight: "800" },
  summaryMacroLabel: { color: MUTED, fontSize: 9, marginTop: 2 },
  summaryFooter: { flexDirection: "row", gap: 16, marginTop: 12, flexWrap: "wrap" },
  summaryFooterItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  summaryFooterText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  suggestionCard: { backgroundColor: WHITE, borderRadius: 18, marginBottom: 12, borderWidth: 1, borderColor: BORDER, overflow: "hidden" },
  suggestionHeader: { backgroundColor: BLUE_LIGHT, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  suggestionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  suggestionTitle: { color: BLUE, fontSize: 13, fontWeight: "800" },
  suggestionSubtitle: { color: "#4070A0", fontSize: 10, marginTop: 2 },
  proteinGapBadge: { backgroundColor: BLUE, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  proteinGapBadgeText: { color: WHITE, fontSize: 11, fontWeight: "800" },
  suggestionLoading: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  suggestionLoadingText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  suggestionScrollerContent: { gap: 10, padding: 12 },
  suggestionColumn: { gap: 10 },
  suggestionItem: { width: 268, minHeight: 80, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderWidth: 1, borderColor: BG, borderRadius: 14, backgroundColor: WHITE },
  suggestionItemIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: BLUE_LIGHT, alignItems: "center", justifyContent: "center" },
  suggestionItemContent: { flex: 1, minWidth: 0 },
  suggestionItemTitle: { color: TEXT, fontSize: 12, fontWeight: "800" },
  suggestionItemDesc: { color: MUTED, fontSize: 10, marginTop: 2 },
  suggestionRight: { alignItems: "flex-end" },
  suggestionItemProtein: { color: BLUE, fontSize: 12, fontWeight: "800" },
  suggestionItemCost: { color: MUTED, fontSize: 10, marginTop: 2 },
  supplementCard: { backgroundColor: BG, borderRadius: 18, padding: 12, marginBottom: 12 },
  supplementSubtitleLoading: { color: MUTED, fontSize: 10, marginTop: 8, textAlign: "center" },
  supplementHeaderPressable: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderRadius: 12, padding: 2 },
  supplementHeaderPressableExpanded: { marginBottom: 4 },
  supplementHeaderPressablePressed: { backgroundColor: GREEN_LIGHT },
  supplementHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  supplementHeaderIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: GREEN_LIGHT, alignItems: "center", justifyContent: "center" },
  supplementHeaderText: { flex: 1, minWidth: 0 },
  supplementTitle: { color: TEXT, fontSize: 13, fontWeight: "800" },
  supplementSubtitle: { color: MUTED, fontSize: 10, marginTop: 2 },
  supplementItemsScrollerContent: { gap: 10, paddingTop: 8 },
  supplementItemsColumn: { gap: 10 },
  supplementItem: { width: 340, minHeight: 86, backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12, flexDirection: "row", gap: 10 },
  supplementItemExpanded: { borderColor: PURPLE_LIGHT },
  supplementItemPressed: { backgroundColor: BG },
  supplementItemIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: PURPLE_LIGHT, alignItems: "center", justifyContent: "center", marginTop: 1 },
  supplementItemBody: { flex: 1, minWidth: 0 },
  supplementItemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  supplementItemName: { color: TEXT, fontSize: 13, fontWeight: "800", flex: 1 },
  supplementMeta: { color: MUTED, fontSize: 11, marginTop: 4 },
  benefitTagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  benefitTag: { backgroundColor: PURPLE_LIGHT, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99 },
  benefitTagText: { color: PURPLE, fontSize: 10, fontWeight: "800" },
  supplementBenefit: { color: MUTED, fontSize: 11, lineHeight: 16, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: BORDER },
  regenBtnDisabled: { opacity: 0.5 },
  regenSheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  regenSheetBackdropTap: { ...StyleSheet.absoluteFillObject },
  regenSheet: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, padding: 20, paddingBottom: 32, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  regenSheetTitle: { color: TEXT, fontSize: 18, fontWeight: "800" },
  regenSheetSubtitle: { color: MUTED, marginTop: 4, fontSize: 12 },
  regenSheetBody: { color: MUTED, fontSize: 13, marginTop: 12, lineHeight: 20 },
  regenSheetActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  regenSheetCancel: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  regenSheetCancelText: { color: MUTED, fontWeight: "700" },
  regenSheetConfirm: { flex: 1, backgroundColor: BLUE, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  regenSheetConfirmText: { color: WHITE, fontWeight: "800" },
});
