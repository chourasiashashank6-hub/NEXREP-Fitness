import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  PermissionsAndroid,
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
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { apiClient, resolveApiBaseUrl } from "../api/client";
import { getDailyCalorieLog, todayLocal } from "../api/caloriesLog";
import { fetchOnboardingMe } from "../api/onboarding";
import { getStrengthProgress, type StrengthProgress } from "../api/strength";
import { getProfile, removeProfilePhoto, uploadProfilePhoto } from "../api/user";
import { getWorkoutHistory } from "../api/workout";
import { fetchWeightHistory } from "../api/weight";
import { ProfileXpCard } from "../components/ProfileXpCard";
import { ScreenContainer } from "../components/ScreenContainer";
import { UserAvatar } from "../components/UserAvatar";
import { useAuthStore } from "../store/authStore";
import { logicalRow, textAlignStart } from "../utils/rtl";
import { prepareFoodImagePayload } from "../utils/foodImagePayload";
import { confirmUser, notifyUser } from "../utils/notify";
import { usePoseCalibrationStore } from "../store/poseCalibrationStore";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { buildTransformationSummary, type TransformationSummary } from "../utils/buildTransformationSummary";

type GoalTag = "Fat Loss" | "Muscle Gain" | "Strength";

const goalColors: Record<GoalTag, { primary: string; bg: string; text: string }> = {
  "Fat Loss": { primary: "#E24B4A", bg: "#FCEBEB", text: "#791F1F" },
  "Muscle Gain": { primary: "#534AB7", bg: "#EEEDFE", text: "#26215C" },
  Strength: { primary: "#D85A30", bg: "#FAECE7", text: "#4A1B0C" },
};

