import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { TextInputProps } from "react-native";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import axios from "axios";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  CalorieDayPayload,
  FoodSearchItem,
  MealType,
  deleteAIFoodMeal,
  deleteCalorieMeal,
  getDailyCalorieLog,
  invalidateCaloriesRoutePrefix,
  lookupFoodNutrition,
  patchCalorieMealQty,
  patchCalorieWater,
  postCalorieMeal,
  postAIFoodMeal,
  searchFoodCatalog,
  todayLocal,
} from "../api/caloriesLog";
import { loadOnboardingWithFallback } from "../api/onboarding";
import { resolveApiBaseUrl } from "../api/client";
import AllTimeMealHistoryModal from "../components/AllTimeMealHistoryModal";
import { FoodCameraButton } from "../components/FoodCameraButton";
import { LogPlannerSegment, type LogPlannerMode } from "../components/LogPlannerSegment";
import { PlannerLockedUpsell } from "../components/PlannerLockedUpsell";
import { useOnboardingContext } from "../hooks/OnboardingContext";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { useFoodRecognition } from "../hooks/useFoodRecognition";
import type { FoodAnalysisResult } from "../services/foodRecognitionService";
import { useAuthStore } from "../store/authStore";
import type { MainTabParamList } from "../navigation/types";
import MonthlyMealPlannerScreen from "./Coach/MonthlyMealPlannerScreen";

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

/** Same profile mapping Home uses so Calorie Log shares the live intake target. */
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

  const goalTypeMap: Record<string, BurnProfile["goal_tag"]> = {
    fat_loss: "Fat Loss",
    muscle_gain: "Muscle Gain",
    strength: "Strength",
  };
  const paceMap: Record<string, BurnProfile["goal_pace"]> = {
    slow: "slow",
    moderate: "moderate",
    aggressive: "fast",
    fast: "fast",
  };
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

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

const MEAL_ORDER: MealType[] = ["Breakfast", "Lunch", "Dinner", "Snack", "Pre_Workout", "Post_Workout"];

const mealHeading = (t: MealType) =>
  t === "Pre_Workout"
    ? i18n.t("calorieLog.mealLabels.preWorkout")
    : t === "Post_Workout"
      ? i18n.t("calorieLog.mealLabels.postWorkout")
      : t === "Breakfast"
        ? i18n.t("calorieLog.mealLabels.breakfast")
        : t === "Lunch"
          ? i18n.t("calorieLog.mealLabels.lunch")
          : t === "Dinner"
            ? i18n.t("calorieLog.mealLabels.dinner")
            : t;

const mealRowLabel = (t: MealType) => {
  if (t === "Snack") return i18n.t("calorieLog.mealLabels.snacks");
  return mealHeading(t);
};

const mealTypeFromLocalTime = (d: Date = new Date()): MealType => {
  const h = d.getHours();
  if (h >= 5 && h < 10) return "Breakfast";
  if (h >= 10 && h < 12) return "Snack";
  if (h >= 12 && h < 15) return "Lunch";
  if (h >= 15 && h < 18) return "Snack";
  if (h >= 18 && h < 22) return "Dinner";
  return "Snack";
};

const MEAL_TYPE_EMOJI: Record<MealType, string> = {
  Breakfast: "🌅",
  Lunch: "🥙",
  Dinner: "🍽️",
  Snack: "🍎",
  Pre_Workout: "⚡",
  Post_Workout: "🏁",
};

const QUICK_FOOD_EMOJI: Record<string, string> = {
  "Chicken breast": "🍗",
  "Brown rice": "🌾",
  "Whole egg": "🥚",
  Oats: "🥣",
  Banana: "🍌",
  "Greek yogurt": "🥛",
  Almonds: "🥜",
  Paneer: "🧀",
  "Dal cooked": "🫘",
  Chapati: "🫓",
  Salmon: "🐟",
  Broccoli: "🥦",
};

const parseMacroSplit = (label: string) => {
  const p = /Protein\s+(\d+)%/.exec(label)?.[1] ?? "—";
  const c = /Carbs\s+(\d+)%/.exec(label)?.[1] ?? "—";
  const f = /Fat\s+(\d+)%/.exec(label)?.[1] ?? "—";
  return { p, c, f };
};

type QuickFood = { label: string; cal: number; p: number; c: number; f: number; fi: number };
type CameraBaseNutrition = { qty: number; cal: number; p: number; c: number; f: number; fi: number };

const QUICK_FOODS: QuickFood[] = [
  { label: "Chicken breast", cal: 165, p: 31, c: 0, f: 3.6, fi: 0 },
  { label: "Brown rice", cal: 130, p: 3, c: 27, f: 1, fi: 1.8 },
  { label: "Whole egg", cal: 155, p: 13, c: 1, f: 11, fi: 0 },
  { label: "Oats", cal: 389, p: 17, c: 66, f: 7, fi: 10.6 },
  { label: "Banana", cal: 89, p: 1, c: 23, f: 0.3, fi: 2.6 },
  { label: "Greek yogurt", cal: 59, p: 10, c: 3.6, f: 0.4, fi: 0 },
  { label: "Almonds", cal: 579, p: 21, c: 22, f: 50, fi: 12.5 },
  { label: "Paneer", cal: 265, p: 18, c: 3, f: 20, fi: 0 },
  { label: "Dal cooked", cal: 116, p: 8, c: 20, f: 0.4, fi: 7.9 },
  { label: "Chapati", cal: 297, p: 9, c: 52, f: 4, fi: 7.5 },
  { label: "Salmon", cal: 208, p: 20, c: 0, f: 13, fi: 0 },
  { label: "Broccoli", cal: 34, p: 2.8, c: 7, f: 0.4, fi: 2.6 },
];

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const sanitizeFinite = (n: number) => (Number.isFinite(n) ? n : 0);

/** Allows only digits and one decimal point. */
const sanitizeNumericInput = (raw: string): string => {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const [whole = "", ...rest] = cleaned.split(".");
  const frac = rest.join("");
  return rest.length > 0 ? `${whole}.${frac}` : whole;
};

