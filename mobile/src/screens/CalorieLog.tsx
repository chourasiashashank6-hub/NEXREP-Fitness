import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
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
import { LinearGradient } from "expo-linear-gradient";
import axios from "axios";
import {
  CalorieDayPayload,
  FoodSearchItem,
  MealType,
  deleteAIFoodMeal,
  deleteCalorieMeal,
  ensureDailyCalorieLog,
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
import { ONBOARDING_COLORS } from "../constants/onboarding";
import { FoodCameraButton } from "../components/FoodCameraButton";
import { ScreenContainer } from "../components/ScreenContainer";
import { useFoodRecognition } from "../hooks/useFoodRecognition";
import type { FoodAnalysisResult } from "../services/foodRecognitionService";
import { useAuthStore } from "../store/authStore";

const UI = {
  bg: "#080c12",
  card: "#0f1620",
  border: "rgba(255,255,255,0.07)",
  text: "#F4F4F5",
  muted: "#9CA3AF",
  blue: "#5B9FFF",
  green: "#4ADE80",
  red: "#F87171",
  proteinBar: "#5B9FFF",
  carbsBar: "#4ADE80",
  fatBar: "#FBBF24",
  chipBg: "#2A2A2A",
};

const SECTION_ACCENTS = {
  calories: "#fb7185",
  macros: "#60a5fa",
  water: "#22d3ee",
  addFood: "#34d399",
  quickAdd: "#fbbf24",
  meals: "#a78bfa",
} as const;

const MEAL_ORDER: MealType[] = ["Breakfast", "Lunch", "Dinner", "Snack", "Pre_Workout", "Post_Workout"];

const mealHeading = (t: MealType) =>
  t === "Pre_Workout" ? "Pre-workout" : t === "Post_Workout" ? "Post-workout" : t;

const mealRowLabel = (t: MealType) => {
  if (t === "Snack") return "Snacks";
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
  label,
  consumed,
  target,
  color,
  anim,
  unit = "g",
}: {
  label: string;
  consumed: number;
  target: number;
  color: string;
  anim: Animated.Value;
  unit?: string;
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
    <View style={{ marginBottom: 12 }}>
      <View style={styles.macroRowTop}>
        <Text style={styles.macroLabel}>{label}</Text>
        <Text style={styles.macroNums}>
          {fmt1(consumed)}/{fmt1(target)}
          {unit}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { width: widthInterpolated, backgroundColor: color }]} />
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
      return "Request timed out. Start the API server (port 8000) and try again.";
    }
    if (!err.response) {
      const msg = String(err.message || "");
      if (/Failed to fetch|Network Error|ERR_NETWORK|Load failed/i.test(msg)) {
        const base = resolveApiBaseUrl();
        return `Network error (${msg || "no response"}).\n\nResolved API base: ${base}\n\n1) Start API: cd server && uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload\n2) In a browser open ${base}/health — should show {"status":"ok"}\n3) Expo web on Wi‑Fi: default .env uses 127.0.0.1; the app now maps that to your PC’s LAN IP when you open http://192.168.x.x:8081. If it still fails, set EXPO_PUBLIC_API_URL=http://YOUR_PC_IP:8000 and restart Expo.\n4) Android emulator: use http://10.0.2.2:8000 in .env instead of 127.0.0.1.`;
      }
      return "Cannot reach the API. Check EXPO_PUBLIC_API_URL and that the FastAPI server is running.";
    }
    if (err.response.status === 404) {
      const u = String(err.config?.url ?? "");
      return `Not Found (${u || "unknown URL"}). Port 8000 is almost always an old API process: run "lsof -ti :8000 | xargs kill -9", then from server/: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload. Open /docs and confirm POST /api/calories/daily-log exists.`;
    }
    const data = err.response.data as { detail?: unknown };
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0] && typeof (d[0] as { msg?: string }).msg === "string") {
      return (d[0] as { msg: string }).msg;
    }
    return err.response.status ? `Server error (${err.response.status})` : err.message;
  }
  return "Could not load calorie log.";
}