const toGoalTag = (v: unknown): GoalTag => (v === "Muscle Gain" || v === "Strength" ? (v as GoalTag) : "Fat Loss");
const monthYear = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const getInitials = (first: string, last: string) => `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "U";
const numFmt = (n: number) => Math.round(n).toLocaleString();
const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY_WINDOW = 30;
const MAX_SELECTABLE_RANGE_DAYS = 30;
const CALENDAR_NAV_YEARS = 10;
const FOCUS_STALE_MS = 45_000;
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
const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_ALLOWED_MIME = new Set(["image/jpeg", "image/png"]);

const normalizeProfilePhotoMime = (mimeType?: string | null) => {
  const mime = String(mimeType || "image/jpeg").trim().toLowerCase();
  return mime === "image/jpg" || mime === "image/pjpeg" ? "image/jpeg" : mime;
};

const estimatedBase64Bytes = (base64: string) => {
  const clean = base64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
};

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

export const ProfileScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { hasFeatureAccess } = useFeatureAccess();
  const canCompareTransformation = hasFeatureAccess("progress_photo_comparison");

  const token = useAuthStore((s) => s.token);
  const plan_id = useAuthStore((s) => s.plan_id) ?? "free";
  const setPlanId = useAuthStore((s) => s.setPlanId);
  const setNeedsOnboarding = useAuthStore((s) => s.setNeedsOnboarding);
  const setReturnToProfileAfterOnboarding = useAuthStore((s) => s.setReturnToProfileAfterOnboarding);

  const [showExerciseHistory, setShowExerciseHistory] = useState(false);
  const [showCalorieHistory, setShowCalorieHistory] = useState(false);
  const [exerciseHistory15d, setExerciseHistory15d] = useState<DailyExerciseHistory[]>([]);
  const [calorieHistory15d, setCalorieHistory15d] = useState<DailyCalorieHistory[]>([]);
  const [exerciseFromDate, setExerciseFromDate] = useState("");
  const [exerciseToDate, setExerciseToDate] = useState("");
  const [calorieFromDate, setCalorieFromDate] = useState("");
  const [calorieToDate, setCalorieToDate] = useState("");
  const [activeDatePicker, setActiveDatePicker] = useState<{ overlay: "exercise" | "calorie"; field: "from" | "to" } | null>(null);
  const [calendarCursor, setCalendarCursor] = useState(new Date());
  const [registrationDateIso, setRegistrationDateIso] = useState<string>("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [profilePhotoSheetOpen, setProfilePhotoSheetOpen] = useState(false);
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false);
  const [memberSince, setMemberSince] = useState("");
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [profileWeightKg, setProfileWeightKg] = useState(70);
  const [targetWeightKg, setTargetWeightKg] = useState(65);
  const [startWeightKg, setStartWeightKg] = useState(70);
  const [goalType, setGoalType] = useState<OnboardingGoalType>("maintain");
  const [goalTag, setGoalTag] = useState<GoalTag>("Fat Loss");
  const [latestWeightLog, setLatestWeightLog] = useState<LatestWeightLog | null>(null);
  const [strengthProgress, setStrengthProgress] = useState<StrengthProgress | null>(null);
  const [loadingWeight, setLoadingWeight] = useState(true);
  const [showWeighInModal, setShowWeighInModal] = useState(false);
  const [weighInValue, setWeighInValue] = useState("");
  const [isLoggingWeight, setIsLoggingWeight] = useState(false);
  const [resettingJourney, setResettingJourney] = useState(false);
  const [transformationSummary, setTransformationSummary] = useState<TransformationSummary | null>(null);
  const [paceKgPerWeek, setPaceKgPerWeek] = useState(0.5);
  const [age, setAge] = useState(25);
  const [stats, setStats] = useState({
    totalWorkoutsDone: 0,
    totalKcalBurned: 0,
    currentDayStreak: 0,
    avgSessionsPerWeek: 0,
  });
  const lastCoreLoadAt = useRef(0);
  const historyLoadedRef = useRef(false);

  const loadHistoryData = useCallback(async () => {
    const dates15 = listPastDates(DAY_WINDOW);
    const [workoutHistory15d, calorieLogs15d] = await Promise.all([
      getWorkoutHistory(24 * DAY_WINDOW).catch(() => ({ items: [] })),
      Promise.all(dates15.map((date) => getDailyCalorieLog(date).catch(() => null))),
    ]);

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

    setExerciseHistory15d(
      dates15.map((date) => ({
        date,
        caloriesBurned: round1(workoutsByDate.get(date)?.caloriesBurned || 0),
        workouts: workoutsByDate.get(date)?.workouts || [],
      })),
    );
    setCalorieHistory15d(
      dates15.map((date) => {
        const nutrition = calorieByDate.get(date);
        return {
          date,
          protein: nutrition?.protein || 0,
          fat: nutrition?.fat || 0,
          fiber: nutrition?.fiber || 0,
          water: nutrition?.water || 0,
          carbs: nutrition?.carbs || 0,
        };
      }),
    );
    historyLoadedRef.current = true;
  }, []);

  const load = useCallback(async (force = false) => {
    try {
      const [profile, onboardingRes, burnRes, historyRes, strengthProgressRes] = await Promise.all([
        getProfile(),
        fetchOnboardingMe().catch(() => null),
        apiClient.get<{ totalCaloriesBurned: number; sessionCount: number }>("/workout/total-burn").catch(() => ({ data: { totalCaloriesBurned: 0, sessionCount: 0 } })),
        apiClient.get<{ items: Array<{ date: string }> }>("/workout/history", { params: { hours: 24 * 30 } }).catch(() => ({ data: { items: [] } })),
        getStrengthProgress().catch(() => null),
      ]);
      const dates15 = listPastDates(DAY_WINDOW);

      const fullName = String(profile.name || "").trim();
      const [f = "", ...rest] = fullName.split(" ");
      const l = rest.join(" ");
      const ob = onboardingRes?.onboarding;
      const targetWeightLb = ob?.goal?.target_weight_lb;
      const personalWithLegacyStart = ob?.personal as
        | ({ weight_kg?: number | null; start_weight_kg?: number | null } | undefined);
      const targetKg = Number(ob?.goal?.target_weight_kg ?? (targetWeightLb != null ? targetWeightLb / 2.20462 : undefined) ?? profile.weight ?? 0);
      const startKg = Number(personalWithLegacyStart?.start_weight_kg ?? ob?.personal?.weight_kg ?? profile.weight ?? 0);
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

      setFirstName(f || "User");
      setLastName(l || "");
      setUserEmail(String(profile.email || ""));
      setProfilePhotoUrl(profile.profilePhotoUrl ?? profile.profile_photo_url ?? null);
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
      setStrengthProgress(strengthProgressRes);
      setPaceKgPerWeek(pace);
      setAge(Number(profile.age || 25));
      setMemberSince(monthYear(new Date().toISOString()));
      setStats({
        totalWorkoutsDone: sessionCount,
        totalKcalBurned: Number(burnRes.data.totalCaloriesBurned || 0),
        currentDayStreak: streak,
        avgSessionsPerWeek: avgSessions,
      });
      const baseFrom = dates15[dates15.length - 1] || dates15[0] || "";
      const defaultTo = dates15[0] || "";
      const effectiveRegistration = registrationIso || baseFrom;
      const defaultFrom = baseFrom && effectiveRegistration ? (baseFrom < effectiveRegistration ? effectiveRegistration : baseFrom) : baseFrom;
      setRegistrationDateIso(effectiveRegistration);
      setExerciseFromDate((prev) => prev || defaultFrom);
      setExerciseToDate((prev) => prev || defaultTo);
      setCalorieFromDate((prev) => prev || defaultFrom);
      setCalorieToDate((prev) => prev || defaultTo);
      lastCoreLoadAt.current = Date.now();

      if (canCompareTransformation) {
        const toDate = toIsoLocalDate(new Date());
        const from = new Date();
        from.setDate(from.getDate() - 90);
        const fromDate = toIsoLocalDate(from);
        const [weightRes, workoutRes] = await Promise.all([
          fetchWeightHistory(365).catch(() => ({ entries: [] })),
          getWorkoutHistory({ range: "all", limit: 500 }).catch(() => ({ items: [] })),
        ]);
        setTransformationSummary(
          buildTransformationSummary({
            fromDate,
            toDate,
            weightEntries: (weightRes.entries ?? []).map((entry) => ({
              log_date: entry.log_date,
              weight_kg: entry.weight_kg,
            })),
            strengthProgress: strengthProgressRes,
            workoutItems: workoutRes.items ?? [],
          }),
        );
      } else {
        setTransformationSummary(null);
      }
    } catch {
      Alert.alert(t("profile.alerts.error"), t("profile.alerts.loadFailed"));
    }
  }, [t, canCompareTransformation]);

  const handleResetJourney = useCallback(() => {
    void (async () => {
      const confirmed = await confirmUser(
        "Reset journey?",
        "This sets your journey start date to today and restarts your 26-week progress tracking. Your weight history is not deleted.",
        "Reset",
      );
      if (!confirmed || !token) return;

      setResettingJourney(true);
      try {
        const res = await fetch(`${resolveApiBaseUrl()}/api/goal/reset-journey`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) throw new Error("Reset failed");
        await load(true);
      } catch {
        notifyUser("Error", "Could not reset journey. Please try again.");
      } finally {
        setResettingJourney(false);
      }
    })();
  }, [load, token]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (lastCoreLoadAt.current > 0 && now - lastCoreLoadAt.current < FOCUS_STALE_MS) {
        return;
      }
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!showExerciseHistory && !showCalorieHistory) return;
    if (historyLoadedRef.current) return;
    void loadHistoryData();
  }, [showExerciseHistory, showCalorieHistory, loadHistoryData]);

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

  const askPhotoPermissionSettings = () => {
    Alert.alert("Permission needed", "Allow photo access in settings to update your profile photo.", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: "Open settings",
        onPress: () => {
          void Linking.openSettings();
        },
      },
    ]);
  };

  const requestAndroidPermission = async (permission: Parameters<typeof PermissionsAndroid.request>[0]): Promise<boolean> => {
    if (Platform.OS !== "android") return true;
    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const waitForPhotoSheetToClose = () => new Promise<void>((resolve) => setTimeout(resolve, 180));

  const deriveBase64FromUri = async (uri?: string): Promise<string | null> => {
    if (!uri || Platform.OS !== "web") return null;
    try {
      const commaIdx = uri.indexOf(",");
      if (uri.startsWith("data:") && commaIdx > 0) {
        return uri.slice(commaIdx + 1);
      }
      const response = await fetch(uri);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read the selected image."));
        reader.readAsDataURL(blob);
      });
      const dataCommaIdx = dataUrl.indexOf(",");
      return dataCommaIdx >= 0 ? dataUrl.slice(dataCommaIdx + 1) : null;
    } catch {
      return null;
    }
  };

  const deriveBase64FromWebFile = async (file?: File): Promise<string | null> => {
    if (!file || Platform.OS !== "web") return null;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read the selected image."));
        reader.readAsDataURL(file);
      });
      const commaIdx = dataUrl.indexOf(",");
      return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : null;
    } catch {
      return null;
    }
  };

  const resolvePhotoAssetBase64 = async (asset?: ImagePicker.ImagePickerAsset): Promise<string | null> => {
    if (!asset) return null;
    if (asset.base64) return asset.base64;
    const webFile = (asset as ImagePicker.ImagePickerAsset & { file?: File }).file;
    return (await deriveBase64FromWebFile(webFile)) || (await deriveBase64FromUri(asset.uri));
  };

  const uploadSelectedProfilePhoto = async (asset?: ImagePicker.ImagePickerAsset) => {
    if (!asset || profilePhotoUploading) return;
    const mimeType = normalizeProfilePhotoMime(asset.mimeType);
    if (!PROFILE_PHOTO_ALLOWED_MIME.has(mimeType)) {
      Alert.alert("Unsupported image", "Please choose a JPG or PNG image.");
      return;
    }
    const resolvedBase64 = await resolvePhotoAssetBase64(asset);
    if (!resolvedBase64) {
      Alert.alert("Image error", "Could not read this image. Please choose another photo.");
      return;
    }
    const prepared = await prepareFoodImagePayload(resolvedBase64, mimeType);
    const preparedMime = normalizeProfilePhotoMime(prepared.mimeType);
    if (!PROFILE_PHOTO_ALLOWED_MIME.has(preparedMime)) {
      Alert.alert("Unsupported image", "Please choose a JPG or PNG image.");
      return;
    }
    if (estimatedBase64Bytes(prepared.base64) > PROFILE_PHOTO_MAX_BYTES) {
      Alert.alert("Photo too large", "Profile photo must be 5MB or smaller.");
      return;
    }
    try {
      setProfilePhotoUploading(true);
      const updated = await uploadProfilePhoto({ base64: prepared.base64, mimeType: preparedMime });
      setProfilePhotoUrl(updated.profilePhotoUrl ?? updated.profile_photo_url ?? null);
    } catch (error) {
      const message =
        error && typeof error === "object" && "response" in error
          ? String((error as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : "";
      Alert.alert("Upload failed", message || "Could not update your profile photo.");
    } finally {
      setProfilePhotoUploading(false);
    }
  };

  const selectProfilePhoto = async (source: "camera" | "library") => {
    setProfilePhotoSheetOpen(false);
    if (Platform.OS !== "web") {
      await waitForPhotoSheetToClose();
    }
    try {
      if (source === "camera") {
        const cameraGranted = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (!cameraGranted) {
          askPhotoPermissionSettings();
          return;
        }
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          askPhotoPermissionSettings();
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: Platform.OS === "web" ? 0.65 : 0.75,
          base64: true,
          exif: false,
          cameraType: ImagePicker.CameraType.front,
        });
        if (!result.canceled) {
          await uploadSelectedProfilePhoto(result.assets?.[0]);
        }
        return;
      }

      if (Platform.OS === "android") {
        const galleryPermission =
          Platform.Version >= 33
            ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
            : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
        const granted = await requestAndroidPermission(galleryPermission);
        if (!granted) {
          askPhotoPermissionSettings();
          return;
        }
      }
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        askPhotoPermissionSettings();
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: Platform.OS === "web" ? 0.65 : 0.75,
        base64: true,
        exif: false,
      });
      if (!result.canceled) {
        await uploadSelectedProfilePhoto(result.assets?.[0]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open the image picker.";
      Alert.alert("Photo error", message);
    }
  };

  const removeCurrentProfilePhoto = async () => {
    setProfilePhotoSheetOpen(false);
    try {
      setProfilePhotoUploading(true);
      const updated = await removeProfilePhoto();
      setProfilePhotoUrl(updated.profilePhotoUrl ?? updated.profile_photo_url ?? null);
    } catch (error) {
      const message =
        error && typeof error === "object" && "response" in error
          ? String((error as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : "";
      Alert.alert("Remove failed", message || "Could not remove your profile photo.");
    } finally {
      setProfilePhotoUploading(false);
    }
  };

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
      ? t("profile.progress.weightLoss")
      : goalType === "muscle_gain"
        ? t("profile.progress.weightGain")
        : goalType === "strength"
          ? t("profile.progress.strength")
          : goalTag === "Fat Loss"
            ? t("profile.progress.weightLoss")
            : goalTag === "Muscle Gain"
              ? t("profile.progress.weightGain")
              : t("profile.progress.bodyRecomp");

  const progressCenterLabel =
    progressPct === 0
      ? t("profile.progress.zero")
      : progressPct >= 100
        ? t("profile.progress.goalReached")
        : t("profile.progress.progressWithKg", { percent: progressPct, kg: kgAchieved, direction: goalType === "fat_loss" ? t("profile.progress.lost") : t("profile.progress.gained") });

  const handleLogWeight = async () => {
    const kg = parseFloat(weighInValue);
    if (!kg || kg <= 0 || kg > 500) {
      Alert.alert(t("profile.alerts.invalid"), t("profile.alerts.invalidWeight"));
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

      if (!res.ok) throw new Error(t("profile.alerts.saveFailed"));
      const data = await res.json();

      setLatestWeightLog({
        weight_kg: kg,
        log_date: todayLocal(),
        days_since_log: 0,
        has_logs: true,
      });
      setProfileWeightKg(kg);

      if (data.change_label) {
        Alert.alert(t("profile.alerts.logged"), data.change_label);
      }

      setShowWeighInModal(false);
    } catch {
      Alert.alert(t("profile.alerts.error"), t("profile.alerts.saveWeightFailed"));
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
      Alert.alert(t("profile.alerts.rangeAdjusted"), t("profile.alerts.rangeLimit"));
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

  const planBadgeLabel = (plan_id || "free").toUpperCase();
  const planBadgeStyle =
    planBadgeLabel === "ELITE" ? styles.planBadgeElite : planBadgeLabel === "PRO" ? styles.planBadgePro : styles.planBadgeFree;
  const planBadgeTextStyle =
    planBadgeLabel === "ELITE" ? styles.planBadgeEliteText : planBadgeLabel === "PRO" ? styles.planBadgeProText : styles.planBadgeFreeText;
  const avatarRadius = 28;
  const avatarCircumference = 2 * Math.PI * avatarRadius;
  const avatarOffset = avatarCircumference * (1 - Math.max(0, Math.min(100, progressPct)) / 100);
  const dailyAdjustmentLabel = `${dailyCalorieAdjustment > 0 ? "+" : "−"}${Math.abs(Math.round(dailyCalorieAdjustment))} kcal`;
  const isStrengthGoal = goalType === "strength";
  const strengthLifts = strengthProgress?.lifts.slice(0, 3) ?? [];

  return (
    <ScreenContainer bg={SCREEN_BG} contentStyle={styles.screenContent}>
      <StatusBar barStyle="dark-content" backgroundColor={SCREEN_BG} />
      <View style={styles.inlineHeader}>
        <Text style={styles.pageTitle}>{t("profile.title")}</Text>
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Update profile photo"
              onPress={() => setProfilePhotoSheetOpen(true)}
              disabled={profilePhotoUploading}
              style={styles.avatarPressable}
            >
              <UserAvatar
                name={`${firstName} ${lastName}`}
                initials={getInitials(firstName, lastName)}
                profilePhotoUrl={profilePhotoUrl}
                style={styles.avatarInner}
                textStyle={styles.avatarText}
              />
              <View style={styles.avatarCameraBadge}>
                {profilePhotoUploading ? (
                  <ActivityIndicator size="small" color={GREEN} />
                ) : (
                  <Ionicons name="camera" size={12} color={GREEN} />
                )}
              </View>
            </Pressable>
          </View>
          <View style={styles.identityTextBlock}>
            <View style={styles.nameBadgeRow}>
              <Text style={styles.nameText}>{`${firstName} ${lastName}`.trim()}</Text>
              <View style={[styles.planBadge, planBadgeStyle]}>
                <Text style={[styles.planBadgeText, planBadgeTextStyle]}>{planBadgeLabel}</Text>
              </View>
            </View>
            {userEmail ? <Text style={styles.emailText}>{userEmail}</Text> : null}
            <Text style={styles.memberMeta}>{`${difficulty} · ${memberSince || t("profile.member")}`}</Text>
          </View>
          <View style={styles.heroHeaderActions}>
            <Pressable
              style={styles.heroGearBtn}
              onPress={() => navigation.navigate("Settings")}
              accessibilityRole="button"
              accessibilityLabel={t("settings.screenTitle")}
            >
              <Ionicons name="settings-outline" size={18} color={WHITE} />
            </Pressable>
            <Pressable
              style={styles.heroEditBtn}
              onPress={() => {
                setReturnToProfileAfterOnboarding(true);
                setNeedsOnboarding(true);
              }}
            >
              <Text style={styles.heroEditText}>{t("profile.edit")}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.goalPillsRow}>
          <Tile label={t("profile.goal")} value={goalTag} emoji="🔥" variant="hero" />
          <Tile label={dailyCalorieAdjustment < 0 ? t("profile.deficit") : t("profile.surplus")} value={dailyAdjustmentLabel} emoji="⚡" variant="hero" />
          <Tile label={t("profile.pace")} value={t("profile.paceValue", { pace: paceKgPerWeek })} emoji="📉" variant="hero" />
        </View>
      </View>

      <View style={styles.card}>
        {isStrengthGoal ? (
          <>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{t("profile.strengthJourney")}</Text>
              {strengthProgress?.has_target_lifts ? (
                <Text style={styles.progressMuted}>{t("profile.avg", { percent: strengthProgress.overall_percent })}</Text>
              ) : null}
            </View>
            {strengthProgress?.has_target_lifts ? (
              <View style={styles.strengthRows}>
                {strengthLifts.map((lift) => (
                  <View key={lift.exercise_name} style={styles.strengthLiftRow}>
                    <View style={styles.strengthLiftHeader}>
                      <Text style={styles.strengthLiftName}>{lift.exercise_name}</Text>
                      <Text style={[styles.strengthLiftPercent, lift.percent >= 100 ? styles.strengthLiftComplete : null]}>
                        {lift.percent}%
                      </Text>
                    </View>
                    <View style={styles.strengthProgressTrack}>
                      <View
                        style={[
                          styles.strengthProgressFill,
                          { width: `${Math.max(0, Math.min(100, lift.percent))}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.strengthLiftMeta}>
                      {t("profile.targetKg", { current: round1(lift.current_best_1rm_kg), target: round1(lift.target_weight_kg) })}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.strengthEmptyBox}>
                <Text style={styles.strengthEmptyTitle}>{t("profile.strengthEmptyTitle")}</Text>
                <Text style={styles.strengthEmptyText}>
                  {t("profile.strengthEmptyBody")}
                </Text>
              </View>
            )}
          </>
        ) : (
          <>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{t("profile.weightJourney")}</Text>
              {progressPct >= 100 ? (
                <View style={styles.goalReachedPill}>
                  <Text style={styles.goalReachedText}>{t("profile.goalReachedPill")}</Text>
                </View>
              ) : (
                <Text style={styles.progressMuted}>{progressPct}%</Text>
              )}
            </View>
            <View style={styles.weightPathRow}>
              <View style={styles.weightPoint}>
                <Text style={styles.weightPointLabel}>{t("profile.start")}</Text>
                <Text style={styles.weightStartValue}>{round1(startWeightKg)}</Text>
              </View>
              <View style={styles.weightGradientTrack}>
                <View style={styles.weightGradientOrange} />
                <View style={styles.weightGradientGold} />
                <View style={styles.weightGradientGreen} />
              </View>
              <View style={styles.weightPoint}>
                <Text style={styles.weightPointLabel}>{t("profile.target")}</Text>
                <Text style={styles.weightTargetValue}>{round1(targetWeightKg)}</Text>
              </View>
            </View>
            <View style={styles.weightTilesRow}>
              <View style={styles.currentWeightTile}>
                <Text style={styles.tileMuted}>{t("profile.current")}</Text>
                {loadingWeight ? (
                  <ActivityIndicator size="small" color={GREEN} style={styles.weightLoader} />
                ) : (
                  <>
                    <Text style={styles.currentWeightValue}>{round1(displayCurrentWeight)} kg</Text>
                    {latestWeightLog?.log_date ? (
                      <Text style={[styles.weightFreshness, latestWeightLog.days_since_log === 0 && styles.weightFreshnessToday]}>
                        {latestWeightLog.days_since_log === 0 ? t("profile.updatedToday") : t("profile.daysAgo", { count: latestWeightLog.days_since_log })}
                      </Text>
                    ) : (
                      <Text style={styles.weightFreshness}>{t("profile.fromProfile")}</Text>
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
                <Text style={styles.logWeightText}>{t("profile.logWeight")}</Text>
                <Text style={styles.logWeightSub}>
                  {latestWeightLog?.has_logs ? t("profile.lastWeight", { weight: round1(latestWeightLog.weight_kg) }) : t("profile.startTracking")}
                </Text>
              </Pressable>
            </View>
            <TouchableOpacity
              onPress={handleResetJourney}
              disabled={resettingJourney}
              style={styles.resetJourneyBtn}
            >
              {resettingJourney ? (
                <ActivityIndicator size="small" color="#9CA3AF" />
              ) : (
                <Text style={styles.resetJourneyTxt}>↺ Reset journey start date</Text>
              )}
            </TouchableOpacity>
            {canCompareTransformation && transformationSummary ? (
              <>
                <View style={styles.journeyDivider} />
                <View style={styles.transformationHeaderRow}>
                  <Ionicons name="camera-outline" size={14} color={PURPLE} />
                  <Text style={styles.transformationHeaderText}>{t("profile.weightJourneyTransformation.title")}</Text>
                </View>
                <View style={styles.transformationStatsRow}>
                  <View style={styles.transformationStatBox}>
                    <Text style={styles.transformationStatLabel}>{t("profile.weightJourneyTransformation.workouts")}</Text>
                    <Text style={styles.transformationStatValue}>{transformationSummary.workoutCount}</Text>
                  </View>
                  <View style={styles.transformationStatBox}>
                    <Text style={styles.transformationStatLabel}>{t("profile.weightJourneyTransformation.newPrs")}</Text>
                    <Text style={styles.transformationStatValue}>{transformationSummary.prCount}</Text>
                  </View>
                </View>
                <Pressable
                  style={styles.viewTimelineRow}
                  onPress={() => navigation.navigate("TransformationTimeline")}
                  accessibilityRole="button"
                >
                  <Text style={styles.viewTimelineText}>{t("profile.weightJourneyTransformation.viewTimeline")}</Text>
                  <Text style={styles.viewTimelineChevron}>›</Text>
                </Pressable>
              </>
            ) : null}
          </>
        )}
      </View>

      <ProfileXpCard />

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>{t("profile.activityOverview")}</Text>
        <View style={styles.activityStatsRow}>
          <StatTile value={numFmt(stats.totalWorkoutsDone)} label={t("profile.workouts")} valueColor={BLUE} icon="🏋️" iconBg={BLUE_LIGHT} />
          <StatTile value={numFmt(stats.totalKcalBurned)} label={t("profile.kcalBurned")} valueColor={ORANGE} icon="🔥" iconBg={ORANGE_LIGHT} />
          <StatTile value={numFmt(stats.currentDayStreak)} label={t("profile.dayStreak")} valueColor={GREEN} icon="⚡" iconBg={GREEN_LIGHT} />
          <StatTile value={String(stats.avgSessionsPerWeek)} label={t("profile.avgPerWeek")} valueColor={PURPLE} icon="📊" iconBg={PURPLE_LIGHT} isLast />
        </View>
      </View>

      <Modal visible={showWeighInModal} transparent animationType="slide" onRequestClose={() => setShowWeighInModal(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.weighInModal}>
            <Text style={styles.weighInModalTitle}>{t("profile.logWeightTitle")}</Text>
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
              <Text style={styles.weighInLastRef}>{t("profile.lastLogged", { weight: round1(latestWeightLog.weight_kg) })}</Text>
            ) : null}

            <View style={styles.weighInActions}>
              <TouchableOpacity style={styles.weighInCancel} onPress={() => setShowWeighInModal(false)}>
                <Text style={styles.weighInCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.weighInSave, isLoggingWeight && styles.weighInSaveDisabled]}
                onPress={() => void handleLogWeight()}
                disabled={isLoggingWeight}
              >
                {isLoggingWeight ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.weighInSaveText}>{t("common.save")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showExerciseHistory} transparent animationType="slide" onRequestClose={() => setShowExerciseHistory(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.historyOverlaySheet}>
            <View style={styles.historyOverlayHeader}>
              <Text style={styles.historyOverlayTitle}>{t("profile.exerciseHistory")}</Text>
              <Pressable style={styles.historyOverlayCloseBtn} onPress={() => setShowExerciseHistory(false)}>
                <Text style={styles.historyOverlayCloseText}>{t("profile.close")}</Text>
              </Pressable>
            </View>
            <Text style={styles.historyOverlaySub}>{t("profile.historySub")}</Text>
            <View style={styles.overlayRangeRow}>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("exercise", "from")}
              >
                <Text style={styles.overlayDateLabel}>{t("profile.from")}</Text>
                <Text style={styles.overlayDateValue}>{exerciseFromDate || t("profile.selectDate")}</Text>
              </Pressable>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("exercise", "to")}
              >
                <Text style={styles.overlayDateLabel}>{t("profile.to")}</Text>
                <Text style={styles.overlayDateValue}>{exerciseToDate || t("profile.selectDate")}</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.historyOverlayList} contentContainerStyle={styles.historyOverlayListContent}>
              {filteredExerciseHistory.map((row) => (
                <View key={`overlay-exercise-${row.date}`} style={styles.historyRowLine}>
                  <Text style={styles.historyDateText}>
                    {`${row.date}, ${
                      row.workouts.length > 0
                        ? row.workouts.map((workout) => `${workout.bodyPart} - ${workout.exerciseName}`).join(", ")
                        : t("profile.noExercisesLogged")
                    }`}
                  </Text>
                </View>
              ))}
              {filteredExerciseHistory.length === 0 ? <Text style={styles.historyEmptyText}>{t("profile.emptyExerciseHistory")}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showCalorieHistory} transparent animationType="slide" onRequestClose={() => setShowCalorieHistory(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.historyOverlaySheet}>
            <View style={styles.historyOverlayHeader}>
              <Text style={styles.historyOverlayTitle}>{t("profile.calorieHistory")}</Text>
              <Pressable style={styles.historyOverlayCloseBtn} onPress={() => setShowCalorieHistory(false)}>
                <Text style={styles.historyOverlayCloseText}>{t("profile.close")}</Text>
              </Pressable>
            </View>
            <Text style={styles.historyOverlaySub}>{t("profile.historySub")}</Text>
            <View style={styles.overlayRangeRow}>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("calorie", "from")}
              >
                <Text style={styles.overlayDateLabel}>{t("profile.from")}</Text>
                <Text style={styles.overlayDateValue}>{calorieFromDate || t("profile.selectDate")}</Text>
              </Pressable>
              <Pressable
                style={styles.overlayDateBtn}
                onPress={() => openDateSelector("calorie", "to")}
              >
                <Text style={styles.overlayDateLabel}>{t("profile.to")}</Text>
                <Text style={styles.overlayDateValue}>{calorieToDate || t("profile.selectDate")}</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.historyOverlayList} contentContainerStyle={styles.historyOverlayListContent}>
              {filteredCalorieHistory.map((row) => (
                <View key={`overlay-calorie-${row.date}`} style={styles.historyRowLine}>
                  <Text style={styles.historyDateText}>{row.date}</Text>
                  <Text style={styles.historyValueText}>
                    {t("profile.calorieHistoryLine", { protein: row.protein, fat: row.fat, fiber: row.fiber, water: row.water, carbs: row.carbs })}
                  </Text>
                </View>
              ))}
              {filteredCalorieHistory.length === 0 ? <Text style={styles.historyEmptyText}>{t("profile.emptyCalorieHistory")}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={activeDatePicker !== null && Platform.OS !== "android"} transparent animationType="fade" onRequestClose={() => setActiveDatePicker(null)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.datePickerSheet}>
            <Text style={styles.datePickerTitle}>
              {t("profile.selectDateTitle", { field: activeDatePicker?.field === "from" ? t("profile.from") : t("profile.to") })}
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
                  {[
                    t("profile.weekdays.mo"),
                    t("profile.weekdays.tu"),
                    t("profile.weekdays.we"),
                    t("profile.weekdays.th"),
                    t("profile.weekdays.fr"),
                    t("profile.weekdays.sa"),
                    t("profile.weekdays.su"),
                  ].map((d) => (
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
              <Text style={styles.datePickerDoneText}>{t("profile.done")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={profilePhotoSheetOpen} transparent animationType="fade" onRequestClose={() => setProfilePhotoSheetOpen(false)}>
        <View style={styles.modalBackdropBottom}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setProfilePhotoSheetOpen(false)} />
          <View style={styles.profilePhotoSheet}>
            <View style={styles.profilePhotoHandle} />
            <Text style={styles.profilePhotoTitle}>Profile photo</Text>
            <Text style={styles.profilePhotoSubtitle}>Use a JPG or PNG up to 5MB.</Text>
            <View style={styles.profilePhotoOptions}>
              <Pressable style={styles.profilePhotoOption} onPress={() => void selectProfilePhoto("library")}>
                <View style={styles.profilePhotoOptionIcon}>
                  <Ionicons name="image-outline" size={18} color={GREEN} />
                </View>
                <Text style={styles.profilePhotoOptionText}>Choose from library</Text>
              </Pressable>
              {Platform.OS !== "web" ? (
                <Pressable style={styles.profilePhotoOption} onPress={() => void selectProfilePhoto("camera")}>
                  <View style={styles.profilePhotoOptionIcon}>
                    <Ionicons name="camera-outline" size={18} color={GREEN} />
                  </View>
                  <Text style={styles.profilePhotoOptionText}>Take photo</Text>
                </Pressable>
              ) : null}
              {profilePhotoUrl ? (
                <Pressable style={[styles.profilePhotoOption, styles.profilePhotoRemoveOption]} onPress={() => void removeCurrentProfilePhoto()}>
                  <View style={[styles.profilePhotoOptionIcon, styles.profilePhotoRemoveIcon]}>
                    <Ionicons name="trash-outline" size={18} color={ORANGE} />
                  </View>
                  <Text style={[styles.profilePhotoOptionText, styles.profilePhotoRemoveText]}>Remove current photo</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 28 },
  inlineHeader: { marginBottom: 14 },
  pageTitle: { color: TEXT, fontSize: 25, fontWeight: "800" },
  identityCard: { backgroundColor: GREEN, borderRadius: 20, padding: 20, marginBottom: 14, overflow: "hidden" },
  decorCircleTop: { position: "absolute", width: 150, height: 150, borderRadius: 75, backgroundColor: "rgba(255,255,255,0.05)", top: -68, right: -42 },
  decorCircleBottom: { position: "absolute", width: 112, height: 112, borderRadius: 56, backgroundColor: "rgba(255,255,255,0.05)", bottom: -52, left: -30 },
  identityTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarRingWrap: { width: 62, height: 62, alignItems: "center", justifyContent: "center" },
  avatarSvg: { position: "absolute" },
  avatarPressable: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  avatarInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: WHITE, fontSize: 18, fontWeight: "900" },
  avatarCameraBadge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: WHITE,
    borderWidth: 2,
    borderColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  identityTextBlock: { flex: 1 },
  nameBadgeRow: { flexDirection: logicalRow, alignItems: "center", gap: 8, flexWrap: "wrap" },
  nameText: { color: WHITE, fontSize: 18, fontWeight: "900" },
  planBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4, maxWidth: "100%" },
  planBadgeElite: { backgroundColor: GOLD },
  planBadgePro: { backgroundColor: WHITE },
  planBadgeFree: { backgroundColor: MUTED },
  planBadgeText: { fontSize: 9, fontWeight: "900", textAlign: "center" },
  planBadgeEliteText: { color: TEXT },
  planBadgeProText: { color: GREEN },
  planBadgeFreeText: { color: TEXT },
  emailText: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 4 },
  memberMeta: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2, fontWeight: "700" },
  heroHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroGearBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
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
  resetJourneyBtn: { alignSelf: "center", marginTop: 12, paddingVertical: 6, paddingHorizontal: 12 },
  resetJourneyTxt: { fontSize: 12, color: "#9CA3AF", textDecorationLine: "underline" },
  journeyDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
    marginTop: 14,
    marginBottom: 12,
  },
  transformationHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  transformationHeaderText: { color: PURPLE, fontSize: 12, fontWeight: "900" },
  transformationStatsRow: { flexDirection: "row", gap: 10 },
  transformationStatBox: {
    flex: 1,
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  transformationStatLabel: { color: MUTED, fontSize: 11, fontWeight: "700" },
  transformationStatValue: { color: TEXT, fontSize: 20, fontWeight: "900", marginTop: 4 },
  viewTimelineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingVertical: 4,
  },
  viewTimelineText: { color: GREEN, fontSize: 14, fontWeight: "800" },
  viewTimelineChevron: { color: GREEN, fontSize: 22, fontWeight: "300" },
  logWeightEmoji: { fontSize: 20, marginBottom: 4 },
  logWeightText: { color: GREEN, fontSize: 14, fontWeight: "900" },
  logWeightSub: { color: MUTED, fontSize: 11, marginTop: 3, fontWeight: "700" },
  strengthRows: { gap: 12 },
  strengthLiftRow: { backgroundColor: WHITE, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER },
  strengthLiftHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  strengthLiftName: { color: TEXT, fontSize: 14, fontWeight: "900", flex: 1 },
  strengthLiftPercent: { color: ORANGE, fontSize: 14, fontWeight: "900" },
  strengthLiftComplete: { color: GREEN },
  strengthProgressTrack: {
    height: 6,
    borderRadius: 99,
    backgroundColor: TRACK,
    overflow: "hidden",
    marginTop: 9,
  },
  strengthProgressFill: { height: 6, borderRadius: 99, backgroundColor: GREEN },
  strengthLiftMeta: { color: MUTED, fontSize: 11, fontWeight: "700", marginTop: 7 },
  strengthEmptyBox: { backgroundColor: WHITE, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER },
  strengthEmptyTitle: { color: TEXT, fontSize: 13, fontWeight: "900", marginBottom: 4 },
  strengthEmptyText: { color: MUTED, fontSize: 11, lineHeight: 16 },
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
  subscriptionsButton: {
    borderRadius: 16,
    padding: 15,
    flexDirection: logicalRow,
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
  },
  subscriptionsCopy: { flex: 1, minWidth: 0 },
  subscriptionsIconTile: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  subscriptionsTitleRow: { flexDirection: logicalRow, alignItems: "center", gap: 7, flexWrap: "wrap" },
  subscriptionsTitle: { flexShrink: 1, minWidth: 0, fontSize: 14, lineHeight: 17, fontWeight: "800", textAlign: textAlignStart },
  subscriptionsPlanBadge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, maxWidth: "100%" },
  subscriptionsPlanBadgeText: { fontSize: 9, lineHeight: 11, fontWeight: "800", textAlign: "center" },
  subscriptionsSubtitle: { fontSize: 10, lineHeight: 14, marginTop: 2, textAlign: textAlignStart },
  footerCard: { backgroundColor: BG, borderRadius: 16, padding: 8, gap: 2, marginBottom: 14 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  footerPickerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  footerPickerContent: { flex: 1, gap: 8 },
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
  profilePhotoSheet: { backgroundColor: WHITE, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  profilePhotoHandle: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: BORDER, marginBottom: 14 },
  profilePhotoTitle: { color: TEXT, fontSize: 18, fontWeight: "900", textAlign: "center" },
  profilePhotoSubtitle: { color: MUTED, fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 4, marginBottom: 16 },
  profilePhotoOptions: { gap: 10 },
  profilePhotoOption: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
  },
  profilePhotoOptionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" },
  profilePhotoOptionText: { color: TEXT, fontSize: 14, fontWeight: "900" },
  profilePhotoRemoveOption: { backgroundColor: ORANGE_LIGHT, borderColor: "rgba(216,90,48,0.2)" },
  profilePhotoRemoveIcon: { backgroundColor: WHITE },
  profilePhotoRemoveText: { color: ORANGE },
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