function MacroBar({
  emoji,
  label,
  consumed,
  target,
  barColor,
  valueColor,
  anim,
  unit = "g",
  isLast = false,
}: {
  emoji: string;
  label: string;
  consumed: number;
  target: number;
  barColor: string;
  valueColor: string;
  anim: Animated.Value;
  unit?: string;
  isLast?: boolean;
}) {
  const pct = target > 0 ? Math.min(100, (consumed / target) * 100) : 0;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: pct,
      duration: 420,
      useNativeDriver: false,
    }).start();
  }, [pct, anim]);

  const widthInterpolated = anim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.macroRow, !isLast && styles.macroRowDivider]}>
      <View style={styles.macroRowTop}>
        <Text style={styles.macroLabel}>
          {emoji} {label}
        </Text>
        <Text style={styles.macroNums}>
          <Text style={{ color: valueColor, fontWeight: "700" }}>{fmt1(consumed)}</Text>
          <Text style={styles.macroNumsMuted}>
            /{fmt1(target)}
            {unit}
          </Text>
        </Text>
      </View>
      <View style={styles.macroBarTrack}>
        <Animated.View style={[styles.macroBarFill, { width: widthInterpolated, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

/**
 * Right-aligned placeholder overlay (native placeholder empty).
 * `pinPlaceholderWithValue`: value on the left, hint stays on the right (Add food numeric fields only).
 */
function RightPlaceholderInput({
  placeholder,
  style,
  value,
  pinPlaceholderWithValue,
  ...rest
}: Omit<TextInputProps, "placeholder"> & { placeholder: string; pinPlaceholderWithValue?: boolean }) {
  const str = value == null ? "" : String(value);
  const hasVal = str.length > 0;
  const pinned = Boolean(pinPlaceholderWithValue);
  const showPh = !pinned && !hasVal;
  return (
    <View style={[styles.rpShell, style]}>
      {pinned ? (
        <View style={styles.rpPinnedRow}>
          <TextInput
            {...rest}
            value={value}
            placeholder=""
            placeholderTextColor="transparent"
            style={[styles.rpInput, styles.rpInputPinned, styles.rpInputNumericEmphasis]}
          />
          <Text style={styles.rpPinnedHint} numberOfLines={1} ellipsizeMode="tail">
            {placeholder}
          </Text>
        </View>
      ) : (
        <>
          <TextInput {...rest} value={value} placeholder="" placeholderTextColor="transparent" style={styles.rpInput} />
          {showPh ? (
            <View style={styles.rpPhWrap} pointerEvents="none">
              <Text style={styles.rpPhText} numberOfLines={1} ellipsizeMode="tail">
                {placeholder}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function formatLoadError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.code === "ECONNABORTED") {
      return i18n.t("calorieLog.loadErrors.timeout");
    }
    if (!err.response) {
      const msg = String(err.message || "");
      if (/Failed to fetch|Network Error|ERR_NETWORK|Load failed/i.test(msg)) {
        const base = resolveApiBaseUrl();
        return i18n.t("calorieLog.loadErrors.network", { message: msg || i18n.t("calorieLog.loadErrors.noResponse"), base });
      }
      return i18n.t("calorieLog.loadErrors.cannotReach");
    }
    if (err.response.status === 404) {
      const detail = (err.response.data as { detail?: string })?.detail;
      if (detail === "User not found") {
        return i18n.t("calorieLog.loadErrors.userNotFound");
      }
      const u = String(err.config?.url ?? "");
      return i18n.t("calorieLog.loadErrors.notFound", { url: u || i18n.t("calorieLog.loadErrors.unknownUrl") });
    }
    const data = err.response.data as { detail?: unknown };
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0] && typeof (d[0] as { msg?: string }).msg === "string") {
      return (d[0] as { msg: string }).msg;
    }
    return err.response.status ? i18n.t("calorieLog.loadErrors.serverError", { status: err.response.status }) : err.message;
  }
  return i18n.t("calorieLog.loadErrors.fallback");
}

const NON_VEG_LABELS = new Set(["Chicken breast", "Salmon"]);
const VEGAN_EXCL_LABELS = new Set(["Chicken breast", "Salmon", "Whole egg"]);

export const CalorieLog = () => {
  const { t, i18n: i18nInstance } = useTranslation();
  const catalogLanguage = i18nInstance.resolvedLanguage || i18nInstance.language;
  const token = useAuthStore((s) => s.token);
  const route = useRoute<RouteProp<MainTabParamList, "Calories">>();
  const { hasFeatureAccess } = useFeatureAccess();
  const hasMealPlannerAccess = hasFeatureAccess("meal_plan_generation");
  const [viewMode, setViewMode] = useState<LogPlannerMode>("log");
  const [plannerMounted, setPlannerMounted] = useState(false);
  const { data: onboardingData } = useOnboardingContext();
  const dietType = (onboardingData?.dietary?.diet_type ?? "none").toLowerCase().trim();
  const visibleQuickFoods = QUICK_FOODS.filter((q) => {
    if (dietType === "vegan") return !VEGAN_EXCL_LABELS.has(q.label);
    if (dietType === "vegetarian") return !NON_VEG_LABELS.has(q.label);
    return true;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [day, setDay] = useState<CalorieDayPayload | null>(null);
  const [mealsExpanded, setMealsExpanded] = useState(false);
  const [allTimeMealHistoryOpen, setAllTimeMealHistoryOpen] = useState(false);
  const [mealHistoryRevision, setMealHistoryRevision] = useState(0);
  const [logDate] = useState(() => todayLocal());
  const [targets, setTargets] = useState<any>(null);
  const [burnProfile, setBurnProfile] = useState<BurnProfile | null>(null);
  const [latestWeightKg, setLatestWeightKg] = useState<number | null>(null);

  const [foodName, setFoodName] = useState("");
  const [foodQuery, setFoodQuery] = useState("");
  const [foodResults, setFoodResults] = useState<FoodSearchItem[]>([]);
  const [foodSearchLoading, setFoodSearchLoading] = useState(false);
  const [foodDropdownOpen, setFoodDropdownOpen] = useState(false);
  const [selectedFoodId, setSelectedFoodId] = useState<number | null>(null);
  const [selectedPer100, setSelectedPer100] = useState<{ cal: string; p: string; c: string; f: string; fi: string } | null>(null);
  const [mealType, setMealType] = useState<MealType>(() => mealTypeFromLocalTime());
  const [mealPickerOpen, setMealPickerOpen] = useState(false);
  const [editMealId, setEditMealId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState("");
  const [qty, setQty] = useState("");
  const [cal100, setCal100] = useState("");
  const [p100, setP100] = useState("");
  const [c100, setC100] = useState("");
  const [f100, setF100] = useState("");
  const [fi100, setFi100] = useState("");
  const [aiEstimated, setAiEstimated] = useState(false);
  const [inputMode, setInputMode] = useState<"database" | "camera">("database");
  const [aiConfidence, setAiConfidence] = useState<"low" | "medium" | "high">("medium");
  const [aiServingSize, setAiServingSize] = useState("");
  const [cameraBase, setCameraBase] = useState<CameraBaseNutrition | null>(null);
  const { isAnalyzing, error: foodRecognitionError, analyzeImage, resetFoodRecognition } = useFoodRecognition();

  const animP = useRef(new Animated.Value(0)).current;
  const animC = useRef(new Animated.Value(0)).current;
  const animF = useRef(new Animated.Value(0)).current;
  const animW = useRef(new Animated.Value(0)).current;
  const animFi = useRef(new Animated.Value(0)).current;
  const viewModeInitialized = useRef(false);

  const refresh = useCallback(async () => {
    const d = await getDailyCalorieLog(logDate);
    setDay(d);
    setLoadError(null);
    setMealHistoryRevision((n) => n + 1);
    return d;
  }, [logDate]);

  const applyCalorieDay = useCallback((payload: CalorieDayPayload) => {
    setDay(payload);
    setLoadError(null);
    setMealHistoryRevision((n) => n + 1);
  }, []);

  const loadTargets = useCallback(async () => {
    if (!token) {
      setTargets(null);
      setBurnProfile(null);
      setLatestWeightKg(null);
      return;
    }
    try {
      const [{ profile, targets: t }, weightLatest] = await Promise.all([
        loadOnboardingWithFallback(token),
        fetch(`${resolveApiBaseUrl()}/api/weight/latest`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      setTargets(t);
      setBurnProfile(toBurnProfile(profile));
      const kg = Number(weightLatest?.weight_kg);
      setLatestWeightKg(Number.isFinite(kg) && kg > 0 ? kg : null);
    } catch {
      setTargets(null);
      setBurnProfile(null);
      setLatestWeightKg(null);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadTargets();
      setMealType(mealTypeFromLocalTime());
      void refresh().catch(() => {
        // Keep the last loaded day if a background refresh fails.
      });
    }, [loadTargets, refresh]),
  );

  useEffect(() => {
    if (!viewModeInitialized.current) {
      viewModeInitialized.current = true;
      return;
    }
    if (viewMode !== "log") return;
    void refresh().catch(() => {
      // Keep the last loaded day if a background refresh fails.
    });
  }, [refresh, viewMode]);

  useFocusEffect(
    useCallback(() => {
      const view = route.params?.view;
      if (view === "planner" || view === "log") {
        setViewMode(view);
        if (view === "planner") setPlannerMounted(true);
      }
    }, [route.params?.view]),
  );

  const selectViewMode = useCallback((mode: LogPlannerMode) => {
    setViewMode(mode);
    if (mode === "planner") setPlannerMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await refresh();
      } catch (e) {
        if (!cancelled) {
          setLoadError(axios.isAxiosError(e) ? formatLoadError(e) : e instanceof Error ? e.message : formatLoadError(e));
          setDay(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logDate, refresh, reloadToken]);

  const qtyN = parseFloat(qty) || 0;
  const cal100N = parseFloat(cal100) || 0;
  const p100N = parseFloat(p100) || 0;
  const c100N = parseFloat(c100) || 0;
  const f100N = parseFloat(f100) || 0;
  const fi100N = parseFloat(fi100) || 0;

  const preview = useMemo(() => {
    if (qtyN <= 0) return { kcal: 0, p: 0, c: 0, f: 0, fi: 0 };
    if (inputMode === "camera") {
      // Camera mode fields are shown as direct values; do not scale preview by quantity.
      return {
        kcal: cal100N,
        p: p100N,
        c: c100N,
        f: f100N,
        fi: fi100N,
      };
    }
    return {
      kcal: (cal100N / 100) * qtyN,
      p: (p100N / 100) * qtyN,
      c: (c100N / 100) * qtyN,
      f: (f100N / 100) * qtyN,
      fi: (fi100N / 100) * qtyN,
    };
  }, [qtyN, cal100N, p100N, c100N, f100N, fi100N, inputMode]);

  const waterTotal = day?.water?.total_water_l ?? 0;
  const waterTarget = day?.log?.target_water_l ?? 2.5;
  const glassCount = Math.max(1, Math.round(waterTarget / 0.25));
  const waterPct = waterTarget > 0 ? Math.min(100, (waterTotal / waterTarget) * 100) : 0;

  const setWaterLevel = async (liters: number) => {
    try {
      setSaving(true);
      const d = await patchCalorieWater(Math.max(0, liters), logDate);
      setDay(d);
    } catch {
      Alert.alert(t("calorieLog.alerts.error"), t("calorieLog.alerts.waterFailed"));
    } finally {
      setSaving(false);
    }
  };

  const bumpWater = async (delta: number) => {
    const next = Math.max(0, waterTotal + delta);
    await setWaterLevel(next);
  };

  const applyChip = (q: QuickFood) => {
    setFoodName(q.label);
    setFoodQuery(q.label);
    setSelectedFoodId(null);
    setSelectedPer100(null);
    setFoodDropdownOpen(false);
    setCal100(String(q.cal));
    setP100(String(q.p));
    setC100(String(q.c));
    setF100(String(q.f));
    setFi100(String(q.fi));
    setAiEstimated(false);
    setInputMode("database");
    if (!qty || qty === "0") setQty("");
  };

  const resetAddFoodFormValues = () => {
    setSelectedFoodId(null);
    setSelectedPer100(null);
    setCal100("");
    setP100("");
    setC100("");
    setF100("");
    setFi100("");
    setQty("");
    setAiEstimated(false);
    setInputMode("database");
    setAiConfidence("medium");
    setAiServingSize("");
    setCameraBase(null);
    setFoodResults([]);
    setFoodDropdownOpen(false);
  };

  useEffect(() => {
    const q = foodQuery.trim();
    if (q.length < 2) {
      setFoodResults([]);
      setFoodSearchLoading(false);
      return;
    }
    let cancelled = false;
    setFoodSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const items = await searchFoodCatalog(q, 20, catalogLanguage);
        if (!cancelled) {
          setFoodResults(items);
          setFoodDropdownOpen(true);
        }
      } catch {
        if (!cancelled) {
          setFoodResults([]);
        }
      } finally {
        if (!cancelled) setFoodSearchLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [catalogLanguage, foodQuery]);

  useEffect(() => {
    if (!selectedPer100) return;
    setCal100(selectedPer100.cal);
    setP100(selectedPer100.p);
    setC100(selectedPer100.c);
    setF100(selectedPer100.f);
    setFi100(selectedPer100.fi);
  }, [selectedPer100]);

  const onSelectFood = async (item: FoodSearchItem) => {
    setFoodSearchLoading(true);
    try {
      const quantity = (parseFloat(qty) || 100) > 0 ? parseFloat(qty) || 100 : 100;
      const detail = await lookupFoodNutrition({ food_id: item.food_id, quantity_g: quantity, language: catalogLanguage });
      setSelectedFoodId(item.food_id);
      setFoodName(detail.food_name);
      setFoodQuery(detail.food_name);
      setSelectedPer100({
        cal: String(detail.per_100g.calories),
        p: String(detail.per_100g.protein_g),
        c: String(detail.per_100g.carbs_g),
        f: String(detail.per_100g.fat_g),
        fi: String(detail.per_100g.fiber_g),
      });
      setAiEstimated(false);
      setInputMode("database");
      setFoodDropdownOpen(false);
      setFoodResults([]);
    } catch (e) {
      const msg = axios.isAxiosError(e) ? String((e.response?.data as { detail?: string })?.detail || e.message) : t("calorieLog.alerts.foodNotFound");
      Alert.alert(t("calorieLog.alerts.foodLookup"), msg);
    } finally {
      setFoodSearchLoading(false);
    }
  };

  const submitMeal = async () => {
    if (!foodName.trim()) {
      Alert.alert(t("calorieLog.alerts.missing"), t("calorieLog.alerts.foodNameRequired"));
      return;
    }
    if (qtyN <= 0) {
      Alert.alert(t("calorieLog.alerts.invalid"), t("calorieLog.alerts.quantityPositive"));
      return;
    }
    try {
      setSaving(true);
      if (inputMode === "camera") {
        // Camera logs are persisted in dedicated AI meal storage using direct totals
        // (same shape as values shown in the UI), not per-100g meal entries.
        const safeQty = round2(clamp(sanitizeFinite(qtyN > 0 ? qtyN : 1), 0.01, 999999.99));
        const aiSaved = await postAIFoodMeal({
          log_date: logDate,
          meal_type: mealType,
          food_name: foodName.trim(),
          quantity_g: safeQty,
          calories: round2(clamp(sanitizeFinite(cal100N), 0, 999999.99)),
          protein: round2(clamp(sanitizeFinite(p100N), 0, 999999.99)),
          carbs: round2(clamp(sanitizeFinite(c100N), 0, 999999.99)),
          fat: round2(clamp(sanitizeFinite(f100N), 0, 999999.99)),
          fibre: round2(clamp(sanitizeFinite(fi100N), 0, 999999.99)),
          confidence: aiConfidence,
          estimated_serving_size: aiServingSize || undefined,
        });
        if (aiSaved?.day) applyCalorieDay(aiSaved.day);
        else await refresh();
      } else {
        const safeQty = round2(clamp(sanitizeFinite(qtyN), 0.01, 999999.99));
        const d = await postCalorieMeal({
          log_date: logDate,
          meal_type: mealType,
          source_type: "database",
          food_id: selectedFoodId,
          food_name: foodName.trim(),
          quantity_g: safeQty,
          calories_per_100g: round2(clamp(sanitizeFinite(cal100N), 0, 99999.99)),
          protein_per_100g: round2(clamp(sanitizeFinite(p100N), 0, 9999.99)),
          carbs_per_100g: round2(clamp(sanitizeFinite(c100N), 0, 9999.99)),
          fat_per_100g: round2(clamp(sanitizeFinite(f100N), 0, 9999.99)),
          fiber_per_100g: round2(clamp(sanitizeFinite(fi100N), 0, 9999.99)),
        });
        applyCalorieDay(d);
      }
      setFoodName("");
      setFoodQuery("");
      setFoodResults([]);
      setFoodDropdownOpen(false);
      setSelectedFoodId(null);
      setSelectedPer100(null);
      setCal100("");
      setP100("");
      setC100("");
      setF100("");
      setFi100("");
      setQty("");
      setAiEstimated(false);
      setInputMode("database");
      setAiConfidence("medium");
      setAiServingSize("");
      setMealType(mealTypeFromLocalTime());
      resetFoodRecognition();
    } catch (e) {
      const message = axios.isAxiosError(e)
        ? String((e.response?.data as { detail?: unknown })?.detail ?? e.message ?? t("calorieLog.alerts.saveMealFailed"))
        : t("calorieLog.alerts.saveMealFailed");
      Alert.alert(t("calorieLog.alerts.error"), message);
    } finally {
      setSaving(false);
    }
  };

  const showToast = (message: string) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    if (Platform.OS === "web" && typeof globalThis !== "undefined" && typeof globalThis.alert === "function") {
      globalThis.alert(message);
      return;
    }
    Alert.alert(t("calorieLog.alerts.foodScanner"), message);
  };

  const parseQuantityFromServing = (serving: string, quantityGrams?: number): string => {
    if (Number.isFinite(quantityGrams) && (quantityGrams ?? 0) > 0) {
      return String(Math.round(Number(quantityGrams)));
    }
    const normalized = (serving || "").toLowerCase();
    const gramsMatch = /(\d+(\.\d+)?)\s*(g|gm|gms|gram|grams)\b/i.exec(normalized);
    if (gramsMatch) {
      return String(Math.round(Number(gramsMatch[1])));
    }
    return "";
  };

  const applyAnalysisToForm = (result: FoodAnalysisResult) => {
    setFoodName(result.foodName);
    setFoodQuery(result.foodName);
    setSelectedFoodId(null);
    setSelectedPer100(null);
    setFoodDropdownOpen(false);
    setFoodResults([]);
    setCal100(String(result.calories));
    setP100(String(result.protein));
    setC100(String(result.carbs));
    setF100(String(result.fats));
    setFi100(String(result.fibre));
    const parsedQty = parseQuantityFromServing(result.estimatedServingSize, result.quantityGrams);
    const baseQty = Number(parsedQty) > 0 ? Number(parsedQty) : 1;
    setQty(String(baseQty));
    setCameraBase({
      qty: baseQty,
      cal: Number(result.calories) || 0,
      p: Number(result.protein) || 0,
      c: Number(result.carbs) || 0,
      f: Number(result.fats) || 0,
      fi: Number(result.fibre) || 0,
    });
    setAiEstimated(true);
    setInputMode("camera");
    setAiConfidence(result.confidence);
    setAiServingSize(result.estimatedServingSize);
  };

  const runFoodRecognition = async (payload: { base64: string; mimeType?: string }) => {
    const result = await analyzeImage(payload);
    if (!result) {
      showToast(foodRecognitionError || t("calorieLog.alerts.analysisFailed"));
      return;
    }
    applyAnalysisToForm(result);
    showToast(t("calorieLog.alerts.detected", { foodName: result.foodName }));
  };

  useEffect(() => {
    if (!foodRecognitionError) return;
    Alert.alert(t("calorieLog.alerts.foodRecognition"), foodRecognitionError, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("calorieLog.retry"),
        onPress: () => {
          showToast(t("calorieLog.alerts.retryHint"));
        },
      },
    ]);
  }, [foodRecognitionError, t]);

  const onDeleteMeal = async (mealId: number, sourceType?: "database" | "camera_ai" | "meal_planner") => {
    try {
      setSaving(true);
      const d = sourceType === "camera_ai" ? await deleteAIFoodMeal(Math.abs(mealId)) : await deleteCalorieMeal(mealId);
      // Reflect server deletion immediately.
      applyCalorieDay(d);
      await refresh();
    } catch {
      Alert.alert(t("calorieLog.alerts.error"), t("calorieLog.alerts.deleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  const openEditMeal = (mealId: number, quantityG: number) => {
    setEditMealId(mealId);
    setEditQty(String(quantityG));
  };

  const submitEditMealQty = async () => {
    if (!editMealId) return;
    const nextQty = parseFloat(editQty);
    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      Alert.alert(t("calorieLog.alerts.invalid"), t("calorieLog.alerts.quantityPositive"));
      return;
    }
    try {
      setSaving(true);
      const d = await patchCalorieMealQty(editMealId, nextQty);
      applyCalorieDay(d);
      setEditMealId(null);
      setEditQty("");
    } catch {
      Alert.alert(t("calorieLog.alerts.error"), t("calorieLog.alerts.updateQtyFailed"));
    } finally {
      setSaving(false);
    }
  };

  const showLogContent = !loading && Boolean(day) && !loadError;
  const log = day?.log;
  const macro_split_label = day?.macro_split_label ?? "";
  const fiberConsumed = Number((log as Record<string, unknown> | undefined)?.total_fiber_g ?? 0);
  const fiberTarget = Number(
    (log as Record<string, unknown> | undefined)?.target_fiber_g ?? targets?.macros?.fiber_g ?? 0,
  );
  // Daily kcal from calorie_log_targets via daily log API (same as Home + Meal Planner).
  const dailyGoal = Math.max(1, Math.round(Number(log?.target_calories) || 1800));
  const eatenToday = Number(log?.total_calories) || 0;
  const remaining = dailyGoal - eatenToday;
  const remainingColor = remaining > 0 ? GREEN : remaining < 0 ? ORANGE : MUTED;
  const caloriePct = dailyGoal > 0 ? clamp(eatenToday / dailyGoal, 0, 1) * 100 : 0;
  const macroSplit = parseMacroSplit(macro_split_label);
  const totalGlasses = Math.round((log?.target_water_l ?? 0) / 0.25);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.chrome}>
        <Text style={styles.pageTitle}>{t("calorieLog.title")}</Text>
        <LogPlannerSegment mode={viewMode} onChange={selectViewMode} />
      </View>

      <View style={[styles.modePanel, viewMode !== "log" && styles.modePanelHidden]} pointerEvents={viewMode === "log" ? "auto" : "none"}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={GREEN} size="large" />
            <Text style={styles.loadingText}>{t("calorieLog.loading")}</Text>
          </View>
        ) : !showLogContent || !log || !day ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.errorText}>{loadError ?? t("calorieLog.alerts.generic")}</Text>
            <Pressable
              style={styles.retryBtn}
              onPress={() => {
                invalidateCaloriesRoutePrefix();
                setReloadToken((n) => n + 1);
              }}
            >
              <Text style={styles.retryBtnText}>{t("calorieLog.retry")}</Text>
            </Pressable>
          </ScrollView>
        ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.card}>
          <View style={styles.calorieHeroRow}>
            <View style={styles.calorieHeroLeft}>
              <Text style={styles.cardLabel}>{t("calorieLog.caloriesToday")}</Text>
              <View style={styles.calorieValueRow}>
                <Text style={styles.calorieBig}>{fmt1(eatenToday)}</Text>
                <Text style={styles.calorieTarget}> / {fmt1(dailyGoal)} kcal</Text>
              </View>
            </View>
            <View style={styles.calorieHeroRight}>
              <Text style={styles.remainingLabel}>{t("calorieLog.remaining")}</Text>
              <Text style={[styles.remainingValue, { color: remainingColor }]}>{fmt1(remaining)}</Text>
              <Text style={styles.remainingUnit}>{t("calorieLog.kcal")}</Text>
            </View>
          </View>
          <View style={styles.calorieBarTrack}>
            <View style={[styles.calorieBarFill, { width: `${caloriePct}%` }]} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.macrosHeader}>
            <Text style={styles.cardLabel}>{t("calorieLog.macros")}</Text>
            <View style={styles.macroPills}>
              <View style={[styles.macroPill, { backgroundColor: BLUE_LIGHT }]}>
                <Text style={[styles.macroPillText, { color: BLUE }]}>P {macroSplit.p}%</Text>
              </View>
              <View style={[styles.macroPill, { backgroundColor: GREEN_LIGHT }]}>
                <Text style={[styles.macroPillText, { color: GREEN }]}>C {macroSplit.c}%</Text>
              </View>
              <View style={[styles.macroPill, { backgroundColor: ORANGE_LIGHT }]}>
                <Text style={[styles.macroPillText, { color: ORANGE }]}>F {macroSplit.f}%</Text>
              </View>
            </View>
          </View>
          <MacroBar emoji="🥩" label={t("calorieLog.protein")} consumed={log.total_protein_g} target={log.target_protein_g} barColor={BLUE} valueColor={BLUE} anim={animP} />
          <MacroBar emoji="🌾" label={t("calorieLog.carbs")} consumed={log.total_carbs_g} target={log.target_carbs_g} barColor={GREEN} valueColor={GREEN} anim={animC} />
          <MacroBar emoji="🥑" label={t("calorieLog.fat")} consumed={log.total_fat_g} target={log.target_fat_g} barColor={ORANGE} valueColor={ORANGE} anim={animF} />
          <MacroBar emoji="💧" label={t("calorieLog.water")} consumed={waterTotal} target={waterTarget} barColor={BLUE} valueColor={BLUE} anim={animW} unit="L" />
          <MacroBar emoji="🥦" label={t("calorieLog.fibre")} consumed={fiberConsumed} target={fiberTarget} barColor={PURPLE} valueColor={PURPLE} anim={animFi} isLast />
        </View>

        <View style={styles.card}>
          <View style={styles.waterHeader}>
            <Text style={styles.waterTitle}>{t("calorieLog.waterIntake")}</Text>
            <Text style={styles.waterHeaderValue}>
              {fmt1(waterTotal)}L / {fmt1(waterTarget)}L
            </Text>
          </View>
          <View style={styles.glassGrid}>
            {Array.from({ length: totalGlasses > 0 ? totalGlasses : glassCount }).map((_, i) => {
              const level = (i + 1) * 0.25;
              const filled = waterTotal >= level - 1e-6;
              return (
                <Pressable
                  key={i}
                  onPress={() => setWaterLevel(level)}
                  disabled={saving}
                  style={[styles.glassTile, filled ? styles.glassTileFilled : styles.glassTileEmpty]}
                >
                  <Text style={styles.glassEmoji}>{filled ? "💧" : "🥛"}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.waterControlsRow}>
            <Text style={styles.waterHint}>{t("calorieLog.glassHint")}</Text>
            <View style={styles.waterBtns}>
              <Pressable style={styles.waterMinusBtn} onPress={() => bumpWater(-0.25)} disabled={saving}>
                <Text style={styles.waterMinusText}>−</Text>
              </Pressable>
              <Pressable style={styles.waterPlusBtn} onPress={() => bumpWater(0.25)} disabled={saving}>
                <Text style={styles.waterPlusText}>+</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.waterBarTrack}>
            <View style={[styles.waterBarFill, { width: `${waterPct}%` }]} />
          </View>
          <View style={styles.waterBarLabels}>
            <Text style={styles.waterMini}>0L</Text>
            <Text style={styles.waterMini}>
              {fmt1(waterTotal)}L / {fmt1(waterTarget)}L
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.addFoodHeader}>
            <Text style={styles.cardLabel}>{t("calorieLog.addFood")}</Text>
            <FoodCameraButton disabled={saving || isAnalyzing} onImageSelected={runFoodRecognition} variant="scanPill" />
          </View>
          <Text style={styles.scanCaption}>{t("calorieLog.scanCaption")}</Text>
          <View style={styles.searchWrap}>
            <TextInput
              placeholder={t("calorieLog.searchPlaceholder")}
              placeholderTextColor={MUTED}
              value={foodQuery}
              onFocus={() => {
                if (foodResults.length > 0) setFoodDropdownOpen(true);
              }}
              onChangeText={(v) => {
                const wasAutofilled = selectedFoodId !== null || selectedPer100 !== null || inputMode === "camera" || aiEstimated;
                setFoodQuery(v);
                setFoodName(v);
                if (wasAutofilled) {
                  resetAddFoodFormValues();
                }
              }}
              style={styles.searchInput}
            />
            {foodSearchLoading ? <Text style={styles.foodSearchHint}>{t("calorieLog.searching")}</Text> : null}
            {!foodSearchLoading && selectedFoodId ? <Text style={styles.foodSearchHint}>{t("calorieLog.selectedDatabase")}</Text> : null}
            {foodDropdownOpen ? (
              <View style={styles.foodDropdown}>
                {foodResults.length === 0 ? (
                  <Text style={styles.foodEmpty}>{t("calorieLog.noFoods")}</Text>
                ) : (
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.foodDropdownScroll}>
                    {foodResults.map((item, idx) => (
                      <Pressable
                        key={`${item.food_id}`}
                        style={[styles.foodOption, idx === foodResults.length - 1 && styles.foodOptionLast]}
                        onPress={() => void onSelectFood(item)}
                      >
                        <Text style={styles.foodOptionName}>{item.food_name}</Text>
                        <Text style={styles.foodOptionMeta}>{item.category}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : null}
          </View>

          <Pressable style={styles.mealChip} onPress={() => setMealPickerOpen(true)}>
            <Text style={styles.mealChipText}>
              {MEAL_TYPE_EMOJI[mealType]} {mealHeading(mealType)}
            </Text>
            <Text style={styles.mealChipChev}>▾</Text>
          </Pressable>

          <View style={styles.nutrientGrid}>
            <View style={styles.nutrientTile}>
              <Text style={styles.nutrientLabel}>{inputMode === "camera" ? t("calorieLog.qty") : t("calorieLog.qtyG")}</Text>
              <RightPlaceholderInput
                placeholder=""
                keyboardType="decimal-pad"
                value={qty}
                onChangeText={(v) => {
                  const nextQtyText = sanitizeNumericInput(v);
                  setQty(nextQtyText);
                  if (inputMode === "camera" && cameraBase) {
                    const nextQty = parseFloat(nextQtyText);
                    const baseQty = cameraBase.qty > 0 ? cameraBase.qty : 1;
                    const factor = Number.isFinite(nextQty) && nextQty > 0 ? nextQty / baseQty : 1;
                    const scaled = (n: number) => (Math.round(n * factor * 10) / 10).toString();
                    setCal100(scaled(cameraBase.cal));
                    setP100(scaled(cameraBase.p));
                    setC100(scaled(cameraBase.c));
                    setF100(scaled(cameraBase.f));
                    setFi100(scaled(cameraBase.fi));
                  }
                  setAiEstimated(false);
                }}
                style={styles.nutrientInput}
              />
            </View>
            <View style={styles.nutrientTile}>
              <Text style={styles.nutrientLabel}>{inputMode === "camera" ? t("calorieLog.cal") : t("calorieLog.calPer100")}</Text>
              <RightPlaceholderInput
                placeholder=""
                keyboardType="decimal-pad"
                value={cal100}
                onChangeText={(v) => {
                  setCal100(sanitizeNumericInput(v));
                  setAiEstimated(false);
                }}
                style={styles.nutrientInput}
              />
            </View>
            <View style={styles.nutrientTile}>
              <Text style={styles.nutrientLabel}>{inputMode === "camera" ? t("calorieLog.protein") : t("calorieLog.proteinPer100")}</Text>
              <RightPlaceholderInput
                placeholder=""
                keyboardType="decimal-pad"
                value={p100}
                onChangeText={(v) => {
                  setP100(sanitizeNumericInput(v));
                  setAiEstimated(false);
                }}
                style={styles.nutrientInput}
              />
            </View>
            <View style={styles.nutrientTile}>
              <Text style={styles.nutrientLabel}>{inputMode === "camera" ? t("calorieLog.carbs") : t("calorieLog.carbsPer100")}</Text>
              <RightPlaceholderInput
                placeholder=""
                keyboardType="decimal-pad"
                value={c100}
                onChangeText={(v) => {
                  setC100(sanitizeNumericInput(v));
                  setAiEstimated(false);
                }}
                style={styles.nutrientInput}
              />
            </View>
            <View style={styles.nutrientTile}>
              <Text style={styles.nutrientLabel}>{inputMode === "camera" ? t("calorieLog.fat") : t("calorieLog.fatPer100")}</Text>
              <RightPlaceholderInput
                placeholder=""
                keyboardType="decimal-pad"
                value={f100}
                onChangeText={(v) => {
                  setF100(sanitizeNumericInput(v));
                  setAiEstimated(false);
                }}
                style={styles.nutrientInput}
              />
            </View>
            <View style={styles.nutrientTile}>
              <Text style={styles.nutrientLabel}>{inputMode === "camera" ? t("calorieLog.fibre") : t("calorieLog.fibrePer100")}</Text>
              <RightPlaceholderInput
                placeholder=""
                keyboardType="decimal-pad"
                value={fi100}
                onChangeText={(v) => {
                  setFi100(sanitizeNumericInput(v));
                  setAiEstimated(false);
                }}
                style={styles.nutrientInput}
              />
            </View>
          </View>

          {foodRecognitionError ? <Text style={styles.foodRecognitionError}>{foodRecognitionError}</Text> : null}
          {aiEstimated ? <Text style={styles.aiCaption}>{t("calorieLog.aiEstimated")}</Text> : null}

          <View style={styles.previewTile}>
            <Text style={styles.previewText}>
              {t("calorieLog.preview")}{" "}
              <Text style={styles.previewStrong}>
                {fmt1(preview.kcal)} kcal · P {fmt1(preview.p)}g · C {fmt1(preview.c)}g · F {fmt1(preview.f)}g · Fi {fmt1(preview.fi)}g
              </Text>
            </Text>
          </View>

          <Pressable style={[styles.addFoodBtn, saving && styles.addFoodBtnDisabled]} onPress={submitMeal} disabled={saving}>
            <Text style={styles.addFoodBtnText}>{t("calorieLog.addFoodButton")}</Text>
          </Pressable>
        </View>

        <Text style={styles.quickAddLabel}>{t("calorieLog.quickAdd")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickAddRow}>
          {visibleQuickFoods.map((q) => (
            <Pressable key={q.label} style={styles.quickChip} onPress={() => applyChip(q)}>
              <Text style={styles.quickChipText}>
                {QUICK_FOOD_EMOJI[q.label] ?? "🍽️"} {q.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.mealsHistoryCard}>
          <View style={styles.mealsCardHeader}>
            <Pressable
              style={styles.mealsToggle}
              onPress={() => setMealsExpanded((prev) => !prev)}
              accessibilityRole="button"
              accessibilityState={{ expanded: mealsExpanded }}
            >
              <View style={styles.mealsHeaderLeft}>
                <Text style={styles.mealsEyebrow}>RECENT</Text>
                <Text style={styles.mealsHistoryTitle}>{t("calorieLog.mealHistory", { defaultValue: "Meal history" })}</Text>
              </View>
              <View style={styles.mealsHeaderRight}>
                <Text style={styles.mealsCount}>{day.meals.length} today</Text>
                <Text style={[styles.mealsChevron, mealsExpanded ? styles.mealsChevronOpen : null]}>▾</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open all time meal history"
              style={styles.allTimeMealsBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setAllTimeMealHistoryOpen(true)}
            >
              <Text style={styles.allTimeMealsText}>All time ›</Text>
            </Pressable>
          </View>
          {day.meals.length === 0 ? (
            <Text style={styles.emptyMeals}>{t("calorieLog.emptyMeals")}</Text>
          ) : mealsExpanded ? (
            <>
              {day.meals.map((m, idx) => (
                <View key={m.meal_id} style={[styles.mealRow, idx > 0 && styles.mealRowDivider]}>
                  <View style={styles.mealRowLeft}>
                    <View style={styles.mealNameRow}>
                      <Text style={styles.mealName}>
                        {MEAL_TYPE_EMOJI[m.meal_type]} {m.food_name}
                      </Text>
                      {m.source_type === "meal_planner" ? (
                        <View style={styles.plannerBadge}>
                          <Text style={styles.plannerBadgeText}>{t("calorieLog.fromMealPlanner")}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.mealSubMeta}>
                      {mealRowLabel(m.meal_type)} · {m.source_type === "camera_ai" ? `${fmt1(m.quantity_g)} Qty` : `${fmt1(m.quantity_g)}g`}
                    </Text>
                    <Text style={styles.mealMacroMeta}>
                      P {fmt1(m.total_protein_g)} · C {fmt1(m.total_carbs_g)} · F {fmt1(m.total_fat_g)} · Fi {fmt1(m.total_fiber_g || 0)} ·{" "}
                      <Text style={styles.mealKcal}>{fmt1(m.total_calories)} kcal</Text>
                    </Text>
                  </View>
                  <View style={styles.mealActions}>
                    {m.source_type !== "camera_ai" && m.source_type !== "meal_planner" ? (
                      <Pressable
                        style={[styles.editPill, saving && styles.btnDisabled]}
                        onPress={() => openEditMeal(m.meal_id, m.quantity_g)}
                        hitSlop={8}
                        disabled={saving}
                      >
                        <Text style={styles.editPillText}>{t("calorieLog.edit")}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[styles.deletePill, saving && styles.btnDisabled]}
                      onPress={() => void onDeleteMeal(m.meal_id, m.source_type)}
                      hitSlop={8}
                      disabled={saving}
                    >
                      <Text style={styles.deletePillText}>✕</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              <View style={styles.dayTotalRow}>
                <Text style={styles.dayTotalLabel}>{t("calorieLog.dayTotal")}</Text>
                <Text style={styles.dayTotalValue}>
                  {fmt1(log.total_calories)} kcal · {fmt1(log.total_protein_g)}p · {fmt1(log.total_carbs_g)}c · {fmt1(log.total_fat_g)}f · {fmt1(log.total_fiber_g || 0)}fi
                </Text>
              </View>
            </>
          ) : (
            null
          )}
        </View>
      </ScrollView>
        )}
      </View>

      <View
        style={[styles.modePanel, viewMode !== "planner" && styles.modePanelHidden]}
        pointerEvents={viewMode === "planner" ? "auto" : "none"}
      >
        {plannerMounted ? (
          hasMealPlannerAccess ? (
            <MonthlyMealPlannerScreen embedded onCalorieDayChanged={applyCalorieDay} />
          ) : (
            <PlannerLockedUpsell
              feature="meal_plan_generation"
              featureName={t("coach.home.mealPlanner.name")}
              featureDescription={t("coach.home.mealPlanner.gateDescription")}
              featureEmoji="📅"
              accentColor="#378add"
            />
          )
        ) : null}
      </View>

      <Modal visible={mealPickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMealPickerOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("calorieLog.selectMealType")}</Text>
            {MEAL_ORDER.map((t) => (
              <Pressable
                key={t}
                style={styles.modalMealRow}
                onPress={() => {
                  setMealType(t);
                  setMealPickerOpen(false);
                }}
              >
                <Text style={styles.modalMealRowText}>
                  {MEAL_TYPE_EMOJI[t]} {mealHeading(t)}
                </Text>
                {mealType === t ? <Text style={styles.modalCheck}>✓</Text> : <View style={styles.modalCheckSpacer} />}
              </Pressable>
            ))}
            <Pressable style={styles.modalCancelBtn} onPress={() => setMealPickerOpen(false)}>
              <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <AllTimeMealHistoryModal
        visible={allTimeMealHistoryOpen}
        refreshToken={mealHistoryRevision}
        onClose={() => setAllTimeMealHistoryOpen(false)}
      />

      <Modal visible={editMealId !== null} transparent animationType="fade" onRequestClose={() => setEditMealId(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditMealId(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("calorieLog.editQuantity")}</Text>
            <TextInput
              placeholder={t("calorieLog.qtyG")}
              placeholderTextColor={MUTED}
              keyboardType="decimal-pad"
              value={editQty}
              onChangeText={(v) => setEditQty(sanitizeNumericInput(v))}
              style={styles.editQtyInput}
            />
            <View style={styles.editActions}>
              <Pressable style={styles.editCancelBtn} onPress={() => setEditMealId(null)}>
                <Text style={styles.editCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable style={[styles.editSaveBtn, saving && styles.btnDisabled]} onPress={submitEditMealQty} disabled={saving}>
                <Text style={styles.editSaveText}>{t("common.save")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={isAnalyzing} transparent animationType="fade">
        <View style={styles.analyzingOverlay}>
          <View style={styles.analyzingCard}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={styles.analyzingText}>{t("calorieLog.analyzing")}</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: SCREEN_BG },
  chrome: { paddingHorizontal: 16, paddingTop: 4, maxWidth: 860, width: "100%", alignSelf: "center" },
  modePanel: { flex: 1 },
  modePanelHidden: { display: "none" },
  scroll: { flex: 1, backgroundColor: SCREEN_BG },
  scrollContent: { padding: 16, paddingBottom: 40, maxWidth: 860, width: "100%", alignSelf: "center" },
  center: { flex: 1, minHeight: 200, alignItems: "center", justifyContent: "center", backgroundColor: SCREEN_BG },
  loadingText: { color: MUTED, marginTop: 12, fontSize: 14 },
  pageTitle: { color: TEXT, fontSize: 25, fontWeight: "800", marginBottom: 12 },
  errorText: { color: MUTED, fontSize: 15, lineHeight: 22, marginTop: 12, marginBottom: 20 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: GREEN,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryBtnText: { color: WHITE, fontWeight: "800", fontSize: 15 },
  card: {
    backgroundColor: BG,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  calorieHeroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  calorieHeroLeft: { flex: 1, paddingRight: 12 },
  calorieHeroRight: { alignItems: "flex-end" },
  calorieValueRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", marginTop: 4 },
  calorieBig: { color: TEXT, fontSize: 32, fontWeight: "800" },
  calorieTarget: { color: MUTED, fontSize: 14 },
  remainingLabel: { color: MUTED, fontSize: 11, fontWeight: "600" },
  remainingValue: { fontSize: 18, fontWeight: "800", marginTop: 2 },
  remainingUnit: { color: MUTED, fontSize: 11, marginTop: 2 },
  calorieBarTrack: { height: 7, borderRadius: 4, backgroundColor: TRACK, overflow: "hidden" },
  calorieBarFill: { height: 7, borderRadius: 4, backgroundColor: GREEN },
  macrosHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  macroPills: { flexDirection: "row", gap: 5, flexShrink: 1, flexWrap: "wrap", justifyContent: "flex-end" },
  macroPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99 },
  macroPillText: { fontSize: 10, fontWeight: "700" },
  macroRow: { paddingVertical: 10 },
  macroRowDivider: { borderBottomWidth: 1, borderBottomColor: BORDER },
  macroRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  macroLabel: { color: TEXT, fontWeight: "600", fontSize: 14 },
  macroNums: { fontSize: 13 },
  macroNumsMuted: { color: MUTED },
  macroBarTrack: { height: 6, borderRadius: 4, backgroundColor: TRACK, overflow: "hidden" },
  macroBarFill: { height: 6, borderRadius: 4 },
  waterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  waterTitle: { color: MUTED, fontSize: 13, fontWeight: "600" },
  waterHeaderValue: { color: TEXT, fontSize: 14, fontWeight: "800" },
  glassGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 12 },
  glassTile: {
    width: 28,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  glassTileFilled: { backgroundColor: BLUE_LIGHT },
  glassTileEmpty: { backgroundColor: TRACK },
  glassEmoji: { fontSize: 14 },
  waterControlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  waterHint: { color: MUTED, fontSize: 11 },
  waterBtns: { flexDirection: "row", gap: 8 },
  waterMinusBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: TRACK,
    alignItems: "center",
    justifyContent: "center",
  },
  waterMinusText: { color: TEXT, fontSize: 18, fontWeight: "700" },
  waterPlusBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  waterPlusText: { color: WHITE, fontSize: 18, fontWeight: "700" },
  waterBarTrack: { height: 6, borderRadius: 4, backgroundColor: TRACK, overflow: "hidden" },
  waterBarFill: { height: 6, borderRadius: 4, backgroundColor: BLUE },
  waterBarLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  waterMini: { color: MUTED, fontSize: 11 },
  addFoodHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  scanCaption: { color: "#4A8C77", fontSize: 10, textAlign: "right", marginBottom: 12 },
  searchWrap: { position: "relative", marginBottom: 10, zIndex: 20 },
  searchInput: {
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: TEXT,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 15,
  },
  foodSearchHint: { color: MUTED, fontSize: 11, marginTop: 4, marginLeft: 2 },
  foodDropdown: {
    marginTop: 6,
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    maxHeight: 220,
    overflow: "hidden",
  },
  foodDropdownScroll: { maxHeight: 220 },
  foodOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  foodOptionLast: { borderBottomWidth: 0 },
  foodOptionName: { color: TEXT, fontWeight: "700", fontSize: 14 },
  foodOptionMeta: { color: MUTED, marginTop: 2, fontSize: 12 },
  foodEmpty: { color: MUTED, fontSize: 13, padding: 12 },
  mealChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: WHITE,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: GREEN,
  },
  mealChipText: { color: TEXT, fontWeight: "600", fontSize: 15 },
  mealChipChev: { color: MUTED, fontSize: 14 },
  nutrientGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  nutrientTile: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: WHITE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: "46%",
  },
  nutrientLabel: { color: MUTED, fontSize: 10, marginBottom: 4, fontWeight: "600" },
  nutrientInput: { minHeight: 24 },
  foodRecognitionError: { marginTop: 10, color: ORANGE, fontSize: 12, lineHeight: 18 },
  aiCaption: { marginTop: 8, color: PURPLE, fontSize: 11, fontWeight: "700" },
  previewTile: {
    marginTop: 12,
    backgroundColor: WHITE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
  },
  previewText: { color: MUTED, fontSize: 13 },
  previewStrong: { color: TEXT, fontWeight: "700" },
  addFoodBtn: {
    marginTop: 12,
    backgroundColor: GREEN,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  addFoodBtnDisabled: { opacity: 0.5 },
  addFoodBtnText: { color: WHITE, fontWeight: "800", fontSize: 15 },
  quickAddLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 2,
  },
  quickAddRow: { flexDirection: "row", gap: 8, paddingBottom: 14 },
  quickChip: {
    backgroundColor: WHITE,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: BORDER,
  },
  quickChipText: { color: TEXT, fontSize: 13, fontWeight: "600" },
  mealsHistoryCard: {
    backgroundColor: BG,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  mealsCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  mealsToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 12,
  },
  mealsHeaderLeft: { flex: 1, minWidth: 0 },
  mealsEyebrow: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  mealsHistoryTitle: { color: TEXT, fontSize: 16, fontWeight: "700" },
  mealsHeaderRight: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  mealsCount: { color: GREEN, fontSize: 12, fontWeight: "700" },
  mealsChevron: { color: GREEN, fontSize: 14, fontWeight: "700" },
  mealsChevronOpen: { transform: [{ rotate: "180deg" }] },
  allTimeMealsBtn: { paddingVertical: 6, paddingLeft: 4 },
  allTimeMealsText: { color: GREEN, fontSize: 13, fontWeight: "500" },
  emptyMeals: { color: MUTED, fontSize: 14, textAlign: "center", paddingVertical: 16 },
  mealRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, gap: 8 },
  mealRowDivider: { borderTopWidth: 1, borderTopColor: BORDER },
  mealRowLeft: { flex: 1 },
  mealNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  mealName: { color: TEXT, fontWeight: "700", fontSize: 13 },
  plannerBadge: { backgroundColor: "#EAF5F1", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  plannerBadgeText: { color: GREEN, fontSize: 9.5, fontWeight: "700" },
  mealSubMeta: { color: MUTED, fontSize: 11, marginTop: 2 },
  mealMacroMeta: { color: MUTED, fontSize: 11, marginTop: 2 },
  mealKcal: { color: TEXT, fontWeight: "700" },
  mealActions: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 2 },
  editPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: GREEN_LIGHT,
  },
  editPillText: { color: GREEN, fontSize: 11, fontWeight: "700" },
  deletePill: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: ORANGE_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  deletePillText: { color: ORANGE, fontSize: 13, fontWeight: "700" },
  btnDisabled: { opacity: 0.5 },
  dayTotalRow: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  dayTotalLabel: { color: MUTED, fontSize: 12 },
  dayTotalValue: { color: TEXT, fontWeight: "700", fontSize: 13, flex: 1, textAlign: "right" },
  dayTotalRowCollapsed: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  rpShell: {
    position: "relative",
    justifyContent: "center",
    minWidth: 0,
  },
  rpInput: {
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0,
    margin: 0,
    color: TEXT,
    fontSize: 15,
    minHeight: 22,
    width: "100%",
    textAlign: "left",
  },
  rpInputNumericEmphasis: {
    fontWeight: "700",
  },
  rpPinnedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  rpInputPinned: {
    flex: 1,
    width: undefined,
    minWidth: 0,
  },
  rpPinnedHint: {
    color: MUTED,
    fontSize: 15,
    fontWeight: "500",
    textAlign: "right",
    flexShrink: 0,
  },
  rpPhWrap: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 4,
    paddingLeft: 40,
    maxWidth: "100%",
  },
  rpPhText: {
    color: MUTED,
    fontSize: 15,
    fontWeight: "500",
    textAlign: "right",
    width: "100%",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26,26,24,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 16,
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: { color: TEXT, fontWeight: "800", fontSize: 16, marginBottom: 12 },
  modalMealRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalMealRowText: { color: TEXT, fontSize: 15, fontWeight: "600" },
  modalCheck: { color: GREEN, fontSize: 18, fontWeight: "800" },
  modalCheckSpacer: { width: 18 },
  modalCancelBtn: { marginTop: 12, alignItems: "center", paddingVertical: 10 },
  modalCancelText: { color: ORANGE, fontSize: 15, fontWeight: "700" },
  editQtyInput: {
    backgroundColor: WHITE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: TEXT,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 15,
    marginBottom: 12,
  },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  editCancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  editCancelText: { color: MUTED, fontSize: 14, fontWeight: "700" },
  editSaveBtn: {
    backgroundColor: GREEN,
    borderRadius: 99,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  editSaveText: { color: WHITE, fontSize: 14, fontWeight: "800" },
  analyzingOverlay: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  analyzingCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: "center",
    minWidth: 240,
  },
  analyzingText: {
    color: MUTED,
    marginTop: 12,
    fontSize: 15,
    fontWeight: "600",
  },
});
