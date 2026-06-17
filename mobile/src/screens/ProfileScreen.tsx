import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Constants from "expo-constants";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { apiClient, resolveApiBaseUrl } from "../api/client";
import { getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { submitFeedback } from "../api/feedback";
import { fetchOnboardingMe } from "../api/onboarding";
import { getProfile } from "../api/user";
import { getWorkoutHistory } from "../api/workout";
import DevSubscriptionToggle from "../components/DevSubscriptionToggle";
import SubscriptionBillingSection from "../components/SubscriptionBillingSection";
import { ScreenContainer } from "../components/ScreenContainer";
import { signOutSession } from "../services/authService";
import { useAuthStore } from "../store/authStore";
import { useSubscriptionStore } from "../store/subscriptionStore";

type GoalTag = "Fat Loss" | "Muscle Gain" | "Strength";

const goalColors: Record<GoalTag, { primary: string; bg: string; text: string }> = {
  "Fat Loss": { primary: "#E24B4A", bg: "#FCEBEB", text: "#791F1F" },
  "Muscle Gain": { primary: "#534AB7", bg: "#EEEDFE", text: "#26215C" },
  Strength: { primary: "#D85A30", bg: "#FAECE7", text: "#4A1B0C" },
};

const toGoalTag = (v: unknown): GoalTag => (v === "Muscle Gain" || v === "Strength" ? (v as GoalTag) : "Fat Loss");
const monthYear = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const dayLabel = (d: Date = new Date()) => d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const getInitials = (first: string, last: string) => `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "U";
const numFmt = (n: number) => Math.round(n).toLocaleString();
const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY_WINDOW = 30;
const MAX_SELECTABLE_RANGE_DAYS = 30;
const CALENDAR_NAV_YEARS = 10;
const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GOLD = "#FFD700";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

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

  const planBadgeLabel = (plan_id || "free").toUpperCase();
  const planBadgeStyle =
    planBadgeLabel === "ELITE" ? styles.planBadgeElite : planBadgeLabel === "PRO" ? styles.planBadgePro : styles.planBadgeFree;
  const planBadgeTextStyle =
    planBadgeLabel === "ELITE" ? styles.planBadgeEliteText : planBadgeLabel === "PRO" ? styles.planBadgeProText : styles.planBadgeFreeText;
  const avatarRadius = 28;
  const avatarCircumference = 2 * Math.PI * avatarRadius;
  const avatarOffset = avatarCircumference * (1 - Math.max(0, Math.min(100, progressPct)) / 100);
  const dailyAdjustmentLabel = `${dailyCalorieAdjustment > 0 ? "+" : "−"}${Math.abs(Math.round(dailyCalorieAdjustment))} kcal`;

  return (
    <ScreenContainer bg={SCREEN_BG} contentStyle={styles.screenContent}>
      <StatusBar barStyle="dark-content" backgroundColor={SCREEN_BG} />
      <View style={styles.inlineHeader}>
        <Text style={styles.dateLabel}>{dayLabel()}</Text>
        <Text style={styles.pageTitle}>Profile 👤</Text>
      </View>

      <View style={styles.identityCard}>
        <View style={styles.decorCircleTop} />
        <View style={styles.decorCircleBottom} />
        <View style={styles.identityTopRow}>
          <View style={styles.avatarRingWrap}>
            <Svg width={62} height={62} viewBox="0 0 62 62" style={styles.avatarSvg}>
              <Circle cx={31} cy={31} r={avatarRadius} stroke="rgba(255,255,255,0.2)" strokeWidth={4} fill="transparent" />
              <Circle
                cx={31}
                cy={31}
                r={avatarRadius}
                stroke={GOLD}
                strokeWidth={4}
                fill="transparent"
                strokeLinecap="round"
                strokeDasharray={`${avatarCircumference} ${avatarCircumference}`}
                strokeDashoffset={avatarOffset}
                rotation="-90"
                origin="31,31"
              />
            </Svg>
            <View style={styles.avatarInner}>
              <Text style={styles.avatarText}>{getInitials(firstName, lastName)}</Text>
            </View>
          </View>
          <View style={styles.identityTextBlock}>
            <View style={styles.nameBadgeRow}>
              <Text style={styles.nameText}>{`${firstName} ${lastName}`.trim()}</Text>
              <View style={[styles.planBadge, planBadgeStyle]}>
                <Text style={[styles.planBadgeText, planBadgeTextStyle]}>{planBadgeLabel}</Text>
              </View>
            </View>
            {userEmail ? <Text style={styles.emailText}>{userEmail}</Text> : null}
            <Text style={styles.memberMeta}>{`${difficulty} · ${memberSince || "Member"}`}</Text>
          </View>
          <Pressable
            style={styles.heroEditBtn}
            onPress={() => {
              setReturnToProfileAfterOnboarding(true);
              setNeedsOnboarding(true);
            }}
          >
            <Text style={styles.heroEditText}>Edit ✏️</Text>
          </Pressable>
        </View>

        <View style={styles.goalPillsRow}>
          <Tile label="Goal" value={goalTag} emoji="🔥" variant="hero" />
          <Tile label={dailyCalorieAdjustment < 0 ? "Deficit" : "Surplus"} value={dailyAdjustmentLabel} emoji="⚡" variant="hero" />
          <Tile label="Pace" value={`${paceKgPerWeek} kg/w`} emoji="📉" variant="hero" />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>⚖️ Weight journey</Text>
          {progressPct >= 100 ? (
            <View style={styles.goalReachedPill}>
              <Text style={styles.goalReachedText}>🏁 Goal reached!</Text>
            </View>
          ) : (
            <Text style={styles.progressMuted}>{progressPct}%</Text>
          )}
        </View>
        <View style={styles.weightPathRow}>
          <View style={styles.weightPoint}>
            <Text style={styles.weightPointLabel}>Start</Text>
            <Text style={styles.weightStartValue}>{round1(startWeightKg)}</Text>
          </View>
          <View style={styles.weightGradientTrack}>
            <View style={styles.weightGradientOrange} />
            <View style={styles.weightGradientGold} />
            <View style={styles.weightGradientGreen} />
          </View>
          <View style={styles.weightPoint}>
            <Text style={styles.weightPointLabel}>Target</Text>
            <Text style={styles.weightTargetValue}>{round1(targetWeightKg)}</Text>
          </View>
        </View>
        <View style={styles.weightTilesRow}>
          <View style={styles.currentWeightTile}>
            <Text style={styles.tileMuted}>Current</Text>
            {loadingWeight ? (
              <ActivityIndicator size="small" color={GREEN} style={styles.weightLoader} />
            ) : (
              <>
                <Text style={styles.currentWeightValue}>{round1(displayCurrentWeight)} kg</Text>
                {latestWeightLog?.log_date ? (
                  <Text style={[styles.weightFreshness, latestWeightLog.days_since_log === 0 && styles.weightFreshnessToday]}>
                    {latestWeightLog.days_since_log === 0 ? "✓ Updated today" : `${latestWeightLog.days_since_log}d ago`}
                  </Text>
                ) : (
                  <Text style={styles.weightFreshness}>From profile</Text>
                )}
              </>
            )}
          </View>
          <Pressable
            style={styles.logWeightTile}
            onPress={() => {
              setWeighInValue(String(displayCurrentWeight || ""));
              setShowWeighInModal(true);
            }}
          >
            <Text style={styles.logWeightEmoji}>📅</Text>
            <Text style={styles.logWeightText}>Log weight</Text>
            <Text style={styles.logWeightSub}>
              {latestWeightLog?.has_logs ? `last: ${round1(latestWeightLog.weight_kg)} kg` : "start tracking"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>ACTIVITY OVERVIEW</Text>
        <View style={styles.activityStatsRow}>
          <StatTile value={numFmt(stats.totalWorkoutsDone)} label="Workouts" valueColor={BLUE} icon="🏋️" iconBg={BLUE_LIGHT} />
          <StatTile value={numFmt(stats.totalKcalBurned)} label="kcal burned" valueColor={ORANGE} icon="🔥" iconBg={ORANGE_LIGHT} />
          <StatTile value={numFmt(stats.currentDayStreak)} label="Day streak" valueColor={GREEN} icon="⚡" iconBg={GREEN_LIGHT} />
          <StatTile value={String(stats.avgSessionsPerWeek)} label="Avg/week" valueColor={PURPLE} icon="📊" iconBg={PURPLE_LIGHT} isLast />
        </View>
      </View>

      {plan_id === "free" ? (
        <Pressable onPress={() => navigation.navigate("Subscription")} style={styles.proCta}>
          <View style={styles.proCtaIcon}>
            <Text style={styles.proCtaEmoji}>✨</Text>
          </View>
          <View style={styles.proCtaCopy}>
            <Text style={styles.proCtaTitle}>NexRep PRO</Text>
            <Text style={styles.proCtaSub}>Unlock AI tracking & premium coaching</Text>
          </View>
          <Text style={styles.proCtaArrow}>›</Text>
        </Pressable>
      ) : null}

      {userId ? (
        <SubscriptionBillingSection
          userId={userId}
          memberSince={memberSince}
          onExerciseHistory={() => setShowExerciseHistory(true)}
          onCalorieHistory={() => setShowCalorieHistory(true)}
        />
      ) : null}

      <View style={styles.footerCard}>
        {__DEV__ ? (
          <Pressable style={styles.footerRow} onPress={() => navigation.navigate("AdminStack")}>
            <View style={styles.footerIconTile}>
              <Text style={styles.footerEmoji}>🔧</Text>
            </View>
            <Text style={styles.footerLabel}>Go to Admin</Text>
            <Text style={styles.footerChevron}>›</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.footerRow}
          onPress={() => {
            setFeedbackSent(false);
            setFeedbackOpen(true);
          }}
        >
          <View style={styles.footerIconTile}>
            <Text style={styles.footerEmoji}>💬</Text>
          </View>
          <Text style={styles.footerLabel}>Feedback</Text>
          <Text style={styles.footerChevron}>›</Text>
        </Pressable>
        <TouchableOpacity
          onPress={handleVersionTap}
          activeOpacity={1}
          hitSlop={{ top: 20, bottom: 20, left: 40, right: 40 }}
          style={styles.versionWrap}
        >
          <Text style={styles.versionText}>Version {APP_VERSION}</Text>
        </TouchableOpacity>
        <Pressable style={[styles.footerRow, styles.footerRowLast]} onPress={() => void signOutSession()}>
          <View style={styles.logoutIconTile}>
            <Text style={styles.footerEmoji}>🚪</Text>
          </View>
          <Text style={styles.logoutText}>Logout</Text>
          <Text style={styles.logoutChevron}>›</Text>
        </Pressable>
      </View>

      <DevSubscriptionToggle email={userEmail} userId={userId} />

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
          <View style={styles.feedbackSheet}>
            {feedbackSent ? (
              <View style={styles.feedbackSentWrap}>
                <View style={[styles.feedbackTickCircle, { backgroundColor: "rgba(85,181,106,0.16)" }]}>
                  <Text style={styles.feedbackTick}>✓</Text>
                </View>
                <Text style={[styles.feedbackTitle, { textAlign: "center", marginBottom: 6 }]}>Sent successfully</Text>
                <Text style={[styles.feedbackSub, { textAlign: "center" }]}>
                  Your message was delivered to admin@nexrep.in
                </Text>
                <View style={styles.feedbackActions}>
                  <Pressable
                    style={styles.feedbackActionBtn}
                    onPress={() => {
                      setFeedbackOpen(false);
                      setFeedbackSent(false);
                      setFeedbackSubject("");
                      setFeedbackBody("");
                    }}
                  >
                    <Text style={styles.feedbackCancelText}>Close</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.feedbackTitle}>Send Feedback</Text>
                <Text style={styles.feedbackSub}>This will be sent to admin@nexrep.in</Text>
                <View style={styles.feedbackField}>
                  <Text style={styles.editLabel}>Subject</Text>
                  <TextInput
                    value={feedbackSubject}
                    onChangeText={setFeedbackSubject}
                    placeholder="Type subject"
                    placeholderTextColor={MUTED}
                    style={styles.feedbackInput}
                  />
                </View>
                <View style={styles.feedbackField}>
                  <Text style={styles.editLabel}>Body</Text>
                  <TextInput
                    value={feedbackBody}
                    onChangeText={setFeedbackBody}
                    placeholder="Write your feedback..."
                    placeholderTextColor={MUTED}
                    multiline
                    textAlignVertical="top"
                    style={styles.feedbackBodyInput}
                  />
                </View>
                <View style={styles.feedbackActions}>
                  <Pressable
                    style={styles.feedbackActionBtn}
                    onPress={() => setFeedbackOpen(false)}
                    disabled={sendingFeedback}
                  >
                    <Text style={styles.feedbackCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.feedbackActionBtn, styles.feedbackSendBtn]}
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

      <Modal visible={showExerciseHistory} transparent animationType="slide" onRequestClose={() => setShowExerciseHistory(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.historyOverlaySheet}>
            <View style={styles.historyOverlayHeader}>
              <Text style={styles.historyOverlayTitle}>Exercise History</Text>
              <Pressable style={styles.historyOverlayCloseBtn} onPress={() => setShowExerciseHistory(false)}>
                <Text style={styles.historyOverlayCloseText}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.historyOverlaySub}>Select From/To dates (max 30 days)</Text>
            <View style={styles.overlayRangeRow}>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("exercise", "from")}
              >
                <Text style={styles.overlayDateLabel}>From</Text>
                <Text style={styles.overlayDateValue}>{exerciseFromDate || "Select date"}</Text>
              </Pressable>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("exercise", "to")}
              >
                <Text style={styles.overlayDateLabel}>To</Text>
                <Text style={styles.overlayDateValue}>{exerciseToDate || "Select date"}</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.historyOverlayList} contentContainerStyle={styles.historyOverlayListContent}>
              {filteredExerciseHistory.map((row) => (
                <View key={`overlay-exercise-${row.date}`} style={styles.historyRowLine}>
                  <Text style={styles.historyDateText}>
                    {`${row.date}, ${
                      row.workouts.length > 0
                        ? row.workouts.map((workout) => `${workout.bodyPart} - ${workout.exerciseName}`).join(", ")
                        : "No exercises logged"
                    }`}
                  </Text>
                </View>
              ))}
              {filteredExerciseHistory.length === 0 ? <Text style={styles.historyEmptyText}>No exercise history in selected range.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showCalorieHistory} transparent animationType="slide" onRequestClose={() => setShowCalorieHistory(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.historyOverlaySheet}>
            <View style={styles.historyOverlayHeader}>
              <Text style={styles.historyOverlayTitle}>Calorie History</Text>
              <Pressable style={styles.historyOverlayCloseBtn} onPress={() => setShowCalorieHistory(false)}>
                <Text style={styles.historyOverlayCloseText}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.historyOverlaySub}>Select From/To dates (max 30 days)</Text>
            <View style={styles.overlayRangeRow}>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("calorie", "from")}
              >
                <Text style={styles.overlayDateLabel}>From</Text>
                <Text style={styles.overlayDateValue}>{calorieFromDate || "Select date"}</Text>
              </Pressable>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("calorie", "to")}
              >
                <Text style={styles.overlayDateLabel}>To</Text>
                <Text style={styles.overlayDateValue}>{calorieToDate || "Select date"}</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.historyOverlayList} contentContainerStyle={styles.historyOverlayListContent}>
              {filteredCalorieHistory.map((row) => (
                <View key={`overlay-calorie-${row.date}`} style={styles.historyRowLine}>
                  <Text style={styles.historyDateText}>{row.date}</Text>
                  <Text style={styles.historyValueText}>
                    Protein: {row.protein}g, Fat: {row.fat}g, Fibre: {row.fiber}g, Water: {row.water}L, Carbs: {row.carbs}g
                  </Text>
                </View>
              ))}
              {filteredCalorieHistory.length === 0 ? <Text style={styles.historyEmptyText}>No calorie history in selected range.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={activeDatePicker !== null && Platform.OS !== "android"} transparent animationType="fade" onRequestClose={() => setActiveDatePicker(null)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.datePickerSheet}>
            <Text style={styles.datePickerTitle}>
              Select {activeDatePicker?.field === "from" ? "From" : "To"} Date
            </Text>
            {Platform.OS === "web" ? (
              <View style={styles.webCalendarWrap}>
                <View style={styles.webCalendarHeader}>
                  <Pressable
                    style={styles.webMonthNavBtn}
                    onPress={() => setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                    disabled={monthStart(calendarCursor) <= monthStart(calendarNavBounds.minimumDate)}
                  >
                    <Text style={styles.webMonthNavText}>‹</Text>
                  </Pressable>
                  <Text style={styles.webCalendarMonth}>{monthLabel(calendarCursor)}</Text>
                  <Pressable
                    style={styles.webMonthNavBtn}
                    onPress={() => setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                    disabled={monthStart(calendarCursor) >= monthStart(calendarNavBounds.maximumDate)}
                  >
                    <Text style={styles.webMonthNavText}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.webWeekHeaderRow}>
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                    <Text key={d} style={styles.webWeekHeaderCell}>{d}</Text>
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
                            borderColor: BORDER,
                            backgroundColor: isSelected ? GREEN : BG,
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
                            { color: isSelected ? WHITE : cell.disabled ? MUTED : TEXT },
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
                textColor={TEXT}
              />
            )}
            <Pressable style={styles.datePickerDoneBtn} onPress={() => setActiveDatePicker(null)}>
              <Text style={styles.datePickerDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 28 },
  inlineHeader: { marginBottom: 14 },
  dateLabel: { color: MUTED, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  pageTitle: { color: TEXT, fontSize: 22, fontWeight: "900" },
  identityCard: { backgroundColor: GREEN, borderRadius: 20, padding: 20, marginBottom: 14, overflow: "hidden" },
  decorCircleTop: { position: "absolute", width: 150, height: 150, borderRadius: 75, backgroundColor: "rgba(255,255,255,0.05)", top: -68, right: -42 },
  decorCircleBottom: { position: "absolute", width: 112, height: 112, borderRadius: 56, backgroundColor: "rgba(255,255,255,0.05)", bottom: -52, left: -30 },
  identityTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarRingWrap: { width: 62, height: 62, alignItems: "center", justifyContent: "center" },
  avatarSvg: { position: "absolute" },
  avatarInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: WHITE, fontSize: 18, fontWeight: "900" },
  identityTextBlock: { flex: 1 },
  nameBadgeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  nameText: { color: WHITE, fontSize: 18, fontWeight: "900" },
  planBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4 },
  planBadgeElite: { backgroundColor: GOLD },
  planBadgePro: { backgroundColor: WHITE },
  planBadgeFree: { backgroundColor: MUTED },
  planBadgeText: { fontSize: 9, fontWeight: "900" },
  planBadgeEliteText: { color: TEXT },
  planBadgeProText: { color: GREEN },
  planBadgeFreeText: { color: TEXT },
  emailText: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 4 },
  memberMeta: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2, fontWeight: "700" },
  heroEditBtn: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  heroEditText: { color: WHITE, fontSize: 12, fontWeight: "900" },
  goalPillsRow: { flexDirection: "row", gap: 8, marginTop: 18 },
  heroTile: { flex: 1, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.12)", padding: 10 },
  heroTileLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "800" },
  heroTileValue: { color: WHITE, fontSize: 12, fontWeight: "900", marginTop: 4 },
  card: { backgroundColor: BG, borderRadius: 16, padding: 14, marginBottom: 14 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  cardTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  progressMuted: { color: MUTED, fontSize: 13, fontWeight: "900" },
  goalReachedPill: { backgroundColor: GREEN_LIGHT, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  goalReachedText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  weightPathRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  weightPoint: { alignItems: "center", minWidth: 58 },
  weightPointLabel: { color: MUTED, fontSize: 10, fontWeight: "800" },
  weightStartValue: { color: ORANGE, fontSize: 20, fontWeight: "900" },
  weightTargetValue: { color: GREEN, fontSize: 20, fontWeight: "900" },
  weightGradientTrack: { flex: 1, height: 8, borderRadius: 99, overflow: "hidden", flexDirection: "row" },
  weightGradientOrange: { flex: 1, backgroundColor: ORANGE },
  weightGradientGold: { flex: 1, backgroundColor: "#FFB800" },
  weightGradientGreen: { flex: 1, backgroundColor: GREEN },
  weightTilesRow: { flexDirection: "row", gap: 9 },
  currentWeightTile: { flex: 1, backgroundColor: WHITE, borderWidth: 1.5, borderColor: GREEN, borderRadius: 12, padding: 12 },
  tileMuted: { color: MUTED, fontSize: 11, fontWeight: "800" },
  currentWeightValue: { color: TEXT, fontSize: 22, fontWeight: "900", marginTop: 6 },
  weightFreshness: { color: MUTED, fontSize: 11, marginTop: 4, fontWeight: "700" },
  weightFreshnessToday: { color: GREEN },
  weightLoader: { marginTop: 10 },
  logWeightTile: { flex: 1, backgroundColor: GREEN_LIGHT, borderRadius: 12, padding: 12, alignItems: "center", justifyContent: "center" },
  logWeightEmoji: { fontSize: 20, marginBottom: 4 },
  logWeightText: { color: GREEN, fontSize: 14, fontWeight: "900" },
  logWeightSub: { color: MUTED, fontSize: 11, marginTop: 3, fontWeight: "700" },
  sectionLabel: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginBottom: 12 },
  activityStatsRow: { flexDirection: "row" },
  statTile: { flex: 1, alignItems: "center", paddingHorizontal: 6, borderRightWidth: 1, borderRightColor: BORDER },
  statTileLast: { borderRightWidth: 0 },
  statIconTile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 7 },
  statIcon: { fontSize: 18 },
  statValue: { fontSize: 17, fontWeight: "900", marginBottom: 2 },
  statLabel: { color: MUTED, fontSize: 10, textAlign: "center", fontWeight: "700" },
  proCta: { backgroundColor: GREEN_LIGHT, borderRadius: 16, padding: 14, marginBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  proCtaIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" },
  proCtaEmoji: { fontSize: 18 },
  proCtaCopy: { flex: 1 },
  proCtaTitle: { color: GREEN, fontSize: 16, fontWeight: "900" },
  proCtaSub: { color: TEXT, opacity: 0.55, fontSize: 12, marginTop: 3, fontWeight: "700" },
  proCtaArrow: { color: GREEN, fontSize: 24, fontWeight: "300" },
  footerCard: { backgroundColor: BG, borderRadius: 16, padding: 8, gap: 2, marginBottom: 14 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  footerRowLast: { borderBottomWidth: 0, backgroundColor: ORANGE_LIGHT, borderRadius: 12, marginTop: 2 },
  footerIconTile: { width: 34, height: 34, borderRadius: 10, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  logoutIconTile: { width: 34, height: 34, borderRadius: 10, backgroundColor: ORANGE_LIGHT, alignItems: "center", justifyContent: "center" },
  footerEmoji: { fontSize: 16 },
  footerLabel: { flex: 1, color: TEXT, fontSize: 13, fontWeight: "800" },
  footerChevron: { color: GREEN, fontSize: 20 },
  logoutText: { flex: 1, color: ORANGE, fontSize: 13, fontWeight: "900" },
  logoutChevron: { color: ORANGE, fontSize: 20 },
  versionWrap: { alignItems: "center", paddingVertical: 8 },
  versionText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  modalBackdropBottom: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" },
  weighInModal: { backgroundColor: WHITE, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  weighInModalTitle: { color: TEXT, fontSize: 18, fontWeight: "900", marginBottom: 4 },
  weighInModalSubtitle: { color: MUTED, fontSize: 13, marginBottom: 20 },
  weightInputRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 },
  weightInput: { fontSize: 48, fontWeight: "900", color: TEXT, textAlign: "center", minWidth: 120, borderBottomWidth: 2, borderBottomColor: GREEN, paddingBottom: 4 },
  weightUnit: { color: MUTED, fontSize: 20, marginTop: 16 },
  quickAdjustRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 },
  quickAdjustBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: BG },
  quickAdjustText: { color: GREEN, fontSize: 14, fontWeight: "900" },
  weighInLastRef: { color: MUTED, fontSize: 12, textAlign: "center", marginBottom: 20 },
  weighInActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  weighInCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: BG, alignItems: "center" },
  weighInCancelText: { color: MUTED, fontSize: 15, fontWeight: "800" },
  weighInSave: { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: GREEN, alignItems: "center" },
  weighInSaveDisabled: { opacity: 0.6 },
  weighInSaveText: { color: WHITE, fontSize: 15, fontWeight: "900" },
  feedbackSheet: { backgroundColor: WHITE, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  feedbackTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 4 },
  feedbackSub: { color: MUTED, fontSize: 11, marginBottom: 10 },
  feedbackField: { marginBottom: 10 },
  editLabel: { color: MUTED, fontSize: 10, marginBottom: 5, fontWeight: "800" },
  feedbackInput: { color: TEXT, borderWidth: 1.5, borderColor: BORDER, backgroundColor: WHITE, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  feedbackBodyInput: { color: TEXT, borderWidth: 1.5, borderColor: BORDER, backgroundColor: WHITE, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 13, minHeight: 110 },
  feedbackActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  feedbackActionBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: BORDER },
  feedbackSendBtn: { backgroundColor: GREEN, borderColor: GREEN },
  feedbackCancelText: { color: TEXT, fontSize: 13, fontWeight: "800" },
  feedbackSendText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  feedbackSentWrap: { alignItems: "center", paddingVertical: 6 },
  feedbackTickCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  feedbackTick: { color: GREEN, fontSize: 42, fontWeight: "900", lineHeight: 44 },
  historyOverlaySheet: { backgroundColor: WHITE, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: "82%" },
  historyOverlayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  historyOverlayTitle: { color: TEXT, fontSize: 16, fontWeight: "900" },
  historyOverlaySub: { color: MUTED, fontSize: 11, marginBottom: 8 },
  overlayRangeRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  overlayDateBtn: { flex: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: GREEN_LIGHT },
  overlayDateLabel: { color: MUTED, fontSize: 10, fontWeight: "800", marginBottom: 3 },
  overlayDateValue: { color: TEXT, fontSize: 12, fontWeight: "900" },
  historyOverlayCloseBtn: { backgroundColor: GREEN_LIGHT, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  historyOverlayCloseText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  historyOverlayList: { flexGrow: 0 },
  historyOverlayListContent: { paddingBottom: 8 },
  historyRowLine: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  historyDateText: { color: TEXT, fontSize: 12, fontWeight: "900", marginBottom: 2 },
  historyValueText: { color: MUTED, fontSize: 11, lineHeight: 16 },
  historyWorkoutText: { color: BLUE, fontSize: 11, lineHeight: 16, marginTop: 4, fontWeight: "800" },
  historyEmptyText: { color: MUTED, fontSize: 11, fontStyle: "italic", paddingVertical: 6 },
  datePickerSheet: { backgroundColor: WHITE, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  datePickerTitle: { color: TEXT, fontSize: 15, fontWeight: "900", marginBottom: 8, textAlign: "center" },
  webCalendarWrap: { marginBottom: 8 },
  webCalendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  webMonthNavBtn: { width: 34, height: 30, borderWidth: 1, borderColor: BORDER, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: BG },
  webMonthNavText: { color: TEXT, fontSize: 18, fontWeight: "900", lineHeight: 20 },
  webCalendarMonth: { color: TEXT, fontSize: 14, fontWeight: "900" },
  webWeekHeaderRow: { flexDirection: "row", marginBottom: 6 },
  webWeekHeaderCell: { flex: 1, color: MUTED, textAlign: "center", fontSize: 11, fontWeight: "800" },
  webGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  webDayCell: { width: "13.4%", aspectRatio: 1, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  webDayText: { fontSize: 12, fontWeight: "900" },
  datePickerDoneBtn: { backgroundColor: GREEN, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingVertical: 12, marginTop: 8 },
  datePickerDoneText: { color: WHITE, fontSize: 13, fontWeight: "900" },
});

const Tile = ({
  label,
  value,
  emoji,
}: {
  label: string;
  value: string;
  emoji?: string;
  variant?: "hero";
}) => (
  <View style={styles.heroTile}>
    <Text style={styles.heroTileLabel}>{emoji ? `${emoji} ` : ""}{label}</Text>
    <Text style={styles.heroTileValue}>{value}</Text>
  </View>
);

const StatTile = ({
  value,
  label,
  valueColor,
  icon,
  iconBg,
  isLast,
}: {
  value: string;
  label: string;
  valueColor: string;
  icon: string;
  iconBg: string;
  isLast?: boolean;
}) => (
  <View style={[styles.statTile, isLast && styles.statTileLast]}>
    <View style={[styles.statIconTile, { backgroundColor: iconBg }]}>
      <Text style={styles.statIcon}>{icon}</Text>
    </View>
    <Text style={[styles.statValue, { color: valueColor }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);
