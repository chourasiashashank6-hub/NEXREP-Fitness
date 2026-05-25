import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Constants from "expo-constants";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { apiClient, resolveApiBaseUrl } from "../api/client";
import { getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { submitFeedback } from "../api/feedback";
import { fetchOnboardingMe, upsertOnboardingMe } from "../api/onboarding";
import { getProfile, updateProfile } from "../api/user";
import { getWorkoutHistory } from "../api/workout";
import DevSubscriptionToggle from "../components/DevSubscriptionToggle";
import PaymentHistorySection from "../components/PaymentHistorySection";
import PlanTimelineSection from "../components/PlanTimelineSection";
import SubscriptionCard from "../components/SubscriptionCard";
import { HeroHeader } from "../components/HeroHeader";
import { ScreenContainer } from "../components/ScreenContainer";
import { signOutSession } from "../services/authService";
import { useAuthStore } from "../store/authStore";
import { useSubscriptionStore } from "../store/subscriptionStore";
import { useAppTheme } from "../theme";
import { calculateNutritionTargets } from "../engine/calculator";

type GoalTag = "Fat Loss" | "Muscle Gain" | "Strength";

const goalColors: Record<GoalTag, { primary: string; bg: string; text: string }> = {
  "Fat Loss": { primary: "#E24B4A", bg: "#FCEBEB", text: "#791F1F" },
  "Muscle Gain": { primary: "#534AB7", bg: "#EEEDFE", text: "#26215C" },
  Strength: { primary: "#D85A30", bg: "#FAECE7", text: "#4A1B0C" },
};

const goalPaceOptions = [0.25, 0.5, 0.75, 1.0];
const difficultyOptions = ["Beginner", "Intermediate", "Advanced"];
const toGoalTag = (v: unknown): GoalTag => (v === "Muscle Gain" || v === "Strength" ? (v as GoalTag) : "Fat Loss");
const monthYear = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const getInitials = (first: string, last: string) => `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "U";
const numFmt = (n: number) => Math.round(n).toLocaleString();
const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY_WINDOW = 30;
const MAX_SELECTABLE_RANGE_DAYS = 30;
const CALENDAR_NAV_YEARS = 10;
const HOME_CARD_BG = "#0f1620";
const HOME_CARD_BORDER = "rgba(255,255,255,0.07)";

type DailyExerciseHistory = {
  date: string;
  caloriesBurned: number;
  workouts: Array<{
    id: number;
    bodyPart: string;
    exerciseName: string;
    sets: number;
    reps: number;
    duration: number;
    caloriesBurned: number;
  }>;
};

type DailyCalorieHistory = {
  date: string;
  protein: number;
  fat: number;
  fiber: number;
  water: number;
  carbs: number;
};

const toIsoLocalDate = (value: Date) => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const listPastDates = (count: number) => {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    dates.push(toIsoLocalDate(d));
  }
  return dates;
};

const parseBodyPartFromNotes = (notes?: string | null): string => {
  if (!notes) return "";
  const match = String(notes).match(/body_part=([^;]+)/i);
  return match?.[1]?.trim() || "";
};

const parseIsoDate = (value: string) => new Date(`${value}T00:00:00`);
const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};
const dateRangeDaysInclusive = (fromIso: string, toIso: string) => {
  const ms = parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
};
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const maxDate = (a: Date, b: Date) => (a > b ? a : b);
const minDate = (a: Date, b: Date) => (a < b ? a : b);

type LatestWeightLog = {
  weight_kg: number;
  log_date: string | null;
  days_since_log: number | null;
  has_logs: boolean;
};

type OnboardingGoalType = "fat_loss" | "muscle_gain" | "strength" | "maintain" | "recomp";

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

export const ProfileScreen = () => {
  const { colors } = useAppTheme();
  const navigation = useNavigation<any>();
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVersionTap = () => {
    tapCount.current += 1;

    if (tapTimer.current) clearTimeout(tapTimer.current);

    if (tapCount.current >= 3) {
      tapCount.current = 0;
      navigation.navigate("AdminStack");
      return;
    }

    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, 800);
  };

  const token = useAuthStore((s) => s.token);
  const plan_id = useAuthStore((s) => s.plan_id) ?? "free";
  const setPlanId = useAuthStore((s) => s.setPlanId);
  const setNeedsOnboarding = useAuthStore((s) => s.setNeedsOnboarding);
  const setReturnToProfileAfterOnboarding = useAuthStore((s) => s.setReturnToProfileAfterOnboarding);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showExerciseHistory, setShowExerciseHistory] = useState(false);
  const [showCalorieHistory, setShowCalorieHistory] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSubject, setFeedbackSubject] = useState("");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [exerciseHistory15d, setExerciseHistory15d] = useState<DailyExerciseHistory[]>([]);
  const [calorieHistory15d, setCalorieHistory15d] = useState<DailyCalorieHistory[]>([]);
  const [exerciseFromDate, setExerciseFromDate] = useState("");
  const [exerciseToDate, setExerciseToDate] = useState("");
  const [calorieFromDate, setCalorieFromDate] = useState("");
  const [calorieToDate, setCalorieToDate] = useState("");
  const [activeDatePicker, setActiveDatePicker] = useState<{ overlay: "exercise" | "calorie"; field: "from" | "to" } | null>(null);
  const [calendarCursor, setCalendarCursor] = useState(new Date());
  const [registrationDateIso, setRegistrationDateIso] = useState<string>("");
  const [userId, setUserId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [memberSince, setMemberSince] = useState("");
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [profileWeightKg, setProfileWeightKg] = useState(70);
  const [targetWeightKg, setTargetWeightKg] = useState(65);
  const [startWeightKg, setStartWeightKg] = useState(70);
  const [goalType, setGoalType] = useState<OnboardingGoalType>("maintain");
  const [goalTag, setGoalTag] = useState<GoalTag>("Fat Loss");
  const [latestWeightLog, setLatestWeightLog] = useState<LatestWeightLog | null>(null);
  const [loadingWeight, setLoadingWeight] = useState(true);
  const [showWeighInModal, setShowWeighInModal] = useState(false);
  const [weighInValue, setWeighInValue] = useState("");
  const [isLoggingWeight, setIsLoggingWeight] = useState(false);
  const [paceKgPerWeek, setPaceKgPerWeek] = useState(0.5);
  const [age, setAge] = useState(25);
  const [stats, setStats] = useState({
    totalWorkoutsDone: 0,
    totalKcalBurned: 0,
    currentDayStreak: 0,
    avgSessionsPerWeek: 0,
  });
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const fetchPayments = useSubscriptionStore((s) => s.fetchPayments);
  const subscriptionTier = useSubscriptionStore((s) => s.subscription?.tier ?? "FREE");

  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    currentWeightKg: "0",
    targetWeightKg: "0",
    goalTag: "Fat Loss" as GoalTag,
    paceKgPerWeek: "0.5",
    difficulty: "Intermediate",
  });

  const load = useCallback(async () => {
    try {
      const [profile, onboardingRes, burnRes, historyRes] = await Promise.all([
        getProfile(),
        fetchOnboardingMe().catch(() => null),
        apiClient.get<{ totalCaloriesBurned: number; sessionCount: number }>("/workout/total-burn").catch(() => ({ data: { totalCaloriesBurned: 0, sessionCount: 0 } })),
        apiClient.get<{ items: Array<{ date: string }> }>("/workout/history", { params: { hours: 24 * 30 } }).catch(() => ({ data: { items: [] } })),
      ]);
      const dates15 = listPastDates(DAY_WINDOW);
      const [workoutHistory15d, calorieLogs15d] = await Promise.all([
        getWorkoutHistory(24 * DAY_WINDOW).catch(() => ({ items: [] })),
        Promise.all(dates15.map((date) => getDailyCalorieLog(date).catch(() => null))),
      ]);

      const fullName = String(profile.name || "").trim();
      const [f = "", ...rest] = fullName.split(" ");
      const l = rest.join(" ");
      const ob = onboardingRes?.onboarding;
      const targetKg = Number(ob?.goal?.target_weight_kg || ob?.goal?.target_weight_lb / 2.20462 || profile.weight || 0);
      const startKg = Number(ob?.personal?.start_weight_kg || ob?.personal?.weight_kg || profile.weight || 0);
      const pace = ob?.goal?.pace === "slow" ? 0.25 : ob?.goal?.pace === "aggressive" ? 0.75 : 0.5;
      const registrationIso = typeof profile.createdAt === "string" && profile.createdAt.length >= 10 ? profile.createdAt.slice(0, 10) : "";

      const workoutDates = (historyRes.data.items || []).map((i) => new Date(i.date).toISOString().slice(0, 10));
      const uniqDates = Array.from(new Set(workoutDates)).sort((a, b) => +new Date(b) - +new Date(a));
      let streak = 0;
      for (let i = 0; i < uniqDates.length; i++) {
        const expected = new Date();
        expected.setDate(expected.getDate() - i);
        if (uniqDates[i] === expected.toISOString().slice(0, 10)) streak += 1;
        else break;
      }

      const sessionCount = Number(burnRes.data.sessionCount || 0);
      const weeksActive = Math.max(1, 8);
      const avgSessions = round1(sessionCount / weeksActive);

      setUserId(String(profile.id || ""));
      setFirstName(f || "User");
      setLastName(l || "");
      setUserEmail(String(profile.email || ""));
      setPlanId(String(profile.plan_id || "free"));
      setDifficulty(profile.difficulty || "Intermediate");
      setProfileWeightKg(Number(profile.weight || 0));
      setTargetWeightKg(round1(targetKg));
      setStartWeightKg(round1(startKg));
      const rawGoalType = String(ob?.goal?.type || "").toLowerCase();
      const mappedGoalType: OnboardingGoalType =
        rawGoalType === "fat_loss" || rawGoalType === "muscle_gain" || rawGoalType === "strength" || rawGoalType === "recomp"
          ? (rawGoalType as OnboardingGoalType)
          : "maintain";
      setGoalType(mappedGoalType);
      setGoalTag(toGoalTag(profile.goalTag));
      setPaceKgPerWeek(pace);
      setAge(Number(profile.age || 25));
      setMemberSince(monthYear(new Date().toISOString()));
      setStats({
        totalWorkoutsDone: sessionCount,
        totalKcalBurned: Number(burnRes.data.totalCaloriesBurned || 0),
        currentDayStreak: streak,
        avgSessionsPerWeek: avgSessions,
      });
      const workoutsByDate = new Map<
        string,
        {
          caloriesBurned: number;
          workouts: Array<{
            id: number;
            bodyPart: string;
            exerciseName: string;
            sets: number;
            reps: number;
            duration: number;
            caloriesBurned: number;
          }>;
        }
      >();
      (workoutHistory15d.items || []).forEach((item) => {
        const rawDate = String(item?.date || "");
        const date = rawDate.slice(0, 10);
        if (!dates15.includes(date)) return;
        const existing = workoutsByDate.get(date) || { caloriesBurned: 0, workouts: [] };
        const calories = Number(item?.caloriesBurned) || 0;
        existing.caloriesBurned += calories;
        const explicitBodyPart = typeof item?.bodyPart === "string" ? item.bodyPart.trim() : "";
        const bodyPartFromNotes = parseBodyPartFromNotes(item?.notes);
        const muscles = Array.isArray(item?.musclesTrained) ? item.musclesTrained.filter((m) => typeof m === "string" && m.trim()) : [];
        const bodyPart = explicitBodyPart || bodyPartFromNotes || (muscles.length ? muscles.join("/") : "Workout");
        existing.workouts.push({
          id: Number(item?.id || 0),
          bodyPart,
          exerciseName: String(item?.exerciseName || item?.type || "Workout"),
          sets: Number(item?.sets || 0),
          reps: Number(item?.reps || 0),
          duration: Number(item?.duration || 0),
          caloriesBurned: round1(calories),
        });
        workoutsByDate.set(date, existing);
      });
      const calorieByDate = new Map<
        string,
        { protein: number; fat: number; fiber: number; water: number; carbs: number; totalCalories: number }
      >();
      dates15.forEach((date, idx) => {
        const day = calorieLogs15d[idx];
        const log = day?.log;
        const water = day?.water;
        calorieByDate.set(date, {
          protein: round1(Number(log?.total_protein_g || 0)),
          fat: round1(Number(log?.total_fat_g || 0)),
          fiber: round1(Number(log?.total_fiber_g || 0)),
          water: round1(Number(water?.total_water_l || 0)),
          carbs: round1(Number(log?.total_carbs_g || 0)),
          totalCalories: round1(Number(log?.total_calories || 0)),
        });
      });

      const nextExerciseHistory = dates15.map((date) => ({
        date,
        caloriesBurned: round1(workoutsByDate.get(date)?.caloriesBurned || 0),
        workouts: workoutsByDate.get(date)?.workouts || [],
      }));
      setExerciseHistory15d(nextExerciseHistory);

      const nextCalorieHistory = dates15.map((date) => {
        const nutrition = calorieByDate.get(date);
        return {
          date,
          protein: nutrition?.protein || 0,
          fat: nutrition?.fat || 0,
          fiber: nutrition?.fiber || 0,
          water: nutrition?.water || 0,
          carbs: nutrition?.carbs || 0,
        };
      });
      setCalorieHistory15d(nextCalorieHistory);
      const baseFrom = dates15[dates15.length - 1] || dates15[0] || "";
      const defaultTo = dates15[0] || "";
      const effectiveRegistration = registrationIso || baseFrom;
      const defaultFrom = baseFrom && effectiveRegistration ? (baseFrom < effectiveRegistration ? effectiveRegistration : baseFrom) : baseFrom;
      setRegistrationDateIso(effectiveRegistration);
      setExerciseFromDate((prev) => prev || defaultFrom);
      setExerciseToDate((prev) => prev || defaultTo);
      setCalorieFromDate((prev) => prev || defaultFrom);
      setCalorieToDate((prev) => prev || defaultTo);
      setEditForm({
        firstName: f || "User",
        lastName: l || "",
        currentWeightKg: String(Math.round(Number(profile.weight || 0))),
        targetWeightKg: String(Math.round(targetKg || profile.weight || 0)),
        goalTag: toGoalTag(profile.goalTag),
        paceKgPerWeek: String(pace),
        difficulty: profile.difficulty || "Intermediate",
      });
    } catch {
      Alert.alert("Error", "Could not load profile data.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void fetchSubscription(userId);
        void fetchPayments(userId);
      }
    }, [userId, fetchSubscription, fetchPayments]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setLatestWeightLog(null);
        setLoadingWeight(false);
        return;
      }

      const fetchLatestWeight = async () => {
        setLoadingWeight(true);
        try {
          const res = await fetch(`${resolveApiBaseUrl()}/api/weight/latest`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = (await res.json()) as LatestWeightLog;
            setLatestWeightLog(data);
          }
        } catch {
          // Fall back to profile weight
        } finally {
          setLoadingWeight(false);
        }
      };

      void fetchLatestWeight();
    }, [token]),
  );

  const displayCurrentWeight = latestWeightLog?.has_logs ? latestWeightLog.weight_kg : profileWeightKg;

  const progressPct = useMemo(() => {
    const totalChange = targetWeightKg - startWeightKg;
    const actualChange = displayCurrentWeight - startWeightKg;
    if (totalChange === 0) return 0;
    const pct = (actualChange / totalChange) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }, [displayCurrentWeight, startWeightKg, targetWeightKg]);

  const kgToGo = Math.abs(targetWeightKg - displayCurrentWeight).toFixed(1);
  const kgAchieved = Math.abs(displayCurrentWeight - startWeightKg).toFixed(1);

  const progressBarColor =
    progressPct >= 100 ? "#F59E0B" : goalType === "fat_loss" ? "#22D3EE" : "#4ADE80";

  const progressTitle =
    goalType === "fat_loss"
      ? "Weight loss progress"
      : goalType === "muscle_gain"
        ? "Weight gain progress"
        : goalType === "strength"
          ? "Strength journey"
          : goalTag === "Fat Loss"
            ? "Weight loss progress"
            : goalTag === "Muscle Gain"
              ? "Weight gain progress"
              : "Body recomposition progress";

  const progressCenterLabel =
    progressPct === 0
      ? "0% achieved"
      : progressPct >= 100
        ? "🎉 Goal reached!"
        : `${progressPct}% · ${kgAchieved} kg ${goalType === "fat_loss" ? "lost" : "gained"}`;

  const handleLogWeight = async () => {
    const kg = parseFloat(weighInValue);
    if (!kg || kg <= 0 || kg > 500) {
      Alert.alert("Invalid", "Please enter a valid weight between 1 and 500 kg");
      return;
    }
    if (!token) return;

    setIsLoggingWeight(true);
    const apiBase = resolveApiBaseUrl();
    try {
      const res = await fetch(`${apiBase}/api/weight/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          weight_kg: kg,
          log_date: todayLocal(),
          unit_system: "metric",
        }),
      });

      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();

      setLatestWeightLog({
        weight_kg: kg,
        log_date: todayLocal(),
        days_since_log: 0,
        has_logs: true,
      });
      setProfileWeightKg(kg);

      if (data.change_label) {
        Alert.alert("Logged!", data.change_label);
      }

      setShowWeighInModal(false);
    } catch {
      Alert.alert("Error", "Could not save weight. Try again.");
    } finally {
      setIsLoggingWeight(false);
    }
  };

  const dailyCalorieAdjustment = useMemo(() => {
    if (goalTag === "Fat Loss") return -(paceKgPerWeek * 1000);
    if (goalTag === "Muscle Gain") return +(paceKgPerWeek * 500);
    return +(paceKgPerWeek * 400);
  }, [goalTag, paceKgPerWeek]);

  const filteredExerciseHistory = useMemo(() => {
    if (!exerciseFromDate || !exerciseToDate) return exerciseHistory15d;
    return exerciseHistory15d.filter((row) => row.date >= exerciseFromDate && row.date <= exerciseToDate);
  }, [exerciseHistory15d, exerciseFromDate, exerciseToDate]);
  const filteredCalorieHistory = useMemo(() => {
    if (!calorieFromDate || !calorieToDate) return calorieHistory15d;
    return calorieHistory15d.filter((row) => row.date >= calorieFromDate && row.date <= calorieToDate);
  }, [calorieHistory15d, calorieFromDate, calorieToDate]);

  const currentPickerDate = useMemo(() => {
    if (!activeDatePicker) return new Date();
    const iso =
      activeDatePicker.overlay === "exercise"
        ? activeDatePicker.field === "from"
          ? exerciseFromDate
          : exerciseToDate
        : activeDatePicker.field === "from"
          ? calorieFromDate
          : calorieToDate;
    const parsed = iso ? parseIsoDate(iso) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [activeDatePicker, exerciseFromDate, exerciseToDate, calorieFromDate, calorieToDate]);

  const pickerBounds = useMemo(() => {
    if (!activeDatePicker) return { minimumDate: undefined as Date | undefined, maximumDate: new Date() as Date | undefined };
    const today = new Date();
    const registrationDate = registrationDateIso ? parseIsoDate(registrationDateIso) : undefined;
    const overlay = activeDatePicker.overlay;
    const field = activeDatePicker.field;
    const fromIso = overlay === "exercise" ? exerciseFromDate : calorieFromDate;
    const toIso = overlay === "exercise" ? exerciseToDate : calorieToDate;
    const fromDate = fromIso ? parseIsoDate(fromIso) : today;
    const toDate = toIso ? parseIsoDate(toIso) : today;

    if (field === "from") {
      // from must be <= to and within 30-day window ending at to
      const fromMin = addDays(toDate, -(MAX_SELECTABLE_RANGE_DAYS - 1));
      return {
        minimumDate: registrationDate ? maxDate(fromMin, registrationDate) : fromMin,
        maximumDate: toDate,
      };
    }
    // to must be >= from and within 30-day window starting at from
    const toMax = minDate(addDays(fromDate, MAX_SELECTABLE_RANGE_DAYS - 1), today);
    return {
      minimumDate: registrationDate ? maxDate(fromDate, registrationDate) : fromDate,
      maximumDate: toMax,
    };
  }, [activeDatePicker, exerciseFromDate, exerciseToDate, calorieFromDate, calorieToDate, registrationDateIso]);
  const calendarNavBounds = useMemo(() => {
    const now = new Date();
    const registrationDate = registrationDateIso ? parseIsoDate(registrationDateIso) : null;
    const minNav = new Date(now.getFullYear() - CALENDAR_NAV_YEARS, now.getMonth(), now.getDate());
    return {
      minimumDate: registrationDate ? maxDate(minNav, registrationDate) : minNav,
      maximumDate: new Date(now.getFullYear() + CALENDAR_NAV_YEARS, now.getMonth(), now.getDate()),
    };
  }, [registrationDateIso]);
  const webCalendarDays = useMemo(() => {
    if (Platform.OS !== "web") return [];
    const start = monthStart(calendarCursor);
    const end = monthEnd(calendarCursor);
    const leading = (start.getDay() + 6) % 7; // Monday first
    const cells: Array<{ date: Date; iso: string; inMonth: boolean; disabled: boolean }> = [];
    for (let i = leading; i > 0; i -= 1) {
      const d = addDays(start, -i);
      const iso = toIsoLocalDate(d);
      const min = pickerBounds.minimumDate ? parseIsoDate(toIsoLocalDate(pickerBounds.minimumDate)) : null;
      const max = pickerBounds.maximumDate ? parseIsoDate(toIsoLocalDate(pickerBounds.maximumDate)) : null;
      const disabled = (min ? d < min : false) || (max ? d > max : false);
      cells.push({ date: d, iso, inMonth: false, disabled });
    }
    for (let day = 1; day <= end.getDate(); day += 1) {
      const d = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), day);
      const iso = toIsoLocalDate(d);
      const min = pickerBounds.minimumDate ? parseIsoDate(toIsoLocalDate(pickerBounds.minimumDate)) : null;
      const max = pickerBounds.maximumDate ? parseIsoDate(toIsoLocalDate(pickerBounds.maximumDate)) : null;
      const disabled = (min ? d < min : false) || (max ? d > max : false);
      cells.push({ date: d, iso, inMonth: true, disabled });
    }
    while (cells.length % 7 !== 0) {
      const d = addDays(cells[cells.length - 1].date, 1);
      const iso = toIsoLocalDate(d);
      const min = pickerBounds.minimumDate ? parseIsoDate(toIsoLocalDate(pickerBounds.minimumDate)) : null;
      const max = pickerBounds.maximumDate ? parseIsoDate(toIsoLocalDate(pickerBounds.maximumDate)) : null;
      const disabled = (min ? d < min : false) || (max ? d > max : false);
      cells.push({ date: d, iso, inMonth: false, disabled });
    }
    return cells;
  }, [calendarCursor, pickerBounds]);

  useEffect(() => {
    if (!activeDatePicker) return;
    setCalendarCursor(currentPickerDate);
  }, [activeDatePicker, currentPickerDate]);

  const applyPickedDate = (overlay: "exercise" | "calorie", field: "from" | "to", selected: Date) => {
    const pickedIso = toIsoLocalDate(selected);
    const currentFrom = overlay === "exercise" ? exerciseFromDate : calorieFromDate;
    const currentTo = overlay === "exercise" ? exerciseToDate : calorieToDate;
    let nextFrom = field === "from" ? pickedIso : currentFrom;
    let nextTo = field === "to" ? pickedIso : currentTo;
    if (!nextFrom) nextFrom = nextTo || pickedIso;
    if (!nextTo) nextTo = nextFrom || pickedIso;
    if (nextFrom > nextTo) {
      if (field === "from") nextTo = nextFrom;
      else nextFrom = nextTo;
    }
    const spanDays = dateRangeDaysInclusive(nextFrom, nextTo);
    if (spanDays > MAX_SELECTABLE_RANGE_DAYS) {
      if (field === "from") {
        nextTo = toIsoLocalDate(addDays(parseIsoDate(nextFrom), MAX_SELECTABLE_RANGE_DAYS - 1));
      } else {
        nextFrom = toIsoLocalDate(addDays(parseIsoDate(nextTo), -(MAX_SELECTABLE_RANGE_DAYS - 1)));
      }
      Alert.alert("Date range adjusted", "Range cannot exceed 30 days.");
    }
    if (overlay === "exercise") {
      setExerciseFromDate(nextFrom);
      setExerciseToDate(nextTo);
    } else {
      setCalorieFromDate(nextFrom);
      setCalorieToDate(nextTo);
    }
  };

  const onDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === "dismissed") {
      setActiveDatePicker(null);
      return;
    }
    if (!selected || !activeDatePicker) return;
    applyPickedDate(activeDatePicker.overlay, activeDatePicker.field, selected);
    if (Platform.OS !== "ios") setActiveDatePicker(null);
  };

  const openDateSelector = (overlay: "exercise" | "calorie", field: "from" | "to") => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value:
          overlay === "exercise"
            ? field === "from"
              ? parseIsoDate(exerciseFromDate || toIsoLocalDate(new Date()))
              : parseIsoDate(exerciseToDate || toIsoLocalDate(new Date()))
            : field === "from"
              ? parseIsoDate(calorieFromDate || toIsoLocalDate(new Date()))
              : parseIsoDate(calorieToDate || toIsoLocalDate(new Date())),
        mode: "date",
        minimumDate: calendarNavBounds.minimumDate,
        maximumDate: calendarNavBounds.maximumDate,
        onChange: (event, selected) => {
          if (event.type === "set" && selected) {
            applyPickedDate(overlay, field, selected);
          }
        },
      });
      return;
    }
    setActiveDatePicker({ overlay, field });
  };

  const saveEdit = async () => {
    const nextName = `${editForm.firstName} ${editForm.lastName}`.trim();
    const nextCurrent = Number(editForm.currentWeightKg || 0);
    const nextTarget = Number(editForm.targetWeightKg || 0);
    const nextPace = Number(editForm.paceKgPerWeek || 0.5);
    if (!nextName || nextCurrent <= 0 || nextTarget <= 0) {
      Alert.alert("Validation", "Please enter valid name and weights.");
      return;
    }
    try {
      await updateProfile({
        name: nextName,
        age,
        weight: nextCurrent,
        goals: editForm.goalTag,
        goalTag: editForm.goalTag,
        difficulty: editForm.difficulty,
      });
      const onboard = await fetchOnboardingMe().catch(() => null);
      if (onboard?.onboarding) {
        const nextOnboarding: any = {
          ...onboard.onboarding,
          personal: { ...onboard.onboarding.personal, name: nextName, weight_kg: nextCurrent, weight_lb: nextCurrent * 2.20462 },
          goal: {
            ...onboard.onboarding.goal,
            type: editForm.goalTag === "Fat Loss" ? "fat_loss" : editForm.goalTag === "Muscle Gain" ? "muscle_gain" : "strength",
            pace: nextPace === 0.25 ? "slow" : nextPace === 0.5 ? "moderate" : "aggressive",
            target_weight_kg: nextTarget,
            target_weight_lb: nextTarget * 2.20462,
          },
        };
        const targets = calculateNutritionTargets(nextOnboarding);
        await upsertOnboardingMe({ onboarding: nextOnboarding, targets });
      }
      setEditOpen(false);
      await load();
    } catch {
      Alert.alert("Error", "Could not save profile changes.");
    }
  };

  const onSubmitFeedback = async () => {
    const subject = feedbackSubject.trim();
    const body = feedbackBody.trim();
    if (!subject) {
      Alert.alert("Validation", "Please enter a feedback subject.");
      return;
    }
    if (!body) {
      Alert.alert("Validation", "Please enter your feedback message.");
      return;
    }
    try {
      setSendingFeedback(true);
      await submitFeedback({ subject, body });
      setFeedbackSent(true);
    } catch (error) {
      const message =
        error && typeof error === "object" && "response" in error
          ? String((error as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : "";
      Alert.alert("Error", message || "Could not send feedback right now.");
    } finally {
      setSendingFeedback(false);
    }
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <HeroHeader title="Profile" subtitle="Fitness identity and progress" />

        {plan_id === "free" && subscriptionTier === "FREE" ? (
          <Pressable
            onPress={() => navigation.navigate("Subscription")}
            style={[styles.proCta, { borderColor: "#E84545", backgroundColor: "rgba(232,69,69,0.12)" }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.proCtaTitle, { color: "#E84545" }]}>NexRep PRO</Text>
              <Text style={[styles.proCtaSub, { color: colors.muted }]}>Unlock AI tracking & premium coaching</Text>
            </View>
            <Text style={{ color: "#E84545", fontSize: 22, fontWeight: "300" }}>›</Text>
          </Pressable>
        ) : null}

        <View style={[styles.headerCard, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
          <Pressable
            style={[styles.editTopRightBtn, { borderColor: colors.border }]}
            onPress={() => {
              setReturnToProfileAfterOnboarding(true);
              setNeedsOnboarding(true);
            }}
          >
            <Text style={[styles.headerBtnText, { color: colors.text }]}>Edit profile</Text>
          </Pressable>

          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(firstName, lastName)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.nameText}>{`${firstName} ${lastName}`.trim()}</Text>
              <Text style={[styles.metaText, { color: colors.muted }]}>
                {`Member since ${memberSince} · ${difficulty}`}
              </Text>
              <Text
                style={[
                  styles.metaText,
                  {
                    marginTop: 2,
                    color:
                      plan_id === "elite" ? "#a5a0f0" : plan_id === "pro" ? "#3fcf8e" : colors.muted,
                    fontWeight: "600",
                  },
                ]}
              >
                {plan_id.toUpperCase()} plan
              </Text>
            </View>
          </View>
          <View style={styles.headerBtns}>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tilesRow}>
          <View style={[styles.tile, { borderColor: HOME_CARD_BORDER, backgroundColor: HOME_CARD_BG }]}>
            <Text style={styles.tileLabel}>CURRENT WEIGHT</Text>
            {loadingWeight ? (
              <ActivityIndicator size="small" color="#22D3EE" style={{ marginTop: 6 }} />
            ) : (
              <>
                <Text style={styles.tileValue}>{round1(displayCurrentWeight)} kg</Text>
                {latestWeightLog?.log_date ? (
                  <Text style={styles.statSubtext}>
                    {latestWeightLog.days_since_log === 0
                      ? "Updated today"
                      : `${latestWeightLog.days_since_log}d ago`}
                  </Text>
                ) : null}
                {!latestWeightLog?.has_logs ? <Text style={styles.statSubtextMuted}>From profile</Text> : null}
              </>
            )}
          </View>
          <Tile label="TARGET WEIGHT" value={`${round1(targetWeightKg)} kg`} valueColor="#55B56A" />
          <Tile label="GOAL" value={goalTag} sub={`${dailyCalorieAdjustment > 0 ? "+" : ""}${Math.round(dailyCalorieAdjustment)} kcal/day`} valueColor={goalColors[goalTag].primary} />
          <Tile label="PACE" value={String(paceKgPerWeek)} sub="kg/week" />
        </ScrollView>

        <View style={[styles.progressCard, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
          <View style={styles.progressHead}>
            <Text style={styles.progressTitle}>{progressTitle}</Text>
            <Text style={[styles.progressTopRight, { color: colors.text }]}>
              {`${round1(startWeightKg)} kg → ${round1(targetWeightKg)} kg · ${kgToGo} kg to go`}
            </Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${progressPct}%`, backgroundColor: progressBarColor },
              ]}
            />
          </View>
          <View style={styles.progressBottom}>
            <Text style={[styles.progressSmall, { color: colors.muted }]}>{`Start: ${round1(startWeightKg)} kg`}</Text>
            <Text
              style={[
                styles.progressLabelCenter,
                progressPct === 0 && styles.progressLabelZero,
                progressPct >= 100 && styles.progressLabelComplete,
              ]}
            >
              {progressCenterLabel}
            </Text>
            <Text style={[styles.progressSmall, { color: colors.muted }]}>{`Target: ${round1(targetWeightKg)} kg`}</Text>
          </View>

          <TouchableOpacity
            style={styles.quickWeighInBtn}
            onPress={() => {
              setWeighInValue(String(displayCurrentWeight || ""));
              setShowWeighInModal(true);
            }}
          >
            <Ionicons name="scale-outline" size={14} color="#22D3EE" />
            <Text style={styles.quickWeighInText}>
              {latestWeightLog?.has_logs
                ? `Update weight (last: ${round1(latestWeightLog.weight_kg)}kg)`
                : "Log your current weight"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.achievementsRow}>
          <StatTile value={numFmt(stats.totalWorkoutsDone)} label="Workouts done" valueColor="#534AB7" />
          <StatTile value={numFmt(stats.totalKcalBurned)} label="Total kcal burned" valueColor="#E24B4A" />
          <StatTile value={numFmt(stats.currentDayStreak)} label="Day streak" valueColor="#1D9E75" />
          <StatTile value={String(stats.avgSessionsPerWeek)} label="Avg sessions/week" valueColor="#BA7517" />
        </View>

        {userId ? <SubscriptionCard userId={userId} /> : null}
        <PaymentHistorySection />
        <PlanTimelineSection />

        <View style={styles.historyCardsRow}>
          <View style={[styles.historySectionCard, styles.historySectionHalf, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
            <Pressable
              style={[styles.historySectionButton, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => setShowExerciseHistory(true)}
            >
              <Text style={[styles.historySectionButtonText, { color: colors.text }]}>Exercise History</Text>
              <Text style={[styles.historySectionChevron, { color: colors.muted }]}>↗</Text>
            </Pressable>
          </View>
          <View style={[styles.historySectionCard, styles.historySectionHalf, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
            <Pressable
              style={[styles.historySectionButton, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => setShowCalorieHistory(true)}
            >
              <Text style={[styles.historySectionButtonText, { color: colors.text }]}>Calorie History</Text>
              <Text style={[styles.historySectionChevron, { color: colors.muted }]}>↗</Text>
            </Pressable>
          </View>
        </View>

        <DevSubscriptionToggle email={userEmail} />

        <TouchableOpacity
          onPress={handleVersionTap}
          activeOpacity={1}
          hitSlop={{ top: 20, bottom: 20, left: 40, right: 40 }}
          style={styles.versionWrap}
        >
          <Text style={[styles.versionText, { color: colors.muted }]}>Version {APP_VERSION}</Text>
        </TouchableOpacity>
        <View style={styles.footerActions}>
          {__DEV__ ? (
            <Pressable
              style={[styles.footerActionBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}
              onPress={() => navigation.navigate("AdminStack")}
            >
              <Text style={[styles.feedbackText, { color: colors.text }]}>Go to Admin</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.footerActionBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}
            onPress={() => void signOutSession()}
          >
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
          <Pressable
            style={[styles.footerActionBtn, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}
            onPress={() => {
              setFeedbackSent(false);
              setFeedbackOpen(true);
            }}
          >
            <Text style={[styles.feedbackText, { color: colors.text }]}>Feedback</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={showWeighInModal} transparent animationType="slide" onRequestClose={() => setShowWeighInModal(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.weighInModal}>
            <Text style={styles.weighInModalTitle}>Log Today&apos;s Weight</Text>
            <Text style={styles.weighInModalSubtitle}>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </Text>

            <View style={styles.weightInputRow}>
              <TextInput
                style={styles.weightInput}
                value={weighInValue}
                onChangeText={setWeighInValue}
                keyboardType="decimal-pad"
                placeholder="70.5"
                placeholderTextColor="#475569"
                autoFocus
              />
              <Text style={styles.weightUnit}>kg</Text>
            </View>

            <View style={styles.quickAdjustRow}>
              {[-1, -0.5, 0.5, 1].map((delta) => (
                <TouchableOpacity
                  key={delta}
                  style={styles.quickAdjustBtn}
                  onPress={() => {
                    const current = parseFloat(weighInValue) || 0;
                    setWeighInValue(String(Math.round((current + delta) * 10) / 10));
                  }}
                >
                  <Text style={styles.quickAdjustText}>{delta > 0 ? `+${delta}` : delta}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {latestWeightLog?.has_logs ? (
              <Text style={styles.weighInLastRef}>Last logged: {round1(latestWeightLog.weight_kg)}kg</Text>
            ) : null}

            <View style={styles.weighInActions}>
              <TouchableOpacity style={styles.weighInCancel} onPress={() => setShowWeighInModal(false)}>
                <Text style={styles.weighInCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.weighInSave, isLoggingWeight && styles.weighInSaveDisabled]}
                onPress={() => void handleLogWeight()}
                disabled={isLoggingWeight}
              >
                {isLoggingWeight ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.weighInSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={feedbackOpen} transparent animationType="slide" onRequestClose={() => setFeedbackOpen(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={[styles.feedbackSheet, { borderColor: colors.border, backgroundColor: colors.card }]}>
            {feedbackSent ? (
              <View style={styles.feedbackSentWrap}>
                <View style={[styles.feedbackTickCircle, { backgroundColor: "rgba(85,181,106,0.16)" }]}>
                  <Text style={styles.feedbackTick}>✓</Text>
                </View>
                <Text style={[styles.feedbackTitle, { color: colors.text, textAlign: "center", marginBottom: 6 }]}>Sent successfully</Text>
                <Text style={[styles.feedbackSub, { color: colors.muted, textAlign: "center" }]}>
                  Your message was delivered to admin@nexrep.in
                </Text>
                <View style={styles.feedbackActions}>
                  <Pressable
                    style={[styles.feedbackActionBtn, { borderColor: colors.border }]}
                    onPress={() => {
                      setFeedbackOpen(false);
                      setFeedbackSent(false);
                      setFeedbackSubject("");
                      setFeedbackBody("");
                    }}
                  >
                    <Text style={[styles.feedbackCancelText, { color: colors.text }]}>Close</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Text style={[styles.feedbackTitle, { color: colors.text }]}>Send Feedback</Text>
                <Text style={[styles.feedbackSub, { color: colors.muted }]}>This will be sent to admin@nexrep.in</Text>
                <View style={styles.feedbackField}>
                  <Text style={[styles.editLabel, { color: colors.muted }]}>Subject</Text>
                  <TextInput
                    value={feedbackSubject}
                    onChangeText={setFeedbackSubject}
                    placeholder="Type subject"
                    placeholderTextColor={colors.muted}
                    style={[styles.feedbackInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]}
                  />
                </View>
                <View style={styles.feedbackField}>
                  <Text style={[styles.editLabel, { color: colors.muted }]}>Body</Text>
                  <TextInput
                    value={feedbackBody}
                    onChangeText={setFeedbackBody}
                    placeholder="Write your feedback..."
                    placeholderTextColor={colors.muted}
                    multiline
                    textAlignVertical="top"
                    style={[styles.feedbackBodyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]}
                  />
                </View>
                <View style={styles.feedbackActions}>
                  <Pressable
                    style={[styles.feedbackActionBtn, { borderColor: colors.border }]}
                    onPress={() => setFeedbackOpen(false)}
                    disabled={sendingFeedback}
                  >
                    <Text style={[styles.feedbackCancelText, { color: colors.text }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.feedbackActionBtn, { backgroundColor: colors.primary }]}
                    onPress={() => void onSubmitFeedback()}
                    disabled={sendingFeedback}
                  >
                    <Text style={styles.feedbackSendText}>{sendingFeedback ? "Sending..." : "Send"}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={[styles.editSheet, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={styles.editTitle}>Edit profile</Text>
            <EditField label="First name" value={editForm.firstName} onChange={(v) => setEditForm((p) => ({ ...p, firstName: v }))} />
            <EditField label="Last name" value={editForm.lastName} onChange={(v) => setEditForm((p) => ({ ...p, lastName: v }))} />
            <EditField label="Current weight (kg)" value={editForm.currentWeightKg} numeric onChange={(v) => setEditForm((p) => ({ ...p, currentWeightKg: v.replace(/[^\d.]/g, "") }))} />
            <EditField label="Target weight (kg)" value={editForm.targetWeightKg} numeric onChange={(v) => setEditForm((p) => ({ ...p, targetWeightKg: v.replace(/[^\d.]/g, "") }))} />
            <SelectRow
              label="Goal tag"
              options={["Fat Loss", "Muscle Gain", "Strength"]}
              selected={editForm.goalTag}
              onSelect={(v) => setEditForm((p) => ({ ...p, goalTag: v as GoalTag }))}
            />
            <SelectRow
              label="Pace (kg/week)"
              options={goalPaceOptions.map(String)}
              selected={editForm.paceKgPerWeek}
              onSelect={(v) => setEditForm((p) => ({ ...p, paceKgPerWeek: v }))}
            />
            <SelectRow
              label="Difficulty"
              options={difficultyOptions}
              selected={editForm.difficulty}
              onSelect={(v) => setEditForm((p) => ({ ...p, difficulty: v }))}
            />
            <Pressable style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={() => void saveEdit()}>
              <Text style={styles.saveBtnText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showExerciseHistory} transparent animationType="slide" onRequestClose={() => setShowExerciseHistory(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={[styles.historyOverlaySheet, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
            <View style={styles.historyOverlayHeader}>
              <Text style={[styles.historyOverlayTitle, { color: colors.text }]}>Exercise History</Text>
              <Pressable style={[styles.historyOverlayCloseBtn, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setShowExerciseHistory(false)}>
                <Text style={[styles.historyOverlayCloseText, { color: colors.text }]}>Close</Text>
              </Pressable>
            </View>
            <Text style={[styles.historyOverlaySub, { color: colors.muted }]}>Select From/To dates (max 30 days)</Text>
            <View style={styles.overlayRangeRow}>
              <Pressable
                style={[styles.overlayDateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => openDateSelector("exercise", "from")}
              >
                <Text style={[styles.overlayDateLabel, { color: colors.muted }]}>From</Text>
                <Text style={[styles.overlayDateValue, { color: colors.text }]}>{exerciseFromDate || "Select date"}</Text>
              </Pressable>
              <Pressable
                style={[styles.overlayDateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => openDateSelector("exercise", "to")}
              >
                <Text style={[styles.overlayDateLabel, { color: colors.muted }]}>To</Text>
                <Text style={[styles.overlayDateValue, { color: colors.text }]}>{exerciseToDate || "Select date"}</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.historyOverlayList} contentContainerStyle={styles.historyOverlayListContent}>
              {filteredExerciseHistory.map((row) => (
                <View key={`overlay-exercise-${row.date}`} style={[styles.historyRowLine, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.historyDateText, { color: colors.text }]}>
                    {`${row.date}, ${
                      row.workouts.length > 0
                        ? row.workouts.map((workout) => `${workout.bodyPart} - ${workout.exerciseName}`).join(", ")
                        : "No exercises logged"
                    }`}
                  </Text>
                </View>
              ))}
              {filteredExerciseHistory.length === 0 ? <Text style={[styles.historyEmptyText, { color: colors.muted }]}>No exercise history in selected range.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showCalorieHistory} transparent animationType="slide" onRequestClose={() => setShowCalorieHistory(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={[styles.historyOverlaySheet, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
            <View style={styles.historyOverlayHeader}>
              <Text style={[styles.historyOverlayTitle, { color: colors.text }]}>Calorie History</Text>
              <Pressable style={[styles.historyOverlayCloseBtn, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setShowCalorieHistory(false)}>
                <Text style={[styles.historyOverlayCloseText, { color: colors.text }]}>Close</Text>
              </Pressable>
            </View>
            <Text style={[styles.historyOverlaySub, { color: colors.muted }]}>Select From/To dates (max 30 days)</Text>
            <View style={styles.overlayRangeRow}>
              <Pressable
                style={[styles.overlayDateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => openDateSelector("calorie", "from")}
              >
                <Text style={[styles.overlayDateLabel, { color: colors.muted }]}>From</Text>
                <Text style={[styles.overlayDateValue, { color: colors.text }]}>{calorieFromDate || "Select date"}</Text>
              </Pressable>
              <Pressable
                style={[styles.overlayDateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => openDateSelector("calorie", "to")}
              >
                <Text style={[styles.overlayDateLabel, { color: colors.muted }]}>To</Text>
                <Text style={[styles.overlayDateValue, { color: colors.text }]}>{calorieToDate || "Select date"}</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.historyOverlayList} contentContainerStyle={styles.historyOverlayListContent}>
              {filteredCalorieHistory.map((row) => (
                <View key={`overlay-calorie-${row.date}`} style={[styles.historyRowLine, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.historyDateText, { color: colors.text }]}>{row.date}</Text>
                  <Text style={[styles.historyValueText, { color: colors.muted }]}>
                    Protein: {row.protein}g, Fat: {row.fat}g, Fibre: {row.fiber}g, Water: {row.water}L, Carbs: {row.carbs}g
                  </Text>
                </View>
              ))}
              {filteredCalorieHistory.length === 0 ? <Text style={[styles.historyEmptyText, { color: colors.muted }]}>No calorie history in selected range.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={activeDatePicker !== null && Platform.OS !== "android"} transparent animationType="fade" onRequestClose={() => setActiveDatePicker(null)}>
        <View style={styles.modalBackdropBottom}>
          <View style={[styles.datePickerSheet, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.datePickerTitle, { color: colors.text }]}>
              Select {activeDatePicker?.field === "from" ? "From" : "To"} Date
            </Text>
            {Platform.OS === "web" ? (
              <View style={styles.webCalendarWrap}>
                <View style={styles.webCalendarHeader}>
                  <Pressable
                    style={[styles.webMonthNavBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                    onPress={() => setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                    disabled={monthStart(calendarCursor) <= monthStart(calendarNavBounds.minimumDate)}
                  >
                    <Text style={[styles.webMonthNavText, { color: colors.text }]}>‹</Text>
                  </Pressable>
                  <Text style={[styles.webCalendarMonth, { color: colors.text }]}>{monthLabel(calendarCursor)}</Text>
                  <Pressable
                    style={[styles.webMonthNavBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                    onPress={() => setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                    disabled={monthStart(calendarCursor) >= monthStart(calendarNavBounds.maximumDate)}
                  >
                    <Text style={[styles.webMonthNavText, { color: colors.text }]}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.webWeekHeaderRow}>
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                    <Text key={d} style={[styles.webWeekHeaderCell, { color: colors.muted }]}>{d}</Text>
                  ))}
                </View>
                <View style={styles.webGrid}>
                  {webCalendarDays.map((cell) => {
                    const selectedIso = toIsoLocalDate(currentPickerDate);
                    const isSelected = cell.iso === selectedIso;
                    return (
                      <Pressable
                        key={`${cell.iso}-${cell.inMonth ? "in" : "out"}`}
                        style={[
                          styles.webDayCell,
                          {
                            borderColor: colors.border,
                            backgroundColor: isSelected ? colors.primary : colors.card,
                            opacity: cell.inMonth ? 1 : 0.5,
                          },
                        ]}
                        disabled={cell.disabled}
                        onPress={() => {
                          if (!activeDatePicker) return;
                          applyPickedDate(activeDatePicker.overlay, activeDatePicker.field, cell.date);
                        }}
                      >
                        <Text
                          style={[
                            styles.webDayText,
                            { color: isSelected ? colors.background : cell.disabled ? colors.muted : colors.text },
                          ]}
                        >
                          {cell.date.getDate()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : (
              <DateTimePicker
                value={currentPickerDate}
                mode="date"
                display="spinner"
                onChange={onDateChange}
                minimumDate={calendarNavBounds.minimumDate}
                maximumDate={calendarNavBounds.maximumDate}
                textColor={colors.text}
              />
            )}
            <Pressable style={[styles.datePickerDoneBtn, { backgroundColor: colors.primary }]} onPress={() => setActiveDatePicker(null)}>
              <Text style={styles.datePickerDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  proCta: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  proCtaTitle: { fontSize: 16, fontWeight: "800" },
  proCtaSub: { fontSize: 12, marginTop: 4 },
  headerCard: { borderWidth: 0.5, borderRadius: 12, padding: 12, marginBottom: 12, position: "relative" },
  editTopRightBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    borderWidth: 0.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    zIndex: 5,
  },
  headerLeft: { flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 10 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: "#404060" },
  avatarText: { color: "#fff", fontSize: 17, fontWeight: "500" },
  nameText: { color: "#fff", fontSize: 19, fontWeight: "500" },
  metaText: { fontSize: 11 },
  headerBtns: { flexDirection: "row", gap: 8, alignItems: "center" },
  headerBtn: { borderWidth: 0.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  headerBtnText: { fontSize: 11, fontWeight: "500" },
  headerBtnFilled: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  headerBtnFilledText: { color: "#111", fontSize: 11, fontWeight: "600" },
  tilesRow: { gap: 10, paddingBottom: 10 },
  tile: { width: 142, borderRadius: 12, borderWidth: 0.5, padding: 10 },
  tileLabel: { color: "#9AA8C4", fontSize: 9, fontWeight: "500", marginBottom: 6, letterSpacing: 0.5 },
  tileValue: { color: "#fff", fontSize: 15, fontWeight: "500" },
  tileSub: { color: "#9AA8C4", fontSize: 10, marginTop: 2 },
  progressCard: { borderWidth: 0.5, borderRadius: 12, padding: 12, marginBottom: 12 },
  progressHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8, gap: 10 },
  progressTitle: { color: "#fff", fontSize: 13, fontWeight: "500" },
  progressTopRight: { fontSize: 10, flex: 1, textAlign: "right" },
  progressTrack: { height: 8, borderRadius: 99, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 99 },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    marginVertical: 8,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  progressBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  progressSmall: { fontSize: 9 },
  progressLabelCenter: {
    color: "#4ADE80",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    flex: 1,
  },
  progressLabelZero: { color: "#64748B" },
  progressLabelComplete: { color: "#F59E0B" },
  statSubtext: {
    color: "#22D3EE",
    fontSize: 10,
    marginTop: 2,
  },
  statSubtextMuted: {
    color: "#475569",
    fontSize: 10,
    marginTop: 2,
  },
  quickWeighInBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  quickWeighInText: {
    color: "#22D3EE",
    fontSize: 12,
    fontWeight: "500",
  },
  weighInModal: {
    backgroundColor: "#141b2d",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  weighInModalTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  weighInModalSubtitle: { color: "#64748B", fontSize: 13, marginBottom: 20 },
  weightInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  weightInput: {
    fontSize: 48,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    minWidth: 120,
    borderBottomWidth: 2,
    borderBottomColor: "#22D3EE",
    paddingBottom: 4,
  },
  weightUnit: { color: "#64748B", fontSize: 20, marginTop: 16 },
  quickAdjustRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  quickAdjustBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  quickAdjustText: { color: "#94A3B8", fontSize: 14, fontWeight: "600" },
  weighInLastRef: { color: "#475569", fontSize: 12, textAlign: "center", marginBottom: 20 },
  weighInActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  weighInCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
  },
  weighInCancelText: { color: "#94A3B8", fontSize: 15, fontWeight: "600" },
  weighInSave: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#22D3EE",
    alignItems: "center",
  },
  weighInSaveDisabled: { opacity: 0.6 },
  weighInSaveText: { color: "#000", fontSize: 15, fontWeight: "700" },
  achievementsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  historyCardsRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginBottom: 10 },
  historySectionCard: { borderWidth: 0.5, borderRadius: 12, padding: 10, marginBottom: 10 },
  historySectionHalf: { flex: 1, minWidth: 0, marginBottom: 0 },
  historySectionButton: {
    borderWidth: 0.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historySectionButtonText: { fontSize: 13, fontWeight: "600" },
  historySectionChevron: { fontSize: 14, fontWeight: "700" },
  historyRowLine: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  historyDateText: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  historyValueText: { fontSize: 11, lineHeight: 16 },
  historyWorkoutText: { fontSize: 11, lineHeight: 16, marginTop: 4, fontWeight: "600" },
  historyEmptyText: { fontSize: 11, fontStyle: "italic", paddingVertical: 6 },
  historyOverlaySheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 0.5, padding: 12, maxHeight: "82%" },
  historyOverlayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  historyOverlayTitle: { fontSize: 16, fontWeight: "700" },
  historyOverlaySub: { fontSize: 11, marginBottom: 8 },
  overlayRangeRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  overlayDateBtn: { flex: 1, borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  overlayDateLabel: { fontSize: 10, fontWeight: "600", marginBottom: 3 },
  overlayDateValue: { fontSize: 12, fontWeight: "700" },
  historyOverlayCloseBtn: { borderWidth: 0.5, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  historyOverlayCloseText: { fontSize: 12, fontWeight: "700" },
  historyOverlayList: { flexGrow: 0 },
  historyOverlayListContent: { paddingBottom: 8 },
  datePickerSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 0.5, padding: 14 },
  datePickerTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  webCalendarWrap: { marginBottom: 8 },
  webCalendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  webMonthNavBtn: { width: 34, height: 30, borderWidth: 0.5, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  webMonthNavText: { fontSize: 18, fontWeight: "700", lineHeight: 20 },
  webCalendarMonth: { fontSize: 14, fontWeight: "700" },
  webWeekHeaderRow: { flexDirection: "row", marginBottom: 6 },
  webWeekHeaderCell: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600" },
  webGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  webDayCell: {
    width: "13.4%",
    aspectRatio: 1,
    borderWidth: 0.5,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  webDayText: { fontSize: 12, fontWeight: "700" },
  datePickerDoneBtn: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 10, marginTop: 8 },
  datePickerDoneText: { color: "#111", fontSize: 12, fontWeight: "700" },
  statTile: { flex: 1, minWidth: "47%", borderRadius: 12, borderWidth: 0.5, padding: 10, alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "500", marginBottom: 4 },
  statLabel: { color: "#9AA8C4", fontSize: 9, textAlign: "center" },
  versionWrap: { marginTop: 16, marginBottom: 4, alignItems: "center" },
  versionText: { fontSize: 11 },
  footerActions: {
    marginTop: 8,
    gap: 8,
  },
  footerActionBtn: {
    borderWidth: 0.5,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { color: "#E24B4A", fontSize: 12, fontWeight: "600" },
  feedbackText: { fontSize: 12, fontWeight: "600" },
  modalBackdropBottom: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  feedbackSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 0.5, padding: 14 },
  feedbackTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  feedbackSub: { fontSize: 11, marginBottom: 10 },
  feedbackField: { marginBottom: 10 },
  feedbackInput: { borderWidth: 0.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 12 },
  feedbackBodyInput: { borderWidth: 0.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 12, minHeight: 110 },
  feedbackActions: { flexDirection: "row", gap: 8, marginTop: 6 },
  feedbackActionBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", justifyContent: "center", borderWidth: 0.5 },
  feedbackCancelText: { fontSize: 12, fontWeight: "600" },
  feedbackSendText: { color: "#111", fontSize: 12, fontWeight: "700" },
  feedbackSentWrap: { alignItems: "center", paddingVertical: 6 },
  feedbackTickCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  feedbackTick: { color: "#2E7D32", fontSize: 42, fontWeight: "700", lineHeight: 44 },
  editSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 0.5, padding: 14, maxHeight: "85%" },
  editTitle: { color: "#fff", fontSize: 14, fontWeight: "500", marginBottom: 10 },
  editField: { marginBottom: 8 },
  editLabel: { color: "#9AA8C4", fontSize: 9, marginBottom: 4 },
  editInput: { borderWidth: 0.5, borderColor: "#333", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: "#fff", fontSize: 11 },
  selectRow: { marginBottom: 8 },
  selectWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  selectChip: { borderWidth: 0.5, borderColor: "#333", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 },
  selectChipActive: { backgroundColor: "#fff" },
  selectChipText: { color: "#9AA8C4", fontSize: 10 },
  selectChipTextActive: { color: "#111", fontWeight: "500" },
  saveBtn: { borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: 10, marginTop: 8 },
  saveBtnText: { color: "#111", fontSize: 11, fontWeight: "600" },
});

const Tile = ({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) => (
  <View style={[styles.tile, { borderColor: HOME_CARD_BORDER, backgroundColor: HOME_CARD_BG }]}>
    <Text style={styles.tileLabel}>{label}</Text>
    <Text style={[styles.tileValue, valueColor && { color: valueColor }]}>{value}</Text>
    {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
  </View>
);

const StatTile = ({ value, label, valueColor }: { value: string; label: string; valueColor: string }) => (
  <View style={[styles.statTile, { borderColor: HOME_CARD_BORDER, backgroundColor: HOME_CARD_BG }]}>
    <Text style={[styles.statValue, { color: valueColor }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const EditField = ({ label, value, onChange, numeric }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean }) => (
  <View style={styles.editField}>
    <Text style={styles.editLabel}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} keyboardType={numeric ? "decimal-pad" : "default"} style={styles.editInput} />
  </View>
);

const SelectRow = ({ label, options, selected, onSelect }: { label: string; options: string[]; selected: string; onSelect: (v: string) => void }) => (
  <View style={styles.selectRow}>
    <Text style={styles.editLabel}>{label}</Text>
    <View style={styles.selectWrap}>
      {options.map((o) => (
        <Pressable key={o} style={[styles.selectChip, selected === o && styles.selectChipActive]} onPress={() => onSelect(o)}>
          <Text style={[styles.selectChipText, selected === o && styles.selectChipTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  </View>
);