export const CalorieLog = () => {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [day, setDay] = useState<CalorieDayPayload | null>(null);
  const [logDate] = useState(() => todayLocal());
  const [targets, setTargets] = useState<any>(null);

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

  const refresh = useCallback(async () => {
    const d = await ensureDailyCalorieLog(logDate);
    setDay(d);
    setLoadError(null);
  }, [logDate]);

  const loadTargets = useCallback(async () => {
    if (!token) {
      setTargets(null);
      return;
    }
    try {
      const { targets: t } = await loadOnboardingWithFallback(token);
      setTargets(t);
    } catch {
      setTargets(null);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadTargets();
      setMealType(mealTypeFromLocalTime());
    }, [loadTargets]),
  );

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

  const waterTotal = day?.water.total_water_l ?? 0;
  const waterTarget = day?.log.target_water_l ?? 2.5;
  const glassCount = Math.max(1, Math.round(waterTarget / 0.25));
  const waterPct = waterTarget > 0 ? Math.min(100, (waterTotal / waterTarget) * 100) : 0;

  const setWaterLevel = async (liters: number) => {
    try {
      setSaving(true);
      const d = await patchCalorieWater(Math.max(0, liters), logDate);
      setDay(d);
    } catch {
      Alert.alert("Error", "Could not update water.");
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
        const items = await searchFoodCatalog(q, 20);
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
  }, [foodQuery]);

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
      const detail = await lookupFoodNutrition({ food_id: item.food_id, quantity_g: quantity });
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
      const msg = axios.isAxiosError(e) ? String((e.response?.data as { detail?: string })?.detail || e.message) : "Food not found";
      Alert.alert("Food lookup", msg);
    } finally {
      setFoodSearchLoading(false);
    }
  };

  const submitMeal = async () => {
    if (!foodName.trim()) {
      Alert.alert("Missing", "Enter a food name.");
      return;
    }
    if (qtyN <= 0) {
      Alert.alert("Invalid", "Quantity must be greater than 0.");
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
        if (aiSaved?.day) setDay(aiSaved.day);
        else await refresh();
      } else {
        const safeQty = round2(clamp(sanitizeFinite(qtyN), 0.01, 999999.99));
        const d = await postCalorieMeal({
          log_date: logDate,
          meal_type: mealType,
          source_type: "database",
          food_name: foodName.trim(),
          quantity_g: safeQty,
          calories_per_100g: round2(clamp(sanitizeFinite(cal100N), 0, 99999.99)),
          protein_per_100g: round2(clamp(sanitizeFinite(p100N), 0, 9999.99)),
          carbs_per_100g: round2(clamp(sanitizeFinite(c100N), 0, 9999.99)),
          fat_per_100g: round2(clamp(sanitizeFinite(f100N), 0, 9999.99)),
          fiber_per_100g: round2(clamp(sanitizeFinite(fi100N), 0, 9999.99)),
        });
        setDay(d);
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
        ? String((e.response?.data as { detail?: unknown })?.detail ?? e.message ?? "Could not save meal.")
        : "Could not save meal.";
      Alert.alert("Error", message);
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
    Alert.alert("Food Scanner", message);
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
      showToast(foodRecognitionError || "Could not analyze image. Check internet/API key and try again.");
      return;
    }
    applyAnalysisToForm(result);
    showToast(`Detected: ${result.foodName}. Please verify the values.`);
  };

  useEffect(() => {
    if (!foodRecognitionError) return;
    Alert.alert("Food recognition", foodRecognitionError, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Retry",
        onPress: () => {
          showToast("Tap the camera button to try again.");
        },
      },
    ]);
  }, [foodRecognitionError]);

  const onDeleteMeal = async (mealId: number, sourceType?: "database" | "camera_ai") => {
    try {
      setSaving(true);
      const d = sourceType === "camera_ai" ? await deleteAIFoodMeal(Math.abs(mealId)) : await deleteCalorieMeal(mealId);
      // Reflect server deletion immediately.
      setDay(d);
      // Re-sync from server to keep meal list + nutrition totals fully authoritative.
      await refresh();
    } catch {
      Alert.alert("Error", "Could not delete meal.");
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
      Alert.alert("Invalid", "Quantity must be greater than 0.");
      return;
    }
    try {
      setSaving(true);
      const d = await patchCalorieMealQty(editMealId, nextQty);
      setDay(d);
      setEditMealId(null);
      setEditQty("");
    } catch {
      Alert.alert("Error", "Could not update meal quantity.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ScreenContainer>
        <View style={styles.center}>
          <ActivityIndicator color={UI.blue} size="large" />
          <Text style={{ color: UI.muted, marginTop: 12 }}>Loading log…</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (loadError || !day) {
    return (
      <ScreenContainer>
        <View style={[styles.pageBg, { backgroundColor: UI.bg, minHeight: 280 }]}>
          <Text style={styles.pageTitle}>Calorie Log</Text>
          <Text style={styles.errorText}>{loadError ?? "Something went wrong."}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              invalidateCaloriesRoutePrefix();
              setReloadToken((n) => n + 1);
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const { log, macro_split_label } = day;
  const fiberConsumed = Number((log as Record<string, unknown>).total_fiber_g ?? 0);
  const fiberTarget = Number((log as Record<string, unknown>).target_fiber_g ?? targets?.macros?.fiber_g ?? 0);
  const remaining = log.calories_remaining;
  const remainingColor = remaining > 0 ? UI.green : remaining < 0 ? UI.red : UI.muted;

  return (
    <ScreenContainer>
      <View style={[styles.pageBg, { backgroundColor: UI.bg }]}>
        <Text style={styles.pageTitle}>Calorie Log</Text>
        <Text style={styles.pageSub}>Daily nutrition & hydration</Text>
        <View style={styles.section}>
          <LinearGradient colors={[SECTION_ACCENTS.calories, `${SECTION_ACCENTS.calories}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionAccent} />
          <View style={styles.sectionHead}>
            <Text style={styles.sectionHeadTag}>CALORIES CONSUMED PER DAY</Text>
            <Text style={styles.sectionMeta}>
              {fmt1(log.total_calories)}/{fmt1(log.target_calories)} kcal
            </Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.min(100, log.target_calories > 0 ? (log.total_calories / log.target_calories) * 100 : 0)}%`,
                  backgroundColor: UI.blue,
                },
              ]}
            />
          </View>
          <Text style={styles.calorieConsumedHint}>
            Remaining: <Text style={{ color: remainingColor }}>{fmt1(remaining)} kcal</Text>
          </Text>
        </View>

        <View style={styles.section}>
          <LinearGradient colors={[SECTION_ACCENTS.macros, `${SECTION_ACCENTS.macros}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionAccent} />
          <View style={styles.sectionHead}>
            <Text style={styles.sectionHeadTag}>MACROS</Text>
            <Text style={styles.sectionMeta}>{macro_split_label}</Text>
          </View>
          <MacroBar label="Protein" consumed={log.total_protein_g} target={log.target_protein_g} color={UI.proteinBar} anim={animP} />
          <MacroBar label="Carbs" consumed={log.total_carbs_g} target={log.target_carbs_g} color={UI.carbsBar} anim={animC} />
          <MacroBar label="Fat" consumed={log.total_fat_g} target={log.target_fat_g} color={UI.fatBar} anim={animF} />
          <MacroBar label="Water" consumed={waterTotal} target={waterTarget} color={UI.blue} anim={animW} unit="L" />
          <MacroBar label="Fibre" consumed={fiberConsumed} target={fiberTarget} color="#A78BFA" anim={animFi} />
        </View>

        <View style={styles.section}>
          <LinearGradient colors={[SECTION_ACCENTS.water, `${SECTION_ACCENTS.water}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionAccent} />
          <View style={styles.sectionHead}>
            <Text style={styles.sectionHeadTag}>WATER INTAKE</Text>
            <Text style={styles.sectionMeta}>
              {fmt1(waterTotal)}/{fmt1(waterTarget)}L
            </Text>
          </View>
          <View style={styles.waterBtns}>
            <Pressable style={styles.waterSq} onPress={() => bumpWater(-0.25)} disabled={saving}>
              <Text style={styles.waterSqText}>−</Text>
            </Pressable>
            <Pressable style={styles.waterSq} onPress={() => bumpWater(0.25)} disabled={saving}>
              <Text style={styles.waterSqText}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.waterHint}>Each glass = 250ml · tap a glass to fill to that level</Text>
          <View style={styles.glassRow}>
            {Array.from({ length: glassCount }).map((_, i) => {
              const level = (i + 1) * 0.25;
              const filled = waterTotal >= level - 1e-6;
              return (
                <Pressable
                  key={i}
                  onPress={() => setWaterLevel(level)}
                  style={[styles.glass, filled ? styles.glassFilled : styles.glassEmpty]}
                />
              );
            })}
          </View>
          <View style={styles.waterBarTrack}>
            <View style={[styles.waterBarFill, { width: `${waterPct}%` }]} />
          </View>
          <View style={styles.waterBarLabels}>
            <Text style={styles.waterMini}>0L</Text>
            <Text style={styles.waterMini}>{fmt1(waterPct)}%</Text>
            <Text style={styles.waterMini}>{fmt1(waterTarget)}L</Text>
          </View>
        </View>

        <View style={styles.section}>
          <LinearGradient colors={[SECTION_ACCENTS.addFood, `${SECTION_ACCENTS.addFood}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionAccent} />
          <View style={styles.addFoodHeadingRow}>
            <Text style={styles.sectionTag}>ADD FOOD</Text>
            <FoodCameraButton disabled={saving || isAnalyzing} onImageSelected={runFoodRecognition} />
          </View>
          <View style={styles.searchWrap}>
            <TextInput
              placeholder="Search food (type at least 2 letters)"
              placeholderTextColor={UI.muted}
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
              style={styles.inputFull}
            />
            {foodSearchLoading ? <Text style={styles.foodSearchHint}>Searching...</Text> : null}
            {!foodSearchLoading && selectedFoodId ? <Text style={styles.foodSearchHint}>Selected from database</Text> : null}
            {foodDropdownOpen ? (
              <View style={styles.foodDropdown}>
                {foodResults.length === 0 ? (
                  <Text style={styles.foodEmpty}>No foods found</Text>
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
          <Pressable style={styles.mealSelect} onPress={() => setMealPickerOpen(true)}>
            <Text style={styles.mealSelectText}>{mealHeading(mealType)}</Text>
            <Text style={styles.mealSelectChev}>▾</Text>
          </Pressable>

          <View style={styles.inputGrid}>
            <RightPlaceholderInput
              placeholder={inputMode === "camera" ? "Qty" : "Qty (g)"}
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
              style={styles.inputHalf}
              pinPlaceholderWithValue
            />
            <RightPlaceholderInput
              placeholder={inputMode === "camera" ? "Cal" : "Cal/100g"}
              keyboardType="decimal-pad"
              value={cal100}
              onChangeText={(v) => {
                setCal100(sanitizeNumericInput(v));
                setAiEstimated(false);
              }}
              style={styles.inputHalf}
              pinPlaceholderWithValue
            />
            <RightPlaceholderInput
              placeholder={inputMode === "camera" ? "Protein" : "Protein/100g"}
              keyboardType="decimal-pad"
              value={p100}
              onChangeText={(v) => {
                setP100(sanitizeNumericInput(v));
                setAiEstimated(false);
              }}
              style={styles.inputHalf}
              pinPlaceholderWithValue
            />
            <RightPlaceholderInput
              placeholder={inputMode === "camera" ? "Carbs" : "Carbs/100g"}
              keyboardType="decimal-pad"
              value={c100}
              onChangeText={(v) => {
                setC100(sanitizeNumericInput(v));
                setAiEstimated(false);
              }}
              style={styles.inputHalf}
              pinPlaceholderWithValue
            />
            <RightPlaceholderInput
              placeholder={inputMode === "camera" ? "Fat" : "Fat/100g"}
              keyboardType="decimal-pad"
              value={f100}
              onChangeText={(v) => {
                setF100(sanitizeNumericInput(v));
                setAiEstimated(false);
              }}
              style={styles.inputHalf}
              pinPlaceholderWithValue
            />
            <RightPlaceholderInput
              placeholder={inputMode === "camera" ? "Fibre" : "Fibre/100g"}
              keyboardType="decimal-pad"
              value={fi100}
              onChangeText={(v) => {
                setFi100(sanitizeNumericInput(v));
                setAiEstimated(false);
              }}
              style={styles.inputHalf}
              pinPlaceholderWithValue
            />
            <Pressable style={[styles.addBtn, saving && { opacity: 0.6 }]} onPress={submitMeal} disabled={saving}>
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
          {foodRecognitionError ? <Text style={styles.foodRecognitionError}>{foodRecognitionError}</Text> : null}
          {aiEstimated ? <Text style={styles.aiCaption}>✨ AI estimated — verify before saving</Text> : null}

          <View style={styles.previewRow}>
            <Text style={styles.previewText}>
              Preview: <Text style={styles.previewStrong}>{fmt1(preview.kcal)} kcal</Text> P{" "}
              <Text style={styles.previewStrong}>{fmt1(preview.p)}g</Text> C{" "}
              <Text style={styles.previewStrong}>{fmt1(preview.c)}g</Text> F{" "}
              <Text style={styles.previewStrong}>{fmt1(preview.f)}g</Text>
              {" "}Fi <Text style={styles.previewStrong}>{fmt1(preview.fi)}g</Text>
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <LinearGradient colors={[SECTION_ACCENTS.quickAdd, `${SECTION_ACCENTS.quickAdd}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionAccent} />
          <Text style={styles.sectionTag}>QUICK ADD</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {QUICK_FOODS.map((q) => (
              <Pressable key={q.label} style={styles.chip} onPress={() => applyChip(q)}>
                <Text style={styles.chipText}>{q.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <LinearGradient colors={[SECTION_ACCENTS.meals, `${SECTION_ACCENTS.meals}99`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionAccent} />
          <Text style={styles.sectionTag}>TODAY'S MEALS</Text>
          {day.meals.length === 0 ? (
            <Text style={styles.empty}>No food logged yet — add your first meal above.</Text>
          ) : (
            <>
              {day.meals.map((m) => (
                <View key={m.meal_id} style={styles.mealRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mealName}>
                      {m.food_name} - {mealRowLabel(m.meal_type)}
                    </Text>
                    <Text style={styles.mealMeta}>
                      {m.source_type === "camera_ai" ? `${fmt1(m.quantity_g)} Qty` : `${fmt1(m.quantity_g)}g`} · P {fmt1(m.total_protein_g)} · C {fmt1(m.total_carbs_g)} · F {fmt1(m.total_fat_g)} ·{" "}
                      Fi {fmt1((m as Record<string, number>).total_fiber_g || 0)} ·{" "}
                      {fmt1(m.total_calories)} kcal
                    </Text>
                  </View>
                  {m.source_type !== "camera_ai" ? (
                    <Pressable
                      style={[styles.editBtn, saving && { opacity: 0.6 }]}
                      onPress={() => openEditMeal(m.meal_id, m.quantity_g)}
                      hitSlop={8}
                      disabled={saving}
                    >
                      <Text style={styles.editBtnText}>Edit</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.delBtn, saving && { opacity: 0.6 }]}
                    onPress={() => void onDeleteMeal(m.meal_id, m.source_type)}
                    hitSlop={8}
                    disabled={saving}
                  >
                    <Text style={styles.delBtnText}>✕</Text>
                  </Pressable>
                </View>
              ))}
              <View style={styles.grandTotal}>
                <Text style={styles.grandLabel}>Day total</Text>
                <Text style={styles.grandValue}>
                  {fmt1(log.total_calories)} kcal · P {fmt1(log.total_protein_g)} · C {fmt1(log.total_carbs_g)} · F {fmt1(log.total_fat_g)} · Fi {fmt1((log as Record<string, number>).total_fiber_g || 0)}
                </Text>
              </View>
            </>
          )}
        </View>

      </View>

      <Modal visible={mealPickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMealPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Meal type</Text>
            {MEAL_ORDER.map((t) => (
              <Pressable
                key={t}
                style={styles.modalRow}
                onPress={() => {
                  setMealType(t);
                  setMealPickerOpen(false);
                }}
              >
                <Text style={[styles.modalRowText, mealType === t && { color: UI.blue }]}>{mealHeading(t)}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={editMealId !== null} transparent animationType="fade" onRequestClose={() => setEditMealId(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditMealId(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Edit meal quantity</Text>
            <TextInput
              placeholder="Qty (g)"
              placeholderTextColor={UI.muted}
              keyboardType="decimal-pad"
              value={editQty}
              onChangeText={(v) => setEditQty(sanitizeNumericInput(v))}
              style={styles.inputFull}
            />
            <View style={styles.editActions}>
              <Pressable style={styles.editCancelBtn} onPress={() => setEditMealId(null)}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.editSaveBtn, saving && { opacity: 0.6 }]} onPress={submitEditMealQty} disabled={saving}>
                <Text style={styles.editSaveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={isAnalyzing} transparent animationType="fade">
        <View style={styles.analyzingOverlay}>
          <View style={styles.analyzingCard}>
            <ActivityIndicator size="large" color={UI.blue} />
            <Text style={styles.analyzingText}>Analyzing your food...</Text>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  pageBg: { marginHorizontal: -16, paddingHorizontal: 16, paddingBottom: 32, marginTop: -8 },
  center: { flex: 1, minHeight: 200, alignItems: "center", justifyContent: "center" },
  errorText: { color: UI.muted, fontSize: 15, lineHeight: 22, marginTop: 12, marginBottom: 20 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: UI.blue,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryBtnText: { color: "#0B1220", fontWeight: "800", fontSize: 15 },
  pageTitle: { color: UI.text, fontSize: 26, fontWeight: "800", marginBottom: 4 },
  pageSub: { color: UI.muted, fontSize: 14, marginBottom: 18 },
  section: {
    backgroundColor: UI.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: UI.border,
    overflow: "hidden",
  },
  sectionAccent: { height: 3, width: "100%", borderRadius: 2, marginBottom: 12 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTag: { color: UI.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 },
  addFoodHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sectionHeadTag: { color: UI.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  sectionMeta: { color: UI.muted, fontSize: 11, flex: 1, textAlign: "right", marginLeft: 8 },
  macroRowTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  macroLabel: { color: UI.text, fontWeight: "600", fontSize: 14 },
  macroNums: { color: UI.muted, fontSize: 13 },
  barTrack: { height: 10, borderRadius: 6, backgroundColor: "#2C2C2C", overflow: "hidden" },
  barFill: { height: 10, borderRadius: 6 },
  calorieConsumedHint: { color: UI.muted, fontSize: 12, marginTop: 8 },
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
    color: UI.text,
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
    color: UI.muted,
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
    paddingRight: 12,
    paddingLeft: 56,
    maxWidth: "100%",
  },
  rpPhText: {
    color: UI.muted,
    fontSize: 15,
    fontWeight: "500",
    textAlign: "right",
    width: "100%",
  },
  inputFull: {
    backgroundColor: "#2A2A2A",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    color: UI.text,
    borderWidth: 1,
    borderColor: UI.border,
  },
  searchWrap: {
    position: "relative",
    marginBottom: 10,
    zIndex: 20,
  },
  foodSearchHint: {
    color: UI.muted,
    fontSize: 11,
    marginTop: 4,
    marginLeft: 2,
  },
  foodDropdown: {
    marginTop: 6,
    backgroundColor: "#222",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: UI.border,
    maxHeight: 220,
    overflow: "hidden",
  },
  foodDropdownScroll: { maxHeight: 220 },
  foodOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: UI.border,
  },
  foodOptionLast: { borderBottomWidth: 0 },
  foodOptionName: { color: UI.text, fontWeight: "700", fontSize: 14 },
  foodOptionMeta: { color: UI.muted, marginTop: 2, fontSize: 12 },
  foodEmpty: { color: UI.muted, fontSize: 13, padding: 12 },
  mealSelect: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#2A2A2A",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: UI.border,
  },
  mealSelectText: { color: UI.text, fontWeight: "600", fontSize: 15 },
  mealSelectChev: { color: UI.muted, fontSize: 14 },
  inputGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  inputHalf: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: "#2A2A2A",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: UI.text,
    borderWidth: 1,
    borderColor: UI.border,
  },
  addBtn: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: UI.blue,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  addBtnText: { color: "#0B1220", fontWeight: "800", fontSize: 15 },
  foodRecognitionError: { marginTop: 10, color: "#F87171", fontSize: 12, lineHeight: 18 },
  previewRow: {
    marginTop: 12,
    backgroundColor: "#252525",
    borderRadius: 8,
    padding: 10,
  },
  previewText: { color: UI.muted, fontSize: 13 },
  previewStrong: { color: UI.text, fontWeight: "700" },
  aiCaption: { marginTop: 10, color: "#fbbf24", fontSize: 12, fontWeight: "700" },
  chipRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  chip: {
    backgroundColor: UI.chipBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI.border,
  },
  chipText: { color: UI.text, fontSize: 13, fontWeight: "600" },
  empty: { color: UI.muted, fontSize: 14, lineHeight: 20 },
  mealRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: UI.border,
    gap: 8,
  },
  mealName: { color: UI.text, fontWeight: "700", fontSize: 14 },
  mealMeta: { color: UI.muted, fontSize: 12, marginTop: 2 },
  editBtn: {
    height: 32,
    minWidth: 54,
    borderRadius: 8,
    backgroundColor: "#2A2A2A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: UI.border,
    paddingHorizontal: 10,
  },
  editBtnText: { color: UI.blue, fontSize: 12, fontWeight: "700" },
  delBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#2A2A2A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: UI.border,
  },
  delBtnText: { color: UI.muted, fontSize: 14, fontWeight: "700" },
  grandTotal: { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: UI.border },
  grandLabel: { color: UI.muted, fontSize: 12, marginBottom: 4 },
  grandValue: { color: UI.text, fontWeight: "800", fontSize: 15 },
  waterBtns: { flexDirection: "row", gap: 10, marginBottom: 10 },
  waterSq: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#2A2A2A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: UI.border,
  },
  waterSqText: { color: UI.text, fontSize: 22, fontWeight: "700" },
  waterHint: { color: UI.muted, fontSize: 12, marginBottom: 12 },
  glassRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  glass: { width: 28, height: 36, borderRadius: 6, borderWidth: 1 },
  glassEmpty: { backgroundColor: "#2C2C2C", borderColor: UI.border },
  glassFilled: { backgroundColor: UI.blue, borderColor: UI.blue },
  waterBarTrack: { height: 6, borderRadius: 4, backgroundColor: "#2C2C2C", overflow: "hidden" },
  waterBarFill: { height: 6, backgroundColor: UI.blue, borderRadius: 4 },
  waterBarLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  waterMini: { color: UI.muted, fontSize: 11 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: { backgroundColor: UI.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: UI.border },
  modalTitle: { color: UI.text, fontWeight: "800", fontSize: 16, marginBottom: 8 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  editCancelBtn: {
    backgroundColor: "#2A2A2A",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: UI.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editCancelText: { color: UI.muted, fontSize: 13, fontWeight: "700" },
  editSaveBtn: {
    backgroundColor: UI.blue,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editSaveText: { color: "#0B1220", fontSize: 13, fontWeight: "800" },
  modalRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: UI.border },
  modalRowText: { color: UI.text, fontSize: 16 },
  analyzingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.52)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  analyzingCard: {
    backgroundColor: UI.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: UI.border,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: "center",
    minWidth: 240,
  },
  analyzingText: {
    color: UI.text,
    marginTop: 12,
    fontSize: 15,
    fontWeight: "700",
  },
});
