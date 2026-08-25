import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  addWorkout,
  deleteWorkout,
  estimateWorkoutCalories,
  getWorkoutCatalogFiltered,
  getWorkoutHistory,
  updateWorkout,
  type WorkoutHistoryItem,
} from "../api/workout";
import { fetchWorkoutPlanCurrent } from "../api/workoutPlanner";
import { fetchOnboardingMe } from "../api/onboarding";
import { isPreWorkoutEnabled } from "../utils/preWorkoutPreference";
import { deleteStrengthLift, logStrengthLift, updateStrengthLift } from "../api/strength";
import { getProfile } from "../api/user";
import { fetchWeightLatest } from "../api/weight";
import { apiClient } from "../api/client";
import { localDateIso } from "../utils/localDate";
import { resolveDailyBurnTarget } from "../utils/dailyBurnTarget";
import {
  computePlannedBurnActivities,
  computePlannedBurnTargets,
  toPreworkoutProfile,
  type PlannedBurnActivity,
} from "../utils/plannedBurnTargets";
import { isHomeRestDayActive } from "../utils/workoutRestDay";
import AllTimeHistoryModal from "../components/AllTimeHistoryModal";
import { AppInput } from "../components/AppInput";
import ExerciseSearchInput from "../components/ExerciseSearchInput";
import { CameraGuidedSessionFrame } from "../components/aiTrainer/CameraGuidedSessionFrame";
import { LogPlannerSegment, type LogPlannerMode } from "../components/LogPlannerSegment";
import { SwipeTabPager } from "../components/SwipeTabPager";
import { PlannerLockedUpsell } from "../components/PlannerLockedUpsell";
import { SessionTypePickerModal } from "../components/SessionTypePickerModal";
import { unlockWebSpeech } from "../services/aiTrainer/audioCoach";
import type { GlobalExercise } from "../constants/GlobalExercisesData";
import {
  EXERCISE_GUIDANCE,
  type ExerciseGuidance,
} from "../constants/ExerciseGuidanceData";
import { useLanguageStore } from "../i18n/languageStore";
import { useCameraTracking } from "../hooks/useCameraTracking";
import { useSubscriptionStore } from "../store/subscriptionStore";
import { useAuthStore } from "../store/authStore";
import { usePoseCalibrationStore } from "../store/poseCalibrationStore";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import type { WorkoutPlanCurrent } from "../types/planner";
import type { MainTabParamList } from "../navigation/types";
import { useAppTheme } from "../theme";
import { formatDate } from "../utils/date";
import {
  isActiveSessionPartialLog,
  isGuidedWarmupLog,
  resolveWorkoutLogSource,
  WORKOUT_LOG_SOURCE_I18N_KEY,
  type WorkoutLogSource,
} from "../utils/workoutLogSource";
import { allPlannerExercisesLogged } from "../utils/workoutPlannerLog";
import {
  buildTodaySessionMilestoneItems,
  sessionMilestonePlannedFilled,
  sessionMilestonePlannedTarget,
} from "../utils/sessionMilestoneSlots";
import { sanitizeWorkoutPlanCurrent } from "../utils/sanitizePlannerDay";
import { resolveBurnTargetWeightKg } from "../utils/resolveBurnTargetWeightKg";
import { navigationRef } from "../navigation/navigationRef";
import MonthlyWorkoutPlannerScreen from "./Coach/MonthlyWorkoutPlannerScreen";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const PURPLE = "#534AB7";
const PURPLE_LIGHT = "#F3F0FB";
const PURPLE_BORDER = "#AFA9EC";
const PURPLE_NUDGE = "#EEEDFE";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#E2E2DD";
const DANGER = "#E85B5B";
const BURN_TARGET_FALLBACK = 200;
const FOCUS_STALE_MS = 45_000;

const CHIP_DROPDOWN_COLORS = {
  text: TEXT,
  muted: MUTED,
  border: BORDER,
  cardAlt: WHITE,
  tabBg: BG,
  primary: GREEN,
  inputBg: WHITE,
};
const CHIP_RADIUS = { md: 10, lg: 16 };

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SELECT_CHOICE = i18n.t("workoutLog.selectChoice");
const GUIDANCE_PLACEHOLDERS = new Set(["select choice", "default", "no choice", "none", ""]);
const NO_CHOICE_VALUES = new Set(["select choice", "default", "no choice", "none", ""]);

const workoutTypeFromGlobalCategory = (category: string): WorkoutPayloadType => {
  const normalized = category.trim().toLowerCase();
  if (normalized === "cardio") return "hiit";
  if (normalized === "flexibility") return "stability";
  return "compound";
};

const workoutTypeFromCatalog = (catalogType: string): WorkoutPayloadType => {
  const normalized = catalogType.trim().toLowerCase();
  if (normalized === "cardio" || normalized === "hiit") return "hiit";
  if (normalized === "stability" || normalized === "flexibility") return "stability";
  return "compound";
};

const sameExerciseName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const pickBestCatalogEntry = (
  items: WorkoutCatalogItem[],
  {
    exerciseName,
    bodyPart,
    type,
    recommendation,
    activeGoalTag,
    activeDifficulty,
  }: {
    exerciseName: string;
    bodyPart: string;
    type: string;
    recommendation: string;
    activeGoalTag: string;
    activeDifficulty: string;
  },
): WorkoutCatalogItem | undefined => {
  const candidates = items.filter((item) => sameExerciseName(item.exerciseName, exerciseName));
  if (!candidates.length) return undefined;

  const scoreEntry = (item: WorkoutCatalogItem) => {
    let score = 0;
    if (bodyPart !== SELECT_CHOICE && item.bodyPart === bodyPart) score += 8;
    if (type !== SELECT_CHOICE && item.type === type) score += 4;
    if (recommendation !== SELECT_CHOICE && item.recommendation === recommendation) score += 2;
    if (activeGoalTag !== SELECT_CHOICE && item.goalTag === activeGoalTag) score += 3;
    if (activeDifficulty !== SELECT_CHOICE && item.difficulty === activeDifficulty) score += 3;
    return score;
  };

  return [...candidates].sort((a, b) => scoreEntry(b) - scoreEntry(a))[0];
};
type WorkoutPayloadType = "stability" | "hiit" | "compound";
type DifficultyLabel = "Beginner" | "Intermediate" | "Advanced";
type WorkoutCatalogItem = {
  id?: number;
  globalExerciseId?: number | null;
  bodyPart: string;
  type: string;
  goalTag: string;
  difficulty: string;
  metValue?: number;
  exerciseName: string;
  defaultExerciseName?: string;
  equipment: string;
  recommendation: string;
  sets: string;
  reps: string;
  duration: number | string;
  recommendedWeightKg?: {
    beginner?: string;
    intermediate?: string;
    advanced?: string;
  };
};

type CatalogResponse = {
  items: WorkoutCatalogItem[];
  options: {
    bodyPart: string[];
    type: string[];
    goalTag: string[];
    difficulty: string[];
    exerciseName: string[];
    recommendation: string[];
  };
};

const normalizeDifficultyLabel = (value: unknown): DifficultyLabel | null => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "beginner") return "Beginner";
  if (raw === "intermediate") return "Intermediate";
  if (raw === "advanced") return "Advanced";
  return null;
};

const parseBodyPartFromNotes = (notes?: string | null): string => {
  if (!notes) return "";
  const match = String(notes).match(/body_part=([^;]+)/i);
  return match?.[1]?.trim() || "";
};

const WORKOUT_SOURCE_BADGE_STYLE: Record<
  WorkoutLogSource,
  { backgroundColor: string; color: string }
> = {
  manual: { backgroundColor: "#EEF2F7", color: "#475569" },
  workout_planner: { backgroundColor: "#FFF1EE", color: "#993C1D" },
  guided_warmup: { backgroundColor: "#F0EEF9", color: "#7B68CC" },
  active_session: { backgroundColor: "#E8F5EE", color: "#0F6E56" },
};

const sessionHistoryLabel = (item: WorkoutHistoryItem): string => {
  const explicit = typeof item.bodyPart === "string" ? item.bodyPart.trim() : "";
  const body = explicit || parseBodyPartFromNotes(item.notes) || i18n.t("workoutLog.body");
  const name = String(item.exerciseName || i18n.t("workoutLog.exerciseFallback")).trim() || i18n.t("workoutLog.exerciseFallback");
  const kcal = Math.round(Number(item.caloriesBurned) || 0);
  return `${body}  ${name}, ${kcal} kcal`;
};

const parseServerDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  // Backend often returns naive ISO timestamps; treat them as UTC for stable day matching.
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(raw) && !/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateKey = (value: unknown): string | null => {
  const parsed = parseServerDate(value);
  if (!parsed) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function normalizeExerciseName(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findExerciseGuidance(exerciseName?: string): ExerciseGuidance | null {
  const normalizedTarget = normalizeExerciseName(exerciseName);
  if (!normalizedTarget || GUIDANCE_PLACEHOLDERS.has(normalizedTarget)) {
    return null;
  }
  const exact = EXERCISE_GUIDANCE.find(
    (record) => normalizeExerciseName(record.exerciseName) === normalizedTarget,
  );
  if (exact) return exact;
  const partial = EXERCISE_GUIDANCE.find((record) => {
    const candidate = normalizeExerciseName(record.exerciseName);
    return (
      candidate &&
      (candidate.includes(normalizedTarget) || normalizedTarget.includes(candidate))
    );
  });
  return partial || null;
}

function bodyPartEmoji(bodyPart: string): string {
  const p = bodyPart.toLowerCase();
  if (p.includes("chest")) return "🫁";
  if (p.includes("back")) return "🔙";
  if (p.includes("leg") || p.includes("quad") || p.includes("ham")) return "🦵";
  if (p.includes("arm") || p.includes("bicep") || p.includes("tricep")) return "💪";
  if (p.includes("shoulder")) return "🏋️";
  if (p.includes("core") || p.includes("ab")) return "🧘";
  if (p.includes("cardio")) return "❤️";
  return "💪";
}

const ChipDropdownField = ({
  value,
  options,
  enabled = true,
  onChange,
  placeholder = i18n.t("workoutLog.selectChoice"),
}: {
  value: string;
  options: string[];
  enabled?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
}) => {
  const [open, setOpen] = useState(false);
  const isPlaceholder = value === SELECT_CHOICE;
  const displayValue = isPlaceholder ? placeholder : value;
  const selected = !isPlaceholder;

  const toggleOpen = () => {
    if (!enabled) return;
    LayoutAnimation.easeInEaseOut();
    setOpen((prev) => !prev);
  };

  return (
    <View style={styles.chipDropdownWrap}>
      <Pressable
        style={[
          styles.chipField,
          selected ? styles.chipFieldSelected : styles.chipFieldIdle,
          !enabled ? styles.chipFieldDisabled : null,
        ]}
        disabled={!enabled}
        onPress={toggleOpen}
      >
        <Text
          style={[styles.chipFieldText, selected ? styles.chipFieldTextSelected : styles.chipFieldTextIdle]}
          numberOfLines={1}
        >
          {displayValue}
        </Text>
        <Text style={[styles.chipChevron, selected ? styles.chipChevronSelected : styles.chipChevronIdle]}>
          {open ? "▴" : "▾"}
        </Text>
      </Pressable>
      {open && enabled ? (
        <View style={styles.chipOptionsCard}>
          <ScrollView nestedScrollEnabled style={styles.chipOptionsScroll} keyboardShouldPersistTaps="always">
            {[SELECT_CHOICE, ...options].map((option, index, all) => (
              <Pressable
                key={`${option}-${index}`}
                style={[styles.chipOptionRow, index === all.length - 1 ? styles.chipOptionRowLast : null]}
                onPress={() => {
                  onChange(option);
                  LayoutAnimation.easeInEaseOut();
                  setOpen(false);
                }}
              >
                <Text style={[styles.chipOptionText, option === value ? styles.chipOptionTextActive : null]}>
                  {option === SELECT_CHOICE ? placeholder : option}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

const EditModalInput = ({
  label,
  labelTone = "default",
  ...inputProps
}: TextInputProps & { label: string; labelTone?: "default" | "green" }) => (
  <View style={styles.editInputWrap}>
    <Text style={[styles.editInputLabel, labelTone === "green" ? styles.editInputLabelGreen : null]}>{label}</Text>
    <TextInput
      {...inputProps}
      style={[styles.editTextInput, inputProps.style]}
      placeholderTextColor="#9A9A91"
      selectionColor={GREEN}
    />
  </View>
);

export const WorkoutScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<MainTabParamList, "Workout">>();
  const language = useLanguageStore((s) => s.language);
  const { colors, radius } = useAppTheme();
  const tier = useSubscriptionStore((s) => s.subscription?.tier);
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const { hasFeatureAccess } = useFeatureAccess();
  const hasWorkoutPlannerAccess = hasFeatureAccess("workout_plan_generation");
  const [viewMode, setViewMode] = useState<LogPlannerMode>("log");
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const [todayPlan, setTodayPlan] = useState<WorkoutPlanCurrent | null>(null);
  const [userWeightKg, setUserWeightKg] = useState(70);
  const [burnTargetKcal, setBurnTargetKcal] = useState(BURN_TARGET_FALLBACK);
  const [onboardingForBurn, setOnboardingForBurn] = useState<{
    goal?: { type?: string; pace?: string; difficulty?: string };
    personal?: { weight_kg?: number; weight_lb?: number; unit_system?: string };
    app_setup?: { pre_workout_enabled?: boolean };
  } | null>(null);
  const [catalog, setCatalog] = useState<WorkoutCatalogItem[]>([]);
  const [bodyPartOptions, setBodyPartOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [goalTagOptions, setGoalTagOptions] = useState<string[]>([]);
  const [difficultyOptions, setDifficultyOptions] = useState<string[]>([]);
  const [exerciseOptions, setExerciseOptions] = useState<string[]>([]);
  const [recommendationOptions, setRecommendationOptions] = useState<string[]>([]);

  const [profileGoalTag, setProfileGoalTag] = useState(SELECT_CHOICE);
  const [profileDifficulty, setProfileDifficulty] = useState(SELECT_CHOICE);
  const [goalTag, setGoalTag] = useState(SELECT_CHOICE);
  const [difficulty, setDifficulty] = useState(SELECT_CHOICE);
  const [bodyPart, setBodyPart] = useState(SELECT_CHOICE);
  const [type, setType] = useState(SELECT_CHOICE);
  const [exerciseName, setExerciseName] = useState(SELECT_CHOICE);
  const [selectedGlobalExercise, setSelectedGlobalExercise] = useState<GlobalExercise | null>(null);
  const [recommendation, setRecommendation] = useState(SELECT_CHOICE);
  const [performedSets, setPerformedSets] = useState("");
  const [performedRepsPerSet, setPerformedRepsPerSet] = useState("");
  const [topSetWeightKg, setTopSetWeightKg] = useState("");
  const [topSetReps, setTopSetReps] = useState("");
  const [timeTaken, setTimeTaken] = useState("");
  const [isStrengthGoal, setIsStrengthGoal] = useState(false);
  const [durationPickerOpen, setDurationPickerOpen] = useState(false);
  const [pickerMinutes, setPickerMinutes] = useState(0);
  const [pickerSeconds, setPickerSeconds] = useState(0);
  const [history, setHistory] = useState<WorkoutHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [allTimeHistoryOpen, setAllTimeHistoryOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSets, setEditSets] = useState("");
  const [editReps, setEditReps] = useState("");
  const [editTimeTaken, setEditTimeTaken] = useState("");
  const [editExerciseName, setEditExerciseName] = useState("");
  const [editTopSetWeightKg, setEditTopSetWeightKg] = useState("");
  const [editTopSetReps, setEditTopSetReps] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const needsCalBanner = usePoseCalibrationStore((s) => s.skipped && !s.hasCalibration());
  const needsRecalibration = usePoseCalibrationStore((s) => s.needsRecalibration);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [mediaPipeReady, setMediaPipeReady] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [estimateKcal, setEstimateKcal] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const lastAutoFilledExerciseRef = useRef<string | null>(null);
  const workoutInputsEditedRef = useRef(false);
  const lastFocusLoadAt = useRef(0);

  const isNoChoice = (value: string) => NO_CHOICE_VALUES.has((value || "").trim().toLowerCase());
  const needsGoalTagInput = isNoChoice(profileGoalTag);
  const needsDifficultyInput = isNoChoice(profileDifficulty);
  const activeGoalTag = needsGoalTagInput ? goalTag : profileGoalTag;
  const activeDifficulty = needsDifficultyInput ? difficulty : profileDifficulty;

  const selectedEntry = useMemo(() => {
    if (exerciseName === SELECT_CHOICE) return undefined;
    return pickBestCatalogEntry(catalog, {
      exerciseName,
      bodyPart,
      type,
      recommendation,
      activeGoalTag,
      activeDifficulty,
    });
  }, [catalog, bodyPart, type, activeGoalTag, activeDifficulty, exerciseName, recommendation]);

  useEffect(() => {
    if (selectedGlobalExercise !== null) return;

    if (selectedEntry?.recommendation) {
      setRecommendation(selectedEntry.recommendation);
      return;
    }
    if (recommendationOptions.length > 0) {
      setRecommendation((prev) => (recommendationOptions.includes(prev) ? prev : recommendationOptions[0]));
      return;
    }
    if (exerciseName === SELECT_CHOICE) {
      setRecommendation(SELECT_CHOICE);
    }
  }, [selectedEntry, recommendationOptions, exerciseName, selectedGlobalExercise]);

  const recommendedWeight = useMemo(() => {
    if (!selectedEntry) return SELECT_CHOICE;
    const difficultyKey = (
      activeDifficulty !== SELECT_CHOICE ? activeDifficulty : selectedEntry.difficulty
    ).toLowerCase() as "beginner" | "intermediate" | "advanced";
  return selectedEntry.recommendedWeightKg?.[difficultyKey] || i18n.t("workoutLog.notSpecified");
  }, [selectedEntry, activeDifficulty]);

  useEffect(() => {
    if (!selectedEntry) {
      lastAutoFilledExerciseRef.current = null;
      workoutInputsEditedRef.current = false;
      return;
    }
    const autofillKey = String(selectedEntry.id ?? selectedEntry.exerciseName);
    if (lastAutoFilledExerciseRef.current === autofillKey) return;
    if (workoutInputsEditedRef.current) {
      lastAutoFilledExerciseRef.current = autofillKey;
      return;
    }
    lastAutoFilledExerciseRef.current = autofillKey;
    const firstNumber = (value: string) => {
      const match = String(value || "").match(/\d+/);
      return match ? match[0] : "";
    };
    const nextSets = firstNumber(selectedEntry.sets);
    const nextReps = firstNumber(selectedEntry.reps);
    setPerformedSets(nextSets);
    setPerformedRepsPerSet(nextReps);
  }, [selectedEntry]);

  const handlePerformedSetsChange = useCallback((value: string) => {
    workoutInputsEditedRef.current = true;
    setPerformedSets(value.replace(/\D/g, ""));
  }, []);

  const handlePerformedRepsChange = useCallback((value: string) => {
    workoutInputsEditedRef.current = true;
    setPerformedRepsPerSet(value.replace(/\D/g, ""));
  }, []);

  const handleTopSetWeightChange = useCallback((value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    setTopSetWeightKg(rest.length ? `${whole}.${rest.join("").slice(0, 1)}` : whole);
  }, []);

  const handleTopSetRepsChange = useCallback((value: string) => {
    setTopSetReps(value.replace(/\D/g, ""));
  }, []);

  const handleEditTopSetWeightChange = useCallback((value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    setEditTopSetWeightKg(rest.length ? `${whole}.${rest.join("").slice(0, 1)}` : whole);
  }, []);

  useEffect(() => {
    setGuideOpen(false);
  }, [exerciseName]);

  const fetchCatalog = async (
    params: {
    bodyPart?: string;
    type?: string;
    goalTag?: string;
    difficulty?: string;
    exerciseName?: string;
    },
    options?: { preserveExerciseOptions?: boolean },
  ) => {
    const data: CatalogResponse = await getWorkoutCatalogFiltered(params);
    setCatalog(data.items ?? []);
    setBodyPartOptions(data.options?.bodyPart ?? []);
    setTypeOptions(data.options?.type ?? []);
    setGoalTagOptions(data.options?.goalTag ?? []);
    setDifficultyOptions(data.options?.difficulty ?? []);
    const shouldPreserveExerciseOptions = options?.preserveExerciseOptions || Boolean(params.exerciseName);
    if (!shouldPreserveExerciseOptions) {
      setExerciseOptions(data.options?.exerciseName ?? []);
    }
    setRecommendationOptions(data.options?.recommendation ?? []);
    return data;
  };

  const buildFilterParams = (override: {
    bodyPart?: string;
    type?: string;
    goalTag?: string;
    difficulty?: string;
    exerciseName?: string;
  } = {}) => ({
    bodyPart: override.bodyPart,
    type: override.type,
    exerciseName: override.exerciseName,
    goalTag:
      (override.goalTag && override.goalTag !== SELECT_CHOICE
        ? override.goalTag
        : activeGoalTag && activeGoalTag !== SELECT_CHOICE
          ? activeGoalTag
          : undefined),
    difficulty:
      (override.difficulty && override.difficulty !== SELECT_CHOICE
        ? override.difficulty
        : activeDifficulty && activeDifficulty !== SELECT_CHOICE
          ? activeDifficulty
          : undefined),
  });

  const loadInitial = async (options?: { preservePlannerState?: boolean }) => {
    try {
      const [historyData, profileData, onboardingData, goalProgressRes, weightLatestRes] = await Promise.all([
        getWorkoutHistory(24 * 7),
        getProfile(),
        fetchOnboardingMe().catch(() => null),
        apiClient
          .get(`/api/goal-progress`, { params: { local_date: localDateIso() } })
          .then((r) => r.data)
          .catch(() => null),
        fetchWeightLatest().catch(() => null),
      ]);
      setHistory(historyData.items ?? []);
      setOnboardingForBurn(onboardingData?.onboarding ?? null);
      setBurnTargetKcal(
        resolveDailyBurnTarget({
          exercise_delta_kcal: goalProgressRes?.exercise_delta_kcal,
          daily_delta_kcal: goalProgressRes?.daily_delta_kcal,
          timeline:
            (goalProgressRes?.timeline as Record<string, unknown> | undefined) ??
            (onboardingData?.targets?.timeline as unknown as Record<string, unknown> | undefined) ??
            null,
        }),
      );
      const resolvedGoalTag = profileData.goalTag || SELECT_CHOICE;
      const onboardingGoalType = String(onboardingData?.onboarding?.goal?.type || "").toLowerCase();
      const onboardingDifficulty = normalizeDifficultyLabel(onboardingData?.onboarding?.goal?.difficulty);
      const profileDifficulty = normalizeDifficultyLabel(profileData.difficulty);
      const resolvedDifficulty = onboardingDifficulty || profileDifficulty || SELECT_CHOICE;
      const nextIsStrengthGoal =
        onboardingGoalType === "strength" || String(resolvedGoalTag).toLowerCase() === "strength";
      setProfileGoalTag(resolvedGoalTag);
      setProfileDifficulty(resolvedDifficulty);
      setIsStrengthGoal(nextIsStrengthGoal);
      const profileWeightKg = Number((profileData as { weight?: number; weight_kg?: number }).weight ?? (profileData as { weight_kg?: number }).weight_kg);
      const burnWeightKg = resolveBurnTargetWeightKg({
        weightLatest: weightLatestRes,
        profileWeightKg,
        onboardingWeightKg: onboardingData?.onboarding?.personal?.weight_kg,
      });
      setUserWeightKg(burnWeightKg);
      if (!nextIsStrengthGoal) {
        setTopSetWeightKg("");
        setTopSetReps("");
      }
      if (!options?.preservePlannerState) {
        setGoalTag(SELECT_CHOICE);
        setDifficulty(SELECT_CHOICE);
      }

      const nextGoalTag = needsGoalTagInput ? goalTag : resolvedGoalTag;
      const nextDifficulty = needsDifficultyInput ? difficulty : resolvedDifficulty;
      const effectiveGoalTag = isNoChoice(nextGoalTag) ? undefined : nextGoalTag;
      const effectiveDifficulty = isNoChoice(nextDifficulty) ? undefined : nextDifficulty;
      const currentBodyPart = bodyPart === SELECT_CHOICE ? undefined : bodyPart;
      const currentExerciseName = exerciseName === SELECT_CHOICE ? undefined : exerciseName;
      const currentType = type === SELECT_CHOICE ? undefined : type;

      await fetchCatalog(
        {
          goalTag: effectiveGoalTag,
          difficulty: effectiveDifficulty,
          bodyPart: currentBodyPart,
          exerciseName: currentExerciseName,
          type: currentType,
        },
        { preserveExerciseOptions: Boolean(currentExerciseName) },
      );
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : t("workoutLog.alerts.loadFailed");
      Alert.alert(t("workoutLog.alerts.error"), String(message));
    }
  };

  useEffect(() => {
    loadInitial();
  }, [language]);

  useEffect(() => {
    if (sessionUserId) void fetchSubscription(String(sessionUserId));
  }, [sessionUserId, fetchSubscription]);

  useEffect(() => {
    fetchWorkoutPlanCurrent()
      .then((plan) => setTodayPlan(sanitizeWorkoutPlanCurrent(plan)))
      .catch(() => setTodayPlan(null));
  }, [language]);

  useFocusEffect(
    useCallback(() => {
      setShowHistory(false);
      setTodayKey(toDateKey(new Date()));
      const now = Date.now();
      if (lastFocusLoadAt.current === 0 || now - lastFocusLoadAt.current >= FOCUS_STALE_MS) {
        void loadInitial({ preservePlannerState: true }).finally(() => {
          lastFocusLoadAt.current = Date.now();
        });
        fetchWorkoutPlanCurrent()
          .then((plan) => setTodayPlan(sanitizeWorkoutPlanCurrent(plan)))
          .catch(() => setTodayPlan(null));
      }
    }, [needsGoalTagInput, needsDifficultyInput, language]),
  );

  useFocusEffect(
    useCallback(() => {
      const view = route.params?.view;
      if (view === "planner" || view === "log") {
        setViewMode(view);
      }
    }, [route.params?.view]),
  );

  const selectViewMode = useCallback((mode: LogPlannerMode) => {
    setViewMode(mode);
  }, []);

  const parsedTimeTaken = useMemo(() => {
    const trimmed = timeTaken.trim();
    const match = /^(\d{1,3}):(\d{1,2})$/.exec(trimmed);
    if (!match) return null;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || seconds < 0 || seconds > 59) return null;
    return { minutes, seconds };
  }, [timeTaken]);

  const isValidTimeTaken = useMemo(() => parsedTimeTaken !== null, [parsedTimeTaken]);

  const setupStepsFilled = useMemo(() => {
    let n = 0;
    const filtersOk =
      (!needsGoalTagInput || goalTag !== SELECT_CHOICE) && (!needsDifficultyInput || difficulty !== SELECT_CHOICE);
    if (filtersOk) n += 1;
    if (bodyPart !== SELECT_CHOICE) n += 1;
    if (exerciseName !== SELECT_CHOICE) n += 1;
    if (performedSets.length > 0 && performedRepsPerSet.length > 0 && isValidTimeTaken) n += 1;
    return n;
  }, [
    needsGoalTagInput,
    needsDifficultyInput,
    goalTag,
    difficulty,
    bodyPart,
    exerciseName,
    performedSets,
    performedRepsPerSet,
    isValidTimeTaken,
  ]);

  const timeRangeError = useMemo(() => {
    const trimmed = timeTaken.trim();
    if (!trimmed) return "";
    const match = /^(\d{1,3}):(\d{1,2})$/.exec(trimmed);
    if (!match) return "";
    const seconds = Number(match[2]);
    if (seconds > 59) return t("workoutLog.timeRangeError");
    return "";
  }, [timeTaken]);

  const toDurationMinutes = (value: string) => {
    const parsed = /^(\d{1,3}):(\d{1,2})$/.exec(value.trim());
    if (!parsed) return 1;
    const minutes = Number(parsed[1]);
    const seconds = Number(parsed[2]);
    return Math.max(1, Math.round(minutes + seconds / 60));
  };

  const toTimeTaken = (durationMin: number | null | undefined) => {
    const mins = Math.max(0, Number(durationMin) || 0);
    return `${mins}:00`;
  };

  const applyExerciseSelection = async (
    value: string,
    globalExercise?: GlobalExercise | null,
    catalogId?: number | null,
  ) => {
    workoutInputsEditedRef.current = false;

    if (value === SELECT_CHOICE) {
      setSelectedGlobalExercise(null);
      setExerciseName(SELECT_CHOICE);
      setType(SELECT_CHOICE);
      setRecommendation(SELECT_CHOICE);
      await fetchCatalog(buildFilterParams({ bodyPart, goalTag, difficulty }));
      return;
    }

    setExerciseName(value);
    setSelectedGlobalExercise(globalExercise ?? null);

    let data = await fetchCatalog(buildFilterParams({ bodyPart, exerciseName: value, goalTag, difficulty }));
    let items = data.items ?? [];
    if (!items.length) {
      data = await fetchCatalog(buildFilterParams({ exerciseName: value, goalTag, difficulty }));
      items = data.items ?? [];
    }
    if (!items.length) {
      data = await fetchCatalog(buildFilterParams({ exerciseName: value }));
      items = data.items ?? [];
    }

    const best =
      catalogId != null
        ? items.find((item) => item.id === catalogId) ??
          pickBestCatalogEntry(items, {
            exerciseName: value,
            bodyPart,
            type,
            recommendation,
            activeGoalTag,
            activeDifficulty,
          })
        : pickBestCatalogEntry(items, {
            exerciseName: value,
            bodyPart,
            type,
            recommendation,
            activeGoalTag,
            activeDifficulty,
          });

    if (best) {
      setSelectedGlobalExercise(null);
      if (best.bodyPart && best.bodyPart !== bodyPart) {
        setBodyPart(best.bodyPart);
      }
      setType(best.type);
      setRecommendation(best.recommendation);
      await fetchCatalog(
        buildFilterParams({
          bodyPart: best.bodyPart,
          type: best.type,
          exerciseName: best.exerciseName,
          goalTag,
          difficulty,
        }),
        { preserveExerciseOptions: true },
      );
      return;
    }

    if (globalExercise) {
      setType(globalExercise.is_compound ? t("workoutLog.compound") : t("workoutLog.isolation"));
      setRecommendation(t("workoutLog.defaultRecommendation"));
      return;
    }

    setType(SELECT_CHOICE);
    setRecommendation(SELECT_CHOICE);
  };

  const handleCatalogExerciseSelect = async (value: string, catalogId?: number) => {
    await applyExerciseSelection(value, null, catalogId);
  };

  const handleGlobalExerciseSelect = async (exercise: GlobalExercise) => {
    if (exercise.catalog_id != null) {
      const catalogName =
        exerciseOptions.find((name) => sameExerciseName(name, exercise.name)) ?? exercise.name;
      await applyExerciseSelection(catalogName, null, exercise.catalog_id);
      return;
    }
    setExerciseName(exercise.name);
    setSelectedGlobalExercise(exercise);
    setType(exercise.is_compound ? t("workoutLog.compound") : t("workoutLog.isolation"));
    setRecommendation(t("workoutLog.defaultRecommendation"));
  };

  const resolveCatalogId = useCallback(
    (name: string) => catalog.find((item) => sameExerciseName(item.exerciseName, name))?.id,
    [catalog],
  );

  const workoutEstimatePayload = useMemo(() => {
    if (needsGoalTagInput && goalTag === SELECT_CHOICE) return null;
    if (needsDifficultyInput && difficulty === SELECT_CHOICE) return null;
    if (bodyPart === SELECT_CHOICE || type === SELECT_CHOICE || exerciseName === SELECT_CHOICE) return null;
    if (!performedSets || !performedRepsPerSet || !timeTaken.trim() || !isValidTimeTaken) return null;
    const parsedSets = Number(performedSets);
    const parsedReps = Number(performedRepsPerSet);
    if (!Number.isInteger(parsedSets) || parsedSets <= 0 || !Number.isInteger(parsedReps) || parsedReps <= 0) return null;

    const resolvedEntry = selectedEntry;
    const exerciseId = resolvedEntry?.globalExerciseId ?? selectedGlobalExercise?.id ?? null;
    const durMatch = /^(\d{1,3}):(\d{1,2})$/.exec(timeTaken.trim());
    const durationMin = durMatch
      ? Math.max(1, Math.round(Number(durMatch[1]) + Number(durMatch[2]) / 60))
      : 1;

    if (resolvedEntry) {
      return {
        exercise_id: exerciseId,
        type: workoutTypeFromCatalog(resolvedEntry.type),
        exerciseName,
        sets: parsedSets,
        reps: parsedReps,
        duration: durationMin,
        difficulty: activeDifficulty === SELECT_CHOICE ? resolvedEntry.difficulty : activeDifficulty,
        timeTaken,
      };
    }

    if (selectedGlobalExercise) {
      return {
        exercise_id: exerciseId,
        type: workoutTypeFromGlobalCategory(selectedGlobalExercise.category),
        exerciseName,
        sets: parsedSets,
        reps: parsedReps,
        duration: durationMin,
        difficulty: activeDifficulty === SELECT_CHOICE ? selectedGlobalExercise.difficulty : activeDifficulty,
        timeTaken,
      };
    }

    return null;
  }, [
    needsGoalTagInput,
    goalTag,
    needsDifficultyInput,
    difficulty,
    bodyPart,
    type,
    exerciseName,
    performedSets,
    performedRepsPerSet,
    timeTaken,
    isValidTimeTaken,
    selectedEntry,
    catalog,
    activeGoalTag,
    activeDifficulty,
    recommendation,
    recommendationOptions,
    selectedGlobalExercise,
  ]);

  useEffect(() => {
    if (!workoutEstimatePayload) {
      setEstimateKcal(null);
      setEstimateError(null);
      return;
    }
    let cancelled = false;
    const estimateTimer = setTimeout(() => {
      void estimateWorkoutCalories(workoutEstimatePayload)
        .then((res) => {
          if (!cancelled) {
            setEstimateKcal(res.estimatedCalories);
            setEstimateError(null);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setEstimateKcal(null);
            const message = axios.isAxiosError(error)
              ? error.response?.status === 404
                ? t("workoutLog.estimateUnavailable")
                : t("workoutLog.estimateFailed")
              : t("workoutLog.estimateFailed");
            setEstimateError(message);
          }
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(estimateTimer);
    };
  }, [workoutEstimatePayload]);

  const openDurationPicker = () => {
    setPickerMinutes(parsedTimeTaken?.minutes ?? 0);
    setPickerSeconds(parsedTimeTaken?.seconds ?? 0);
    setDurationPickerOpen(true);
  };

  const applyDurationSelection = () => {
    setTimeTaken(`${pickerMinutes}:${String(pickerSeconds).padStart(2, "0")}`);
    setDurationPickerOpen(false);
  };

  const submit = async () => {
    if (needsGoalTagInput && goalTag === SELECT_CHOICE) {
      Alert.alert(t("workoutLog.alerts.missingFields"), t("workoutLog.alerts.selectGoal"));
      return;
    }
    if (needsDifficultyInput && difficulty === SELECT_CHOICE) {
      Alert.alert(t("workoutLog.alerts.missingFields"), t("workoutLog.alerts.selectDifficulty"));
      return;
    }
    if (bodyPart === SELECT_CHOICE || type === SELECT_CHOICE || exerciseName === SELECT_CHOICE) {
      Alert.alert(t("workoutLog.alerts.missingFields"), t("workoutLog.alerts.completeExercise"));
      return;
    }
    if (!performedSets || !performedRepsPerSet || !timeTaken) {
      Alert.alert(t("workoutLog.alerts.missingFields"), t("workoutLog.alerts.completeSets"));
      return;
    }
    const parsedSets = Number(performedSets);
    const parsedReps = Number(performedRepsPerSet);
    if (!Number.isInteger(parsedSets) || parsedSets <= 0) {
      Alert.alert(t("workoutLog.alerts.invalidSets"), t("workoutLog.alerts.setsPositive"));
      return;
    }
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) {
      Alert.alert(t("workoutLog.alerts.invalidReps"), t("workoutLog.alerts.repsPositive"));
      return;
    }
    if (!isValidTimeTaken) {
      Alert.alert(t("workoutLog.alerts.invalidTime"), t("workoutLog.alerts.timeFormat"));
      return;
    }
    const hasTopSetWeight = topSetWeightKg.trim().length > 0;
    const hasTopSetReps = topSetReps.trim().length > 0;
    if (isStrengthGoal && (hasTopSetWeight || hasTopSetReps) && !(hasTopSetWeight && hasTopSetReps)) {
      Alert.alert(t("workoutLog.alerts.missingTopSet"), t("workoutLog.alerts.topSetBoth"));
      return;
    }
    const parsedTopSetWeight = hasTopSetWeight ? Number(topSetWeightKg) : null;
    const parsedTopSetReps = hasTopSetReps ? Number(topSetReps) : null;
    if (isStrengthGoal && parsedTopSetWeight != null && (!Number.isFinite(parsedTopSetWeight) || parsedTopSetWeight <= 0)) {
      Alert.alert(t("workoutLog.alerts.invalidTopSet"), t("workoutLog.alerts.topSetWeightPositive"));
      return;
    }
    if (
      isStrengthGoal &&
      parsedTopSetReps != null &&
      (!Number.isInteger(parsedTopSetReps) || parsedTopSetReps <= 0)
    ) {
      Alert.alert(t("workoutLog.alerts.invalidTopSet"), t("workoutLog.alerts.topSetRepsPositive"));
      return;
    }

    const resolvedEntry = selectedEntry;
    const exerciseId = resolvedEntry?.globalExerciseId ?? selectedGlobalExercise?.id ?? null;

    const globalEntry = !resolvedEntry ? selectedGlobalExercise : null;
    if (!resolvedEntry && !globalEntry) {
      Alert.alert(t("workoutLog.alerts.invalidSelection"), t("workoutLog.alerts.noWorkoutMatch"));
      return;
    }

    try {
      let savedWorkoutId: number | undefined;
      if (resolvedEntry) {
        const resolvedRecommendation =
          recommendation !== SELECT_CHOICE ? recommendation : resolvedEntry.recommendation;
        const savedWorkout = await addWorkout({
          exercise_id: exerciseId,
          type: workoutTypeFromCatalog(resolvedEntry.type),
          exerciseName,
          sets: parsedSets,
          reps: parsedReps,
          duration: toDurationMinutes(timeTaken),
          difficulty: activeDifficulty === SELECT_CHOICE ? resolvedEntry.difficulty : activeDifficulty,
          timeTaken,
          notes: `body_part=${resolvedEntry.bodyPart}; goal_tag=${activeGoalTag === SELECT_CHOICE ? resolvedEntry.goalTag : activeGoalTag}; difficulty=${activeDifficulty === SELECT_CHOICE ? resolvedEntry.difficulty : activeDifficulty}; equipment=${resolvedEntry.equipment}; recommendation=${resolvedRecommendation}; recommended_weight_kg=${recommendedWeight}; planned_sets=${resolvedEntry.sets}; planned_reps=${resolvedEntry.reps}; planned_duration=${resolvedEntry.duration}`,
        });
        savedWorkoutId = Number(savedWorkout?.id) || undefined;
      } else if (globalEntry) {
        const savedWorkout = await addWorkout({
          exercise_id: exerciseId,
          type: workoutTypeFromGlobalCategory(globalEntry.category),
          exerciseName,
          sets: parsedSets,
          reps: parsedReps,
          duration: toDurationMinutes(timeTaken),
          difficulty: activeDifficulty === SELECT_CHOICE ? globalEntry.difficulty : activeDifficulty,
          timeTaken,
          notes: `body_part=${bodyPart}; global_exercise=1; equipment=${globalEntry.equipment}; category=${globalEntry.category}; difficulty=${globalEntry.difficulty}`,
        });
        savedWorkoutId = Number(savedWorkout?.id) || undefined;
      }
      let strengthLiftWarning = "";
      if (isStrengthGoal && parsedTopSetWeight != null && parsedTopSetReps != null) {
        try {
          await logStrengthLift({
            exercise_id: exerciseId,
            exercise_name: exerciseName,
            weight_kg: parsedTopSetWeight,
            reps: parsedTopSetReps,
            workout_id: savedWorkoutId,
          });
        } catch (error) {
          strengthLiftWarning = axios.isAxiosError(error)
            ? error.response?.data?.detail || error.message
            : t("workoutLog.alerts.topSetSaveFailed");
        }
      }
      setGoalTag(SELECT_CHOICE);
      setDifficulty(SELECT_CHOICE);
      setBodyPart(SELECT_CHOICE);
      setType(SELECT_CHOICE);
      setExerciseName(SELECT_CHOICE);
      setSelectedGlobalExercise(null);
      setRecommendation(SELECT_CHOICE);
      setPerformedSets("");
      setPerformedRepsPerSet("");
      setTopSetWeightKg("");
      setTopSetReps("");
      setTimeTaken("");
      await loadInitial({ preservePlannerState: true });
      Alert.alert(
        t("workoutLog.alerts.saved"),
        strengthLiftWarning
          ? t("workoutLog.alerts.savedWithWarning", { warning: strengthLiftWarning })
          : t("workoutLog.alerts.savedBody"),
      );
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : t("workoutLog.alerts.saveFailed");
      Alert.alert(t("workoutLog.alerts.error"), String(message));
    }
  };

  const openEditModal = (item: WorkoutHistoryItem) => {
    setEditingId(item.id);
    setEditSets(String(item.sets ?? ""));
    setEditReps(String(item.reps ?? ""));
    setEditTimeTaken(toTimeTaken(item.duration));
    setEditExerciseName(String(item.exerciseName || t("workoutLog.workout")));
    setEditTopSetWeightKg(item.strengthLift ? String(item.strengthLift.weight_kg) : "");
    setEditTopSetReps(item.strengthLift ? String(item.strengthLift.reps) : "");
  };

  const submitEdit = async () => {
    if (editingId == null || savingEdit) return;
    const parsedSets = Number(editSets);
    const parsedReps = Number(editReps);
    if (!Number.isInteger(parsedSets) || parsedSets <= 0) {
      Alert.alert(t("workoutLog.alerts.invalidSets"), t("workoutLog.alerts.setsPositive"));
      return;
    }
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) {
      Alert.alert(t("workoutLog.alerts.invalidReps"), t("workoutLog.alerts.repsPositive"));
      return;
    }
    const parsedTime = /^(\d{1,3}):(\d{1,2})$/.exec(editTimeTaken.trim());
    if (!parsedTime) {
      Alert.alert(t("workoutLog.alerts.invalidTime"), t("workoutLog.alerts.timeFormat"));
      return;
    }
    const seconds = Number(parsedTime[2]);
    if (seconds > 59) {
      Alert.alert(t("workoutLog.alerts.invalidTime"), t("workoutLog.alerts.secondsRange"));
      return;
    }
    const editingItem = history.find((item) => item.id === editingId);
    const shouldShowStrengthEdit = Boolean(editingItem?.strengthLift) || isStrengthGoal;
    const hasEditTopWeight = editTopSetWeightKg.trim().length > 0;
    const hasEditTopReps = editTopSetReps.trim().length > 0;
    if (shouldShowStrengthEdit && (hasEditTopWeight || hasEditTopReps) && !(hasEditTopWeight && hasEditTopReps)) {
      Alert.alert(t("workoutLog.alerts.missingTopSet"), t("workoutLog.alerts.topSetBoth"));
      return;
    }
    const parsedEditTopWeight = hasEditTopWeight ? Number(editTopSetWeightKg) : null;
    const parsedEditTopReps = hasEditTopReps ? Number(editTopSetReps) : null;
    if (
      shouldShowStrengthEdit &&
      parsedEditTopWeight != null &&
      (!Number.isFinite(parsedEditTopWeight) || parsedEditTopWeight <= 0)
    ) {
      Alert.alert(t("workoutLog.alerts.invalidTopSet"), t("workoutLog.alerts.topSetWeightPositive"));
      return;
    }
    if (
      shouldShowStrengthEdit &&
      parsedEditTopReps != null &&
      (!Number.isInteger(parsedEditTopReps) || parsedEditTopReps <= 0)
    ) {
      Alert.alert(t("workoutLog.alerts.invalidTopSet"), t("workoutLog.alerts.topSetRepsPositive"));
      return;
    }

    try {
      setSavingEdit(true);
      const updated = await updateWorkout(editingId, {
        sets: parsedSets,
        reps: parsedReps,
        duration: toDurationMinutes(editTimeTaken),
        timeTaken: editTimeTaken,
      });
      if (shouldShowStrengthEdit) {
        const existingLiftId = editingItem?.strengthLift?.id;
        if (parsedEditTopWeight != null && parsedEditTopReps != null) {
          if (existingLiftId) {
            await updateStrengthLift(existingLiftId, {
              weight_kg: parsedEditTopWeight,
              reps: parsedEditTopReps,
            });
          } else {
            await logStrengthLift({
              exercise_id: editingItem?.strengthLift?.exercise_id ?? editingItem?.exercise_id ?? null,
              exercise_name: editingItem?.exerciseName || editExerciseName || t("workoutLog.exerciseFallback"),
              weight_kg: parsedEditTopWeight,
              reps: parsedEditTopReps,
              workout_id: editingId,
            });
          }
        } else if (existingLiftId) {
          await deleteStrengthLift(existingLiftId);
        }
      }
      setHistory((prev) =>
        prev.map((item) =>
          item.id === editingId
            ? {
                ...item,
                sets: updated.sets ?? parsedSets,
                reps: updated.reps ?? parsedReps,
                duration: updated.duration ?? toDurationMinutes(editTimeTaken),
                caloriesBurned: updated.caloriesBurned ?? item.caloriesBurned,
              }
            : item,
        ),
      );
      setEditingId(null);
      await loadInitial({ preservePlannerState: true }).catch(() => undefined);
      setShowHistory(true);
      Alert.alert(t("workoutLog.alerts.updated"), t("workoutLog.alerts.updatedBody"));
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : t("workoutLog.alerts.updateFailed");
      Alert.alert(t("workoutLog.alerts.error"), String(message));
    } finally {
      setSavingEdit(false);
    }
  };

  const removeHistoryItem = async (itemId: number) => {
    try {
      setDeletingId(itemId);
      await deleteWorkout(itemId);
      setHistory((prev) => prev.filter((h) => h.id !== itemId));
      await loadInitial({ preservePlannerState: true });
      setShowHistory(true);
      Alert.alert(t("workoutLog.alerts.deleted"), t("workoutLog.alerts.deletedBody"));
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : t("workoutLog.alerts.deleteFailed");
      Alert.alert(t("workoutLog.alerts.error"), String(message));
    } finally {
      setDeletingId(null);
    }
  };

  const openCameraTracker = async () => {
    setCameraError(null);
    setMediaPipeReady(false);
    try {
      if (!cameraPermission) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          setCameraError(t("workoutLog.cameraPermissionDenied"));
          setShowCamera(true);
          return;
        }
      } else if (!cameraPermission.granted) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          setCameraError(t("workoutLog.cameraPermissionDenied"));
          setShowCamera(true);
          return;
        }
      }
      setShowCamera(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("workoutLog.cameraFailed");
      setCameraError(message);
      setShowCamera(true);
    }
  };
  const closeCameraTracker = () => {
    setShowCamera(false);
    setMediaPipeReady(false);
    setCameraError(null);
    cameraTracking.resetTracking();
  };

  const canOpenCamera = exerciseName !== SELECT_CHOICE;
  const cameraTargetReps = useMemo(() => {
    const n = Number(performedRepsPerSet);
    return Number.isInteger(n) && n > 0 ? n : 10;
  }, [performedRepsPerSet]);

  const cameraTracking = useCameraTracking({
    exerciseName: canOpenCamera ? exerciseName : "",
    targetReps: cameraTargetReps,
    enableAudio: true,
  });

  useEffect(() => {
    if (showCamera) cameraTracking.resetTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCamera, exerciseName]);
  const todayHistory = useMemo(() => {
    if (!todayKey) return [];
    return history.filter((item) => toDateKey(item?.date) === todayKey);
  }, [history, todayKey]);
  const todayPlanDay = todayPlan?.today ?? null;
  const allTodayPlannerExercisesLogged = useMemo(() => {
    if (!todayPlanDay || todayPlanDay.is_rest_day || !todayPlanDay.exercises?.length || !todayKey) {
      return false;
    }
    return allPlannerExercisesLogged(history, todayPlanDay.exercises, todayKey);
  }, [history, todayKey, todayPlanDay]);
  const latestTodayWorkout = todayHistory[0];
  const todayCaloriesBurned = useMemo(
    () => todayHistory.reduce((sum, item) => sum + (Number(item?.caloriesBurned) || 0), 0),
    [todayHistory],
  );
  const restDayActive = useMemo(
    () =>
      isHomeRestDayActive({
        hasWorkoutPlannerAccess,
        plan: todayPlan,
      }),
    [hasWorkoutPlannerAccess, todayPlan],
  );
  const plannedBurnTargets = useMemo(() => {
    const preWorkoutEnabled = isPreWorkoutEnabled(onboardingForBurn);
    const preworkoutProfile = preWorkoutEnabled
      ? toPreworkoutProfile(onboardingForBurn, userWeightKg)
      : null;
    const activities = computePlannedBurnActivities({
      restDayActive,
      hasWorkoutPlannerAccess,
      todayWorkoutPlan: todayPlan,
      preworkoutProfile,
      preWorkoutEnabled,
      weightKg: userWeightKg,
    });
    return computePlannedBurnTargets({
      minBurnTarget: burnTargetKcal,
      activities,
    });
  }, [
    onboardingForBurn,
    userWeightKg,
    restDayActive,
    hasWorkoutPlannerAccess,
    todayPlan,
    burnTargetKcal,
  ]);
  const minBurnTarget = plannedBurnTargets.minBurnTarget;
  const bestResultsBurnTarget = plannedBurnTargets.bestResultsBurnTarget;
  const plannedBurnActivities = plannedBurnTargets.activities;
  const plannedActivityLabel = useCallback(
    (activity: PlannedBurnActivity) => {
      if (activity.kind === "cardioWarmup") return t("workoutLog.plannedCardioWarmup");
      return t("workoutLog.plannedWorkoutSession", { name: activity.sessionLabel });
    },
    [t],
  );
  const plannedSessionKcal = useMemo(
    () => plannedBurnActivities.find((activity) => activity.kind === "workoutSession")?.kcal ?? 0,
    [plannedBurnActivities],
  );
  const todaySessionCount = todayHistory.length;
  const sessionMilestoneItems = useMemo(
    () =>
      buildTodaySessionMilestoneItems({
        hasWorkoutPlannerAccess,
        todayWorkoutPlan: todayPlan,
        workoutHistory: history,
        todayKey,
      }),
    [hasWorkoutPlannerAccess, history, todayKey, todayPlan],
  );
  const sessionMilestonePlannedCount = sessionMilestonePlannedTarget(sessionMilestoneItems);
  const sessionMilestonePlannedDone = sessionMilestonePlannedFilled(sessionMilestoneItems);
  const sessionMilestoneExtraCount = sessionMilestoneItems.filter((item) => item.isExtra).length;
  const sessionMilestoneFilled = sessionMilestoneItems.filter((item) => item.filled).length;
  const sessionMilestoneProgress =
    sessionMilestonePlannedCount > 0 ? sessionMilestonePlannedDone / sessionMilestonePlannedCount : 0;
  const sessionMilestoneComplete =
    sessionMilestonePlannedCount > 0 && sessionMilestonePlannedDone >= sessionMilestonePlannedCount;
  const burnTargetReached = todayCaloriesBurned >= bestResultsBurnTarget;
  const burnProgressPct =
    bestResultsBurnTarget > 0 ? Math.min(todayCaloriesBurned / bestResultsBurnTarget, 1) : 1;
  const burnMinMarkerPct =
    bestResultsBurnTarget > minBurnTarget && bestResultsBurnTarget > 0
      ? Math.min(1, minBurnTarget / bestResultsBurnTarget)
      : null;
  const guidanceExerciseName = selectedEntry?.defaultExerciseName ?? selectedEntry?.exerciseName ?? exerciseName;
  const exerciseGuidance = useMemo(() => findExerciseGuidance(guidanceExerciseName), [guidanceExerciseName]);
  const showGuideCard = exerciseName !== SELECT_CHOICE && !isNoChoice(exerciseName);
  const movementTypeDisplay =
    selectedEntry?.type ?? (type !== SELECT_CHOICE ? type : "—");
  const recommendationDisplay = recommendation !== SELECT_CHOICE ? recommendation : "—";
  const weightDisplay = recommendedWeight !== SELECT_CHOICE ? recommendedWeight : "—";
  const displayGoalTag = profileGoalTag !== SELECT_CHOICE ? profileGoalTag : goalTag;
  const displayDifficulty = profileDifficulty !== SELECT_CHOICE ? profileDifficulty : difficulty;
  const editingItem = editingId != null ? history.find((item) => item.id === editingId) : undefined;
  const showEditStrengthFields = Boolean(editingItem?.strengthLift) || isStrengthGoal;

  const toggleGuide = () => {
    LayoutAnimation.easeInEaseOut();
    setGuideOpen((prev) => !prev);
  };

  const toggleHistory = () => {
    LayoutAnimation.easeInEaseOut();
    setShowHistory((prev) => !prev);
  };

  const handleCameraCalibrate = () => {
    closeCameraTracker();
    navigationRef.navigate("AITrainerCalibration" as never);
  };

  const cameraCoachText =
    cameraTracking.bannerCue?.text ||
    cameraTracking.liveCorrection ||
    t("aiTrainer.tracking_ready", { defaultValue: "Tracking locked — start when ready" });
  const cameraCoachWarn =
    cameraTracking.bannerCue?.priority === "correction" ||
    cameraTracking.bannerCue?.priority === "safety" ||
    cameraTracking.liveStatus === "no_body" ||
    !cameraTracking.orientationOk;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.chrome}>
        <Text style={styles.greetingTitle}>{t("workoutLog.title")}</Text>
        <LogPlannerSegment mode={viewMode} onChange={selectViewMode} />
      </View>

      <SwipeTabPager
        pageIndex={viewMode === "log" ? 0 : 1}
        onPageIndexChange={(index) => selectViewMode(index === 0 ? "log" : "planner")}
        lazyFromIndex={1}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        {/* Active session banner — Elite gated; manual log below unchanged */}
        {(() => {
          const isElite = tier === "ELITE";
          const today = todayPlan?.today ?? null;
          const hasActivePlan = Boolean(todayPlan && today && !today.is_rest_day);
          const totalEstKcal = hasActivePlan ? plannedSessionKcal : 0;

          if (!isElite) {
            return (
              <View style={{ marginBottom: 14 }}>
                <View style={[styles.sessionBanner, styles.sessionBannerLocked]}>
                  <View style={styles.eliteLockPill}>
                    <Text style={styles.eliteLockTxt}>🔒  Elite only</Text>
                  </View>
                  <Text style={styles.sessionBannerEyebrow}>TODAY'S PLAN</Text>
                  <Text style={styles.sessionBannerTitle}>Guided workout session</Text>
                  <Text style={styles.sessionBannerMeta}>Auto-advance · calories · streak lock-in</Text>
                </View>
                <View style={styles.upgradeNudge}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.upgradeTitle}>Unlock guided sessions</Text>
                    <Text style={styles.upgradeSub}>Auto-advance · calorie tracking · streak lock-in</Text>
                  </View>
                  <Pressable
                    style={styles.upgradeBtn}
                    onPress={() => navigation.getParent()?.navigate("Profile", { screen: "Subscription" })}
                  >
                    <Text style={styles.upgradeBtnTxt}>Upgrade →</Text>
                  </Pressable>
                </View>
              </View>
            );
          }

          if (hasActivePlan) {
            return (
              <View style={{ marginBottom: 14 }}>
                <View style={styles.sessionBanner}>
                  <View style={styles.sessionBannerTop}>
                    <Text style={styles.sessionBannerEyebrow}>TODAY'S PLAN</Text>
                    <Text style={styles.sessionPlay}>▶</Text>
                  </View>
                  <Text style={styles.sessionBannerTitle}>{today!.split_name}</Text>
                  <Text style={styles.sessionBannerMeta}>
                    {today!.exercises.length} exercises · ~{today!.estimated_duration_min} min · ~{totalEstKcal}{" "}
                    kcal
                  </Text>
                  <Pressable
                    style={[styles.startSessionBtn, allTodayPlannerExercisesLogged && styles.startSessionBtnCompleted]}
                    onPress={() => setShowSessionPicker(true)}
                    disabled={allTodayPlannerExercisesLogged}
                  >
                    <Text style={styles.startSessionBtnTxt}>
                      {allTodayPlannerExercisesLogged
                        ? t("workoutLog.workoutCompletedForToday")
                        : t("workoutLog.startActiveSession")}
                    </Text>
                  </Pressable>
                </View>
                <SessionTypePickerModal
                  visible={showSessionPicker}
                  dayTitle={today!.split_name}
                  onDismiss={() => setShowSessionPicker(false)}
                  onChoose={(type) => {
                    setShowSessionPicker(false);
                    if (type === "ai_camera") {
                      // User gesture — unlock browser speechSynthesis for this page load
                      unlockWebSpeech();
                      const cal = usePoseCalibrationStore.getState();
                      void cal.loadFromProfile().then(() => {
                        const needsCal = !cal.hasCalibration() && !cal.skipped;
                        if (needsCal) {
                          navigationRef.navigate("AITrainerCalibration" as never, {
                            planId: todayPlan!.plan_id,
                          } as never);
                        } else {
                          navigationRef.navigate("AICameraWorkoutSession" as never, {
                            planId: todayPlan!.plan_id,
                          } as never);
                        }
                      });
                      return;
                    }
                    navigationRef.navigate("ActiveWorkoutSession" as never, {
                      planId: todayPlan!.plan_id,
                    } as never);
                  }}
                />
                <Text style={styles.orManual}>————————  or log manually  ————————</Text>
              </View>
            );
          }

          const isRest = Boolean(today?.is_rest_day);
          const noPlanYet = todayPlan === null;
          return (
            <View style={{ marginBottom: 14 }}>
              <View style={[styles.sessionBanner, styles.sessionBannerMuted]}>
                <Text style={[styles.sessionBannerEyebrow, { color: MUTED }]}>TODAY'S PLAN</Text>
                <Text style={styles.sessionBannerTitleMuted}>
                  {isRest
                    ? "Today is a rest day 🛌"
                    : noPlanYet
                      ? "No plan generated yet"
                      : "No workout scheduled for today"}
                </Text>
                {isRest && today?.message ? (
                  <Text style={[styles.sessionBannerMeta, { color: MUTED }]}>{today.message}</Text>
                ) : null}
                {!isRest ? (
                  <Pressable
                    style={[styles.startSessionBtn, { backgroundColor: GREEN }]}
                    onPress={() => selectViewMode("planner")}
                  >
                    <Text style={[styles.startSessionBtnTxt, { color: "#fff" }]}>Generate plan</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.orManual}>————————  or log manually  ————————</Text>
            </View>
          );
        })()}

        <View style={styles.milestoneCard}>
          <View style={styles.milestoneTopRow}>
            <View style={styles.milestoneTopLeft}>
              <Text style={styles.milestoneEyebrow}>{t("workoutLog.sessionMilestone")}</Text>
              {latestTodayWorkout ? (
                <>
                  <Text style={styles.milestoneExerciseName} numberOfLines={1}>
                    {bodyPartEmoji(
                      latestTodayWorkout.bodyPart || parseBodyPartFromNotes(latestTodayWorkout.notes) || t("workoutLog.body"),
                    )}{" "}
                    {latestTodayWorkout.exerciseName}
                  </Text>
                  <Text style={styles.milestoneLastMeta}>
                    {t("workoutLog.lastSession", { kcal: Math.round(Number(latestTodayWorkout.caloriesBurned) || 0) })}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.milestoneExerciseName}>{t("workoutLog.emptyHistoryTitle")}</Text>
                  <Text style={styles.milestoneLastMeta}>
                    {sessionMilestonePlannedCount > 0
                      ? t("workoutLog.goalSessions", { count: sessionMilestonePlannedCount })
                      : t("workoutLog.goalSessionsEmpty")}
                  </Text>
                </>
              )}
            </View>
            <View style={styles.milestoneCountCol}>
              <Text style={[styles.milestoneCount, sessionMilestoneComplete ? styles.milestoneCountMet : null]}>
                {sessionMilestoneFilled}
              </Text>
              <Text style={styles.milestoneCountDenom}>
                {sessionMilestonePlannedCount > 0
                  ? sessionMilestoneExtraCount > 0
                    ? t("workoutLog.sessionsDenomWithExtras", {
                        planned: sessionMilestonePlannedCount,
                        extras: sessionMilestoneExtraCount,
                      })
                    : t("workoutLog.sessionsDenom", { count: sessionMilestonePlannedCount })
                  : t("workoutLog.sessionsDenomEmpty")}
              </Text>
            </View>
          </View>

          <View style={styles.milestoneTileRow}>
            {sessionMilestoneItems.map((item, index) => (
              <View
                key={item.key}
                style={[
                  styles.milestoneTile,
                  item.isExtra
                    ? styles.milestoneTileExtra
                    : item.filled
                      ? styles.milestoneTileFilled
                      : styles.milestoneTileEmpty,
                ]}
              >
                {item.filled ? (
                  <Text style={styles.milestoneTileCheck}>✓</Text>
                ) : (
                  <Text style={styles.milestoneTileEmptyText}>{index + 1}</Text>
                )}
              </View>
            ))}
          </View>

          <View style={styles.milestoneProgressTrack}>
            <View
              style={[
                styles.milestoneProgressFill,
                { width: `${Math.min(sessionMilestoneProgress, 1) * 100}%` },
              ]}
            />
          </View>

          <View style={styles.milestoneFooterRow}>
            <Text style={styles.milestoneFooterGoal}>
              {sessionMilestonePlannedCount > 0
                ? t("workoutLog.goalSessions", { count: sessionMilestonePlannedCount })
                : t("workoutLog.goalSessionsEmpty")}
            </Text>
            {sessionMilestoneComplete && sessionMilestoneExtraCount > 0 ? (
              <Text style={styles.milestoneFooterSuccess}>
                {t("workoutLog.goalReached")} · {t("workoutLog.goalSessionsBonus", { count: sessionMilestoneExtraCount })}
              </Text>
            ) : sessionMilestoneComplete ? (
              <Text style={styles.milestoneFooterSuccess}>{t("workoutLog.goalReached")}</Text>
            ) : sessionMilestonePlannedCount > 0 ? (
              <Text style={styles.milestoneFooterRemaining}>
                {t("workoutLog.moreToGo", { count: sessionMilestonePlannedCount - sessionMilestonePlannedDone })}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiPill}>
            <Text style={styles.kpiEmoji}>🔥</Text>
            <Text style={styles.kpiValueOrange}>{todayCaloriesBurned}</Text>
            <Text style={styles.kpiLabel}>{t("workoutLog.kcalBurned")}</Text>
          </View>
          <View style={styles.kpiPill}>
            <Text style={styles.kpiEmoji}>✅</Text>
            <Text style={styles.kpiValue}>{todaySessionCount}</Text>
            <Text style={styles.kpiLabel}>{t("workoutLog.sessions")}</Text>
          </View>
          <View style={styles.kpiPill}>
            <Text style={styles.kpiEmoji}>🎯</Text>
            <Text style={styles.kpiValueGreen}>{bestResultsBurnTarget}</Text>
            <Text style={styles.kpiLabel}>{t("workoutLog.target")}</Text>
          </View>
        </View>

        <View style={styles.goalLevelRow}>
          <View style={styles.goalPill}>
            <Text style={styles.goalPillText} numberOfLines={1}>
              {displayGoalTag}
            </Text>
          </View>
          <View style={styles.levelPill}>
            <Text style={styles.levelPillText} numberOfLines={1}>
              {displayDifficulty}
            </Text>
          </View>
        </View>

        <View style={styles.bgCard}>
          <View style={styles.burnHeaderRow}>
            <Text style={styles.burnTitle}>{t("workoutLog.burnProgress")}</Text>
            {burnTargetReached ? (
              <Text style={styles.burnTargetReached}>{t("workoutLog.goalReached")}</Text>
            ) : (
              <Text style={styles.burnMeta}>
                {todayCaloriesBurned} / {bestResultsBurnTarget} kcal
              </Text>
            )}
          </View>
          <View style={styles.burnTrackWrap}>
            <View style={styles.burnTrack}>
              <View style={[styles.burnFill, { width: `${burnProgressPct * 100}%` }]} />
            </View>
            {burnMinMarkerPct != null ? (
              <View style={[styles.burnMinMarker, { left: `${burnMinMarkerPct * 100}%` }]} />
            ) : null}
          </View>
          {burnMinMarkerPct != null ? (
            <Text style={styles.burnMinCaption}>
              {t("workoutLog.burnMinMarker", { kcal: minBurnTarget })}
            </Text>
          ) : null}
          {plannedBurnActivities.length > 0 ? (
            <View style={styles.plannedBurnList}>
              {plannedBurnActivities.map((activity) => (
                <View key={activity.id} style={styles.plannedBurnRow}>
                  <Text style={styles.plannedBurnLabel}>{plannedActivityLabel(activity)}</Text>
                  <Text style={styles.plannedBurnKcal}>~{activity.kcal} kcal</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {todaySessionCount > 0 && latestTodayWorkout ? (
          <View style={styles.bgCard}>
            <View style={styles.lastSessionRow}>
              <View style={styles.lastSessionBody}>
                <Text style={styles.lastSessionTitle} numberOfLines={2}>
                  {bodyPartEmoji(
                    latestTodayWorkout.bodyPart || parseBodyPartFromNotes(latestTodayWorkout.notes) || t("workoutLog.body"),
                  )}{" "}
                  {latestTodayWorkout.exerciseName}
                </Text>
                <Text style={styles.lastSessionSub} numberOfLines={1}>
                  {latestTodayWorkout.bodyPart || parseBodyPartFromNotes(latestTodayWorkout.notes) || t("workoutLog.body")} ·{" "}
                  {Math.round(Number(latestTodayWorkout.caloriesBurned) || 0)} kcal · {latestTodayWorkout.sets ?? 0} ×{" "}
                  {latestTodayWorkout.reps ?? 0}
                </Text>
              </View>
              <View style={styles.donePill}>
                <Text style={styles.donePillText}>{t("workoutLog.done")}</Text>
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>{t("workoutLog.logNewWorkout")}</Text>

        {needsGoalTagInput ? (
          <ChipDropdownField
            value={goalTag}
            options={goalTagOptions}
            placeholder={t("workoutLog.goalTag")}
            onChange={async (value) => {
              setGoalTag(value);
              setDifficulty(SELECT_CHOICE);
              setBodyPart(SELECT_CHOICE);
              setType(SELECT_CHOICE);
              setExerciseName(SELECT_CHOICE);
              setSelectedGlobalExercise(null);
              setRecommendation(SELECT_CHOICE);
              await fetchCatalog(buildFilterParams({ goalTag: value }));
            }}
          />
        ) : null}

        {needsDifficultyInput ? (
          <ChipDropdownField
            value={difficulty}
            options={difficultyOptions}
            placeholder={t("workoutLog.difficulty")}
            enabled={!needsGoalTagInput || goalTag !== SELECT_CHOICE}
            onChange={async (value) => {
              setDifficulty(value);
              setBodyPart(SELECT_CHOICE);
              setType(SELECT_CHOICE);
              setExerciseName(SELECT_CHOICE);
              setSelectedGlobalExercise(null);
              setRecommendation(SELECT_CHOICE);
              await fetchCatalog(buildFilterParams({ goalTag, difficulty: value }));
            }}
          />
        ) : null}

        <ChipDropdownField
          value={bodyPart}
          options={bodyPartOptions}
          placeholder={t("workoutLog.bodyPart")}
          enabled={(!needsGoalTagInput || goalTag !== SELECT_CHOICE) && (!needsDifficultyInput || difficulty !== SELECT_CHOICE)}
          onChange={async (value) => {
            setBodyPart(value);
            setType(SELECT_CHOICE);
            setExerciseName(SELECT_CHOICE);
            setSelectedGlobalExercise(null);
            setRecommendation(SELECT_CHOICE);
            await fetchCatalog(buildFilterParams({ bodyPart: value === SELECT_CHOICE ? undefined : value, goalTag, difficulty }));
          }}
        />

        <ExerciseSearchInput
          value={exerciseName}
          onSelectCatalogExercise={(name, catalogId) => {
            void handleCatalogExerciseSelect(name, catalogId);
          }}
          onSelectGlobalExercise={(exercise) => {
            void handleGlobalExerciseSelect(exercise);
          }}
          resolveCatalogId={resolveCatalogId}
          catalogExerciseNames={exerciseOptions}
          placeholder={t("workoutLog.exercise")}
          disabled={bodyPart === SELECT_CHOICE}
          chipMode
          chipSelected={exerciseName !== SELECT_CHOICE}
          colors={CHIP_DROPDOWN_COLORS}
          radius={CHIP_RADIUS}
        />

        {showGuideCard ? (
          <Pressable
            style={[styles.guideCard, guideOpen ? styles.guideCardOpen : styles.guideCardClosed]}
            onPress={toggleGuide}
          >
            <View style={styles.guideHeader}>
              <View style={styles.guideHeaderLeft}>
                <View style={styles.guideIconTile}>
                  <Text style={styles.guideIconEmoji}>💪</Text>
                </View>
                <View style={styles.guideHeaderText}>
                  <Text style={styles.guideExerciseName} numberOfLines={1}>
                    {exerciseName}
                  </Text>
                  <Text style={styles.guideHint}>
                    {guideOpen ? t("workoutLog.tapCollapseGuide") : t("workoutLog.tapGuide")}
                  </Text>
                </View>
              </View>
              <View style={[styles.guideChevronCircle, guideOpen ? styles.guideChevronCircleOpen : null]}>
                <Text style={[styles.guideChevron, guideOpen ? styles.guideChevronOpen : null]}>
                  {guideOpen ? "▴" : "▾"}
                </Text>
              </View>
            </View>

            {guideOpen ? (
              <View style={styles.guideBody}>
                <View style={styles.guideDivider} />

                {exerciseGuidance?.muscles?.length ? (
                  <View style={styles.guideSection}>
                    <Text style={styles.guideSectionLabelGreen}>{t("workoutLog.musclesWorked")}</Text>
                    <View style={styles.musclePillRow}>
                      {exerciseGuidance.muscles.map((muscle) => (
                        <View key={`${muscle.name}-${muscle.role}`} style={styles.muscleTag}>
                          <Text style={styles.muscleTagText}>{muscle.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {exerciseGuidance?.posture ? (
                  <View style={styles.guideBlockGreen}>
                    <Text style={styles.guideBlockLabelGreen}>{t("workoutLog.posture")}</Text>
                    <Text style={styles.guideBlockBody}>{exerciseGuidance.posture}</Text>
                  </View>
                ) : null}

                {exerciseGuidance?.formCues ? (
                  <View style={styles.guideBlockPurple}>
                    <Text style={styles.guideBlockLabelPurple}>{t("workoutLog.formCues")}</Text>
                    <Text style={styles.guideBlockBody}>{exerciseGuidance.formCues}</Text>
                  </View>
                ) : null}

                {exerciseGuidance?.cautions ? (
                  <View style={styles.guideBlockOrange}>
                    <Text style={styles.guideBlockLabelOrange}>{t("workoutLog.cautions")}</Text>
                    <Text style={styles.guideBlockBody}>{exerciseGuidance.cautions}</Text>
                  </View>
                ) : null}

                {exerciseGuidance?.proTip ? (
                  <View style={styles.proTipBubble}>
                    <Text style={styles.proTipEmoji}>💡</Text>
                    <Text style={styles.proTipText}>{exerciseGuidance.proTip}</Text>
                  </View>
                ) : null}

                <View style={styles.guideDetailDivider} />
                <View style={styles.guideDetailRow}>
                  <Text style={styles.guideDetailLabel}>{t("workoutLog.movement")}</Text>
                  <Text style={styles.guideDetailValue} numberOfLines={2}>
                    {movementTypeDisplay}
                  </Text>
                </View>
                <View style={styles.guideDetailRow}>
                  <Text style={styles.guideDetailLabel}>{t("workoutLog.recommendation")}</Text>
                  <Text style={styles.guideDetailValue} numberOfLines={3}>
                    {recommendationDisplay}
                  </Text>
                </View>
                <View style={styles.guideDetailRow}>
                  <Text style={styles.guideDetailLabel}>{t("workoutLog.suggestedWeight")}</Text>
                  <Text style={styles.guideDetailValueGreen} numberOfLines={2}>
                    {weightDisplay}
                  </Text>
                </View>
              </View>
            ) : null}
          </Pressable>
        ) : null}

        <View style={styles.srdCard}>
          <Text style={styles.srdLabel}>{t("workoutLog.setsRepsDuration")}</Text>
          <View style={styles.srdRow}>
            <View style={styles.srdTile}>
              <Text style={styles.srdTileLabel}>{t("workoutLog.sets")}</Text>
              <TextInput
                style={styles.srdTileInput}
                placeholder="4"
                placeholderTextColor={MUTED}
                value={performedSets}
                onChangeText={handlePerformedSetsChange}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={styles.srdTile}>
              <Text style={styles.srdTileLabel}>{t("workoutLog.repsPerSet")}</Text>
              <TextInput
                style={styles.srdTileInput}
                placeholder="12"
                placeholderTextColor={MUTED}
                value={performedRepsPerSet}
                onChangeText={handlePerformedRepsChange}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
            <Pressable style={styles.srdTile} onPress={openDurationPicker}>
              <Text style={styles.srdTileLabel}>{t("workoutLog.duration")}</Text>
              <Text style={styles.srdTileValue}>{timeTaken || "00:00"}</Text>
            </Pressable>
          </View>
        </View>

        {isStrengthGoal ? (
          <View style={styles.strengthPrCard}>
            <Text style={styles.srdLabel}>{t("workoutLog.heaviestSet")}</Text>
            <Text style={styles.strengthPrCaption}>{t("workoutLog.heaviestSetCaption")}</Text>
            <View style={styles.srdRow}>
              <View style={styles.srdTile}>
                <Text style={styles.srdTileLabel}>{t("workoutLog.topSetWeight")}</Text>
                <TextInput
                  style={styles.srdTileInput}
                  placeholder="80"
                  placeholderTextColor={MUTED}
                  value={topSetWeightKg}
                  onChangeText={handleTopSetWeightChange}
                  keyboardType="decimal-pad"
                  maxLength={5}
                />
              </View>
              <View style={styles.srdTile}>
                <Text style={styles.srdTileLabel}>{t("workoutLog.topSetReps")}</Text>
                <TextInput
                  style={styles.srdTileInput}
                  placeholder="5"
                  placeholderTextColor={MUTED}
                  value={topSetReps}
                  onChangeText={handleTopSetRepsChange}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
            </View>
          </View>
        ) : null}

        {timeRangeError ? <Text style={styles.inlineError}>{timeRangeError}</Text> : null}
        {estimateKcal != null && workoutEstimatePayload ? (
          <View style={styles.estimatePill}>
            <Text style={styles.estimatePillText}>{t("workoutLog.estimatedKcal", { kcal: estimateKcal })}</Text>
          </View>
        ) : null}
        {estimateError ? <Text style={styles.inlineError}>{estimateError}</Text> : null}

        <View style={styles.logActionRow}>
          {canOpenCamera ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("workoutLog.openCamera")}
              style={styles.logCameraBtn}
              onPress={() => void openCameraTracker()}
            >
              <Ionicons name="camera-outline" size={22} color={GREEN} />
            </Pressable>
          ) : null}
          <Pressable style={styles.logBtn} onPress={submit}>
            <Text style={styles.logBtnTitle}>{t("workoutLog.logWorkout")}</Text>
            <Text style={styles.logBtnSub}>{t("workoutLog.logWorkoutSub")}</Text>
          </Pressable>
        </View>

        <View style={styles.bgCard}>
          <View style={styles.historyHeader}>
            <Pressable style={styles.historyToggle} onPress={toggleHistory}>
              <View style={styles.historyHeaderLeft}>
                <Text style={styles.historyEyebrow}>{t("workoutLog.recent")}</Text>
                <Text style={styles.historyTitle}>{t("workoutLog.sessionHistory")}</Text>
              </View>
              <View style={styles.historyHeaderRight}>
                <Text style={styles.historyCount}>{t("workoutLog.todayCount", { count: todaySessionCount })}</Text>
                <Text style={[styles.historyChevron, showHistory ? styles.historyChevronOpen : null]}>▾</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open all time workout history"
              style={styles.allTimeHistoryBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setAllTimeHistoryOpen(true)}
            >
              <Text style={styles.allTimeHistoryText}>All time ›</Text>
            </Pressable>
          </View>

          {showHistory ? (
            todayHistory.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Text style={styles.emptyHistoryTitle}>{t("workoutLog.emptyHistoryTitle")}</Text>
                <Text style={styles.emptyHistorySub}>{t("workoutLog.emptyHistorySub")}</Text>
              </View>
            ) : (
              todayHistory.map((item, idx) => {
                const logSource = resolveWorkoutLogSource(item);
                return (
                <View
                  key={item.id}
                  style={[styles.historyRow, idx === todayHistory.length - 1 ? styles.historyRowLast : null]}
                >
                  <View style={styles.historyStripe} />
                  <View style={styles.historyBody}>
                    <View style={styles.historyTitleRow}>
                      <Text style={styles.historySessionLine} numberOfLines={2}>
                        {sessionHistoryLabel(item)}
                      </Text>
                      <View
                        style={[
                          styles.sourceBadge,
                          { backgroundColor: WORKOUT_SOURCE_BADGE_STYLE[logSource].backgroundColor },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sourceBadgeText,
                            { color: WORKOUT_SOURCE_BADGE_STYLE[logSource].color },
                          ]}
                        >
                          {t(WORKOUT_LOG_SOURCE_I18N_KEY[logSource])}
                        </Text>
                      </View>
                      {isActiveSessionPartialLog(item) ? (
                        <View style={styles.partialBadge}>
                          <Text style={styles.partialBadgeText}>Partial</Text>
                        </View>
                      ) : null}
                      {item.strengthLift?.is_new_pr ? (
                        <View style={styles.newPrBadge}>
                          <Text style={styles.newPrBadgeText}>{t("workoutLog.newPr")}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.historySessionMeta} numberOfLines={1}>
                      {String(item.type || "")} · {formatDate(item.date)}
                    </Text>
                    {item.strengthLift ? (
                      <Text style={styles.historyStrengthMeta} numberOfLines={1}>
                        {t("workoutLog.strengthMeta", { weight: item.strengthLift.weight_kg, reps: item.strengthLift.reps, oneRm: item.strengthLift.estimated_1rm_kg })}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.historyActions}>
                    {!isGuidedWarmupLog(item) ? (
                      <Pressable
                        style={styles.editLogBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        onPress={() => openEditModal(item)}
                        disabled={deletingId === item.id}
                      >
                        <Text style={styles.editLogText}>{t("workoutLog.edit")}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={styles.deleteLogBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      disabled={deletingId === item.id}
                      onPress={() => void removeHistoryItem(item.id)}
                    >
                      <Text style={styles.deleteLogText}>{deletingId === item.id ? "…" : "✕"}</Text>
                    </Pressable>
                  </View>
                </View>
              );
              })
            )
          ) : null}
        </View>
      </ScrollView>
        {hasWorkoutPlannerAccess ? (
          <MonthlyWorkoutPlannerScreen embedded />
        ) : (
          <PlannerLockedUpsell
            feature="workout_plan_generation"
            featureName={t("coach.home.workoutPlanner.name")}
            featureDescription={t("coach.home.workoutPlanner.gateDescription")}
            featureEmoji="🏆"
            accentColor="#7f77dd"
          />
        )}
      </SwipeTabPager>

      <Modal visible={durationPickerOpen} transparent animationType="fade" onRequestClose={() => setDurationPickerOpen(false)}>
        <View style={styles.durationModalBackdrop}>
          <View style={styles.durationModalCard}>
            <Text style={styles.durationModalTitle}>{t("workoutLog.setDuration")}</Text>
            <Text style={styles.durationModalSub}>{t("workoutLog.durationSub")}</Text>
            <View style={styles.durationPickerRow}>
              <View style={styles.durationCol}>
                <Text style={styles.durationUnit}>{t("workoutLog.minutes")}</Text>
                <Pressable
                  style={styles.durationStepBtn}
                  onPress={() => setPickerMinutes((m) => Math.max(0, m - 1))}
                >
                  <Text style={styles.durationStepText}>−</Text>
                </Pressable>
                <Text style={styles.durationNumber}>{pickerMinutes}</Text>
                <Pressable
                  style={styles.durationStepBtn}
                  onPress={() => setPickerMinutes((m) => Math.min(999, m + 1))}
                >
                  <Text style={styles.durationStepText}>＋</Text>
                </Pressable>
              </View>

              <Text style={styles.durationSeparator}>:</Text>

              <View style={styles.durationCol}>
                <Text style={styles.durationUnit}>{t("workoutLog.seconds")}</Text>
                <Pressable
                  style={styles.durationStepBtn}
                  onPress={() => setPickerSeconds((s) => Math.max(0, s - 1))}
                >
                  <Text style={styles.durationStepText}>−</Text>
                </Pressable>
                <Text style={styles.durationNumber}>{String(pickerSeconds).padStart(2, "0")}</Text>
                <Pressable
                  style={styles.durationStepBtn}
                  onPress={() => setPickerSeconds((s) => Math.min(59, s + 1))}
                >
                  <Text style={styles.durationStepText}>＋</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.durationModalActions}>
              <Pressable
                style={[styles.durationActionBtn, styles.durationCancelBtn]}
                onPress={() => setDurationPickerOpen(false)}
              >
                <Text style={styles.durationCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.durationActionBtn, styles.durationSetBtn]}
                onPress={applyDurationSelection}
              >
                <Text style={styles.durationSetText}>{t("workoutLog.set")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AllTimeHistoryModal visible={allTimeHistoryOpen} onClose={() => setAllTimeHistoryOpen(false)} />

      <Modal visible={editingId !== null} transparent animationType="fade" onRequestClose={() => setEditingId(null)}>
        <View style={styles.editModalBackdrop}>
          <View style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>{t("workoutLog.editSession")}</Text>
            <Text style={styles.editModalSubtitle} numberOfLines={2}>
              {editExerciseName || editingItem?.exerciseName || t("workoutLog.workout")}
            </Text>
            <View style={styles.inputGrid}>
              <View style={styles.inputGridHalf}>
                <EditModalInput
                  label={t("workoutLog.sets")}
                  placeholder="4"
                  value={editSets}
                  onChangeText={(value) => setEditSets(value.replace(/\D/g, ""))}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
              <View style={styles.inputGridHalf}>
                <EditModalInput
                  label={t("workoutLog.repsPerSet")}
                  placeholder="12"
                  value={editReps}
                  onChangeText={(value) => setEditReps(value.replace(/\D/g, ""))}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            </View>
            <View style={styles.durationWrap}>
              <EditModalInput
                label={t("workoutLog.timeTaken")}
                placeholder="12:30"
                value={editTimeTaken}
                onChangeText={setEditTimeTaken}
              />
            </View>
            {showEditStrengthFields ? (
              <View style={styles.editStrengthCard}>
                <Text style={styles.editStrengthTitle}>{t("workoutLog.heaviestSet")}</Text>
                <Text style={styles.editStrengthCaption}>{t("workoutLog.heaviestSetCaption")}</Text>
                <View style={styles.inputGrid}>
                  <View style={styles.inputGridHalf}>
                    <EditModalInput
                      label={t("workoutLog.topSetWeight")}
                      labelTone="green"
                      placeholder="80"
                      value={editTopSetWeightKg}
                      onChangeText={handleEditTopSetWeightChange}
                      keyboardType="decimal-pad"
                      maxLength={5}
                    />
                  </View>
                  <View style={styles.inputGridHalf}>
                    <EditModalInput
                      label={t("workoutLog.topSetReps")}
                      labelTone="green"
                      placeholder="5"
                      value={editTopSetReps}
                      onChangeText={(value) => setEditTopSetReps(value.replace(/\D/g, ""))}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                  </View>
                </View>
              </View>
            ) : null}
            <View style={styles.editModalActions}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.editCancelBtn}
                onPress={() => {
                  if (savingEdit) return;
                  setEditingId(null);
                }}
              >
                <Text style={styles.editCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.editSaveBtn, savingEdit ? { opacity: 0.7 } : null]}
                onPress={() => void submitEdit()}
                disabled={savingEdit}
              >
                <Text style={styles.editSaveText}>{savingEdit ? t("common.saving") : t("common.save")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showCamera} animationType="slide" onRequestClose={closeCameraTracker}>
        {cameraPermission?.granted ? (
          <CameraGuidedSessionFrame
            exerciseName={exerciseName}
            exerciseSubtitle={t("workoutLog.cameraTitle", { defaultValue: "Camera tracker" })}
            targetReps={cameraTargetReps}
            poseSpec={cameraTracking.poseSpec}
            calibration={cameraTracking.calibrationPayload}
            isActive={showCamera}
            countingPaused={cameraTracking.countingPaused}
            sessionPaused={cameraTracking.sessionPaused}
            facingMode={cameraTracking.facingMode}
            repCount={cameraTracking.repCount}
            formScore={cameraTracking.formScore}
            verdicts={cameraTracking.verdicts}
            liveRom01={cameraTracking.liveRom01}
            liveInZone={cameraTracking.liveInZone}
            zoneStart01={cameraTracking.zoneStart01}
            zoneEnd01={cameraTracking.zoneEnd01}
            orientationOk={cameraTracking.orientationOk}
            liveStatus={cameraTracking.liveStatus}
            coachText={cameraCoachText}
            coachWarn={cameraCoachWarn}
            ttsSpeaking={cameraTracking.ttsSpeaking}
            trackingRunning={cameraTracking.trackingRunning}
            voiceMode={cameraTracking.voiceMode}
            webAudioReady={cameraTracking.webAudioReady}
            cameraError={cameraError}
            showCalibrateBanner={needsCalBanner || needsRecalibration}
            onClose={closeCameraTracker}
            onCalibrate={handleCameraCalibrate}
            onPauseToggle={cameraTracking.handlePauseToggle}
            onVoiceModeCycle={cameraTracking.handleVoiceModeCycle}
            onFlipCam={cameraTracking.handleFlipCam}
            flipDisabled={cameraTracking.flipInProgress}
            onCameraFlipped={cameraTracking.handleCameraFlipped}
            onZoomIn={cameraTracking.handleZoomIn}
            onZoomOut={cameraTracking.handleZoomOut}
            zoomLevel={cameraTracking.zoomLevel}
            onTrackingUpdate={cameraTracking.handleTrackingUpdate}
            onReady={() => {
              setMediaPipeReady(true);
              setCameraError(null);
            }}
            onError={(message) => {
              setCameraError(message);
              setMediaPipeReady(false);
            }}
          />
        ) : (
          <SafeAreaView style={styles.cameraFullScreen} edges={["top", "left", "right", "bottom"]}>
            <View style={styles.cameraPermissionFull}>
              <Text style={styles.cameraPermissionFullTxt}>
                {cameraError || t("workoutLog.cameraPermission")}
              </Text>
              <Pressable
                style={styles.cameraAllowBtn}
                onPress={() => void openCameraTracker()}
              >
                <Text style={styles.cameraAllowText}>{t("workoutLog.allowCamera")}</Text>
              </Pressable>
              <Pressable style={styles.cameraCloseLink} onPress={closeCameraTracker}>
                <Text style={styles.cameraCloseLinkTxt}>{t("profile.close")}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WHITE },
  chrome: { paddingHorizontal: 16, paddingTop: 4 },
  modePanel: { flex: 1 },
  modePanelHidden: { display: "none" },
  scroll: { flex: 1, backgroundColor: WHITE },
  scrollContent: { padding: 16, paddingBottom: 40 },
  greetingHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  greetingLeft: { flex: 1, paddingRight: 12 },
  greetingTitle: { fontSize: 25, fontWeight: "800", color: TEXT, marginBottom: 12 },
  logActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  logCameraBtn: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: GREEN,
    backgroundColor: WHITE,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  kpiPill: {
    flex: 1,
    backgroundColor: BG,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  kpiEmoji: { fontSize: 18, marginBottom: 6 },
  kpiValue: { fontSize: 18, fontWeight: "700", color: TEXT },
  kpiValueOrange: { fontSize: 18, fontWeight: "700", color: ORANGE },
  kpiValueGreen: { fontSize: 18, fontWeight: "700", color: GREEN },
  kpiLabel: { fontSize: 10, color: MUTED, marginTop: 4, textTransform: "lowercase" },
  bgCard: {
    backgroundColor: BG,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  burnHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  burnTitle: { fontSize: 14, fontWeight: "600", color: TEXT },
  burnTargetReached: { fontSize: 12, fontWeight: "700", color: GREEN },
  burnMeta: { fontSize: 12, color: MUTED },
  burnTrackWrap: {
    position: "relative",
    height: 11,
    justifyContent: "center",
  },
  burnTrack: {
    height: 7,
    borderRadius: 100,
    backgroundColor: TRACK,
    overflow: "hidden",
  },
  burnFill: { height: 7, borderRadius: 100, backgroundColor: ORANGE },
  burnMinMarker: {
    position: "absolute",
    top: 0,
    width: 2,
    height: 11,
    marginLeft: -1,
    backgroundColor: GREEN,
    borderRadius: 1,
  },
  burnMinCaption: {
    marginTop: 8,
    fontSize: 11,
    color: MUTED,
  },
  plannedBurnList: {
    marginTop: 10,
    gap: 6,
  },
  plannedBurnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  plannedBurnLabel: {
    flex: 1,
    fontSize: 12,
    color: TEXT,
    paddingRight: 8,
  },
  plannedBurnKcal: {
    fontSize: 12,
    fontWeight: "700",
    color: ORANGE,
  },
  sessionBanner: {
    backgroundColor: GREEN,
    borderRadius: 16,
    padding: 16,
  },
  sessionBannerMuted: { backgroundColor: "#E5E7EB" },
  sessionBannerLocked: { opacity: 0.35, pointerEvents: "none" as const },
  sessionBannerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sessionBannerEyebrow: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  sessionPlay: { color: "#fff", fontSize: 14 },
  sessionBannerTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 4 },
  sessionBannerTitleMuted: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 4 },
  sessionBannerMeta: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginBottom: 12 },
  startSessionBtn: {
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  startSessionBtnCompleted: { opacity: 0.72 },
  startSessionBtnTxt: { color: GREEN, fontWeight: "800", fontSize: 14 },
  orManual: {
    textAlign: "center",
    color: MUTED,
    fontSize: 11,
    marginTop: 10,
    fontWeight: "600",
  },
  eliteLockPill: {
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
  },
  eliteLockTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  upgradeNudge: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: PURPLE_BORDER,
    backgroundColor: PURPLE_NUDGE,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  upgradeTitle: { color: PURPLE, fontWeight: "800", fontSize: 14 },
  upgradeSub: { color: MUTED, fontSize: 11, marginTop: 2 },
  upgradeBtn: {
    backgroundColor: PURPLE,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  upgradeBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  milestoneCard: {
    backgroundColor: BG,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  milestoneTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  milestoneTopLeft: { flex: 1, paddingRight: 12 },
  milestoneEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: MUTED,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  milestoneExerciseName: { fontSize: 13, fontWeight: "700", color: TEXT, marginBottom: 4 },
  milestoneLastMeta: { fontSize: 11, color: MUTED },
  milestoneCountCol: { alignItems: "flex-end" },
  milestoneCount: { fontSize: 28, fontWeight: "800", color: TEXT, lineHeight: 32 },
  milestoneCountMet: { color: GREEN },
  milestoneCountDenom: { fontSize: 11, color: MUTED, marginTop: 2 },
  milestoneTileRow: { flexDirection: "row", gap: 7, marginBottom: 12 },
  milestoneTile: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  milestoneTileFilled: { backgroundColor: GREEN },
  milestoneTileExtra: { backgroundColor: PURPLE },
  milestoneTileBonus: { backgroundColor: ORANGE },
  milestoneTileEmpty: { backgroundColor: TRACK },
  milestoneTileCheck: { fontSize: 14, fontWeight: "800", color: WHITE },
  milestoneTileBonusText: { fontSize: 12, fontWeight: "800", color: WHITE },
  milestoneTileEmptyText: { fontSize: 12, fontWeight: "700", color: MUTED },
  milestoneProgressTrack: {
    height: 6,
    borderRadius: 100,
    backgroundColor: TRACK,
    overflow: "hidden",
    marginBottom: 10,
  },
  milestoneProgressFill: { height: 6, borderRadius: 100, backgroundColor: GREEN },
  milestoneFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  milestoneFooterGoal: { fontSize: 11, color: MUTED },
  milestoneFooterSuccess: { fontSize: 11, fontWeight: "700", color: GREEN },
  milestoneFooterRemaining: { fontSize: 11, color: MUTED },
  lastSessionRow: { flexDirection: "row", alignItems: "center" },
  lastSessionBody: { flex: 1, paddingRight: 10 },
  lastSessionTitle: { fontSize: 15, fontWeight: "700", color: TEXT, lineHeight: 20 },
  lastSessionSub: { fontSize: 12, color: MUTED, marginTop: 4 },
  donePill: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  donePillText: { fontSize: 11, fontWeight: "700", color: GREEN },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    color: MUTED,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 4,
  },
  chipDropdownWrap: { marginBottom: 10 },
  chipField: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chipFieldSelected: { backgroundColor: WHITE, borderColor: GREEN },
  chipFieldIdle: { backgroundColor: BG, borderColor: BORDER },
  chipFieldDisabled: { opacity: 0.45 },
  chipFieldText: { fontSize: 15, fontWeight: "600", flex: 1, marginRight: 8 },
  chipFieldTextSelected: { color: TEXT },
  chipFieldTextIdle: { color: MUTED },
  chipChevron: { fontSize: 12, fontWeight: "800" },
  chipChevronSelected: { color: GREEN },
  chipChevronIdle: { color: MUTED },
  chipOptionsCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: WHITE,
    overflow: "hidden",
  },
  chipOptionsScroll: { maxHeight: 220 },
  chipOptionRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  chipOptionRowLast: { borderBottomWidth: 0 },
  chipOptionText: { fontSize: 15, fontWeight: "600", color: TEXT },
  chipOptionTextActive: { color: GREEN, fontWeight: "700" },
  goalLevelRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  goalPill: {
    flex: 1,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  goalPillText: { fontSize: 13, fontWeight: "700", color: GREEN },
  levelPill: {
    flex: 1,
    backgroundColor: PURPLE_LIGHT,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  levelPillText: { fontSize: 13, fontWeight: "700", color: PURPLE },
  guideCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
    overflow: "hidden",
    backgroundColor: WHITE,
  },
  guideCardClosed: { borderColor: BORDER },
  guideCardOpen: { borderColor: GREEN },
  guideHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  guideHeaderLeft: { flexDirection: "row", alignItems: "center", flex: 1, paddingRight: 10 },
  guideIconTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: GREEN_LIGHT,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  guideIconEmoji: { fontSize: 16 },
  guideHeaderText: { flex: 1 },
  guideExerciseName: { fontSize: 13, fontWeight: "700", color: TEXT },
  guideHint: { fontSize: 10, color: MUTED, marginTop: 2 },
  guideChevronCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  guideChevronCircleOpen: { backgroundColor: GREEN_LIGHT },
  guideChevron: { fontSize: 12, color: MUTED, fontWeight: "800" },
  guideChevronOpen: { color: GREEN },
  guideBody: { backgroundColor: WHITE },
  guideDivider: { height: 1, backgroundColor: BORDER },
  guideSection: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  guideSectionLabelGreen: { fontSize: 10, fontWeight: "700", color: GREEN, marginBottom: 8 },
  musclePillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  muscleTag: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  muscleTagText: { fontSize: 11, fontWeight: "600", color: GREEN },
  guideBlockGreen: {
    borderLeftWidth: 3,
    borderLeftColor: GREEN,
    paddingLeft: 12,
    marginHorizontal: 14,
    marginTop: 10,
  },
  guideBlockPurple: {
    borderLeftWidth: 3,
    borderLeftColor: PURPLE,
    paddingLeft: 12,
    marginHorizontal: 14,
    marginTop: 10,
  },
  guideBlockOrange: {
    borderLeftWidth: 3,
    borderLeftColor: ORANGE,
    paddingLeft: 12,
    marginHorizontal: 14,
    marginTop: 10,
  },
  guideBlockLabelGreen: { fontSize: 10, fontWeight: "700", color: GREEN, marginBottom: 6 },
  guideBlockLabelPurple: { fontSize: 10, fontWeight: "700", color: PURPLE, marginBottom: 6 },
  guideBlockLabelOrange: { fontSize: 10, fontWeight: "700", color: ORANGE, marginBottom: 6 },
  guideBlockBody: { fontSize: 12, color: "#555555", lineHeight: 18 },
  proTipBubble: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: BG,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 4,
    gap: 8,
  },
  proTipEmoji: { fontSize: 14 },
  proTipText: { flex: 1, fontSize: 11, color: "#777777", lineHeight: 16 },
  guideDetailDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 8,
  },
  guideDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
  },
  guideDetailLabel: { fontSize: 12, color: MUTED, flex: 1 },
  guideDetailValue: { fontSize: 12, fontWeight: "700", color: TEXT, flex: 1.2, textAlign: "right" },
  guideDetailValueGreen: { fontSize: 12, fontWeight: "700", color: GREEN, flex: 1.2, textAlign: "right" },
  srdCard: {
    backgroundColor: BG,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  strengthPrCard: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  strengthPrCaption: {
    fontSize: 12,
    color: GREEN,
    marginBottom: 10,
    lineHeight: 17,
  },
  srdLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: MUTED,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  srdRow: { flexDirection: "row", gap: 8 },
  srdTile: {
    flex: 1,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  srdTileLabel: { fontSize: 10, color: MUTED, marginBottom: 6 },
  srdTileInput: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT,
    textAlign: "center",
    width: "100%",
    padding: 0,
  },
  srdTileValue: { fontSize: 18, fontWeight: "700", color: TEXT },
  inlineError: { marginBottom: 8, fontSize: 12, fontWeight: "700", color: DANGER },
  estimatePill: {
    alignSelf: "flex-start",
    backgroundColor: GREEN_LIGHT,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  estimatePillText: { fontSize: 12, fontWeight: "700", color: GREEN },
  logBtn: {
    flex: 1,
    height: 56,
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 0,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  logBtnTitle: { fontSize: 15, fontWeight: "700", color: WHITE },
  logBtnSub: { fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 4 },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 12,
  },
  historyHeaderLeft: { flex: 1 },
  historyEyebrow: { fontSize: 10, fontWeight: "700", color: MUTED, textTransform: "uppercase", marginBottom: 4 },
  historyTitle: { fontSize: 16, fontWeight: "700", color: TEXT },
  historyHeaderRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyCount: { fontSize: 12, fontWeight: "700", color: GREEN },
  historyChevron: { fontSize: 14, color: GREEN, fontWeight: "700" },
  historyChevronOpen: { transform: [{ rotate: "180deg" }] },
  allTimeHistoryBtn: { paddingVertical: 6, paddingLeft: 4 },
  allTimeHistoryText: { fontSize: 13, fontWeight: "500", color: GREEN },
  emptyHistory: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 18, marginTop: 12, alignItems: "center" },
  emptyHistoryTitle: { fontSize: 16, fontWeight: "700", color: TEXT, marginBottom: 6 },
  emptyHistorySub: { fontSize: 13, lineHeight: 19, textAlign: "center", color: MUTED },
  historyRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingRight: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    alignItems: "center",
    marginTop: 12,
  },
  historyRowLast: { borderBottomWidth: 0 },
  historyStripe: { width: 4, height: 40, borderRadius: 2, marginRight: 12, backgroundColor: GREEN },
  historyBody: { flex: 1, minWidth: 0, justifyContent: "center", paddingRight: 6 },
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  historySessionLine: { fontWeight: "700", fontSize: 14, lineHeight: 19, color: TEXT, flexShrink: 1 },
  historySessionMeta: { fontSize: 11, fontWeight: "600", marginTop: 4, color: MUTED },
  sourceBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  sourceBadgeText: { fontSize: 10, fontWeight: "800" },
  historyStrengthMeta: { fontSize: 11, fontWeight: "700", marginTop: 4, color: GREEN },
  newPrBadge: {
    backgroundColor: "#FFF4CC",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  newPrBadgeText: { fontSize: 10, fontWeight: "900", color: "#9A5A00" },
  partialBadge: {
    backgroundColor: "#E5E7EB",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  partialBadgeText: { fontSize: 10, fontWeight: "800", color: "#6B7280" },
  historyActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginLeft: 6, flexShrink: 0 },
  editLogBtn: {
    minWidth: 52,
    height: 32,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  editLogText: { fontSize: 12, fontWeight: "700", color: GREEN },
  deleteLogBtn: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteLogText: { fontSize: 16, fontWeight: "900", lineHeight: 18, color: DANGER },
  inputGrid: { flexDirection: "row", gap: 10, marginBottom: 0 },
  inputGridHalf: { flex: 1, minWidth: "40%" },
  durationWrap: { marginBottom: 8 },
  durationLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  durationField: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  durationValue: { fontSize: 15, fontWeight: "700" },
  durationModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26,26,24,0.32)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  durationModalCard: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    backgroundColor: WHITE,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  durationModalTitle: { color: TEXT, fontSize: 20, fontWeight: "900" },
  durationModalSub: { color: "#6F766F", fontSize: 13, marginTop: 4, marginBottom: 16 },
  durationPickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  durationCol: { alignItems: "center", flex: 1 },
  durationUnit: { color: "#6F766F", fontSize: 11, fontWeight: "800", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 },
  durationStepBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: BG,
    width: 44,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  durationStepText: { color: GREEN, fontSize: 18, fontWeight: "900" },
  durationNumber: { color: TEXT, fontSize: 30, fontWeight: "900", marginVertical: 8 },
  durationSeparator: { color: TEXT, fontSize: 28, fontWeight: "900", marginHorizontal: 8 },
  durationModalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  durationActionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  durationCancelBtn: { backgroundColor: WHITE, borderColor: BORDER },
  durationSetBtn: { backgroundColor: GREEN_LIGHT, borderColor: GREEN_LIGHT },
  durationCancelText: { color: TEXT, fontSize: 14, fontWeight: "900" },
  durationSetText: { color: GREEN, fontSize: 14, fontWeight: "900" },
  editModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(26,26,24,0.32)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  editModalCard: {
    width: "100%",
    maxWidth: 390,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    backgroundColor: WHITE,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  editModalTitle: { fontSize: 20, fontWeight: "900", color: TEXT },
  editModalSubtitle: { fontSize: 13, fontWeight: "700", color: GREEN, marginTop: 4, marginBottom: 16 },
  editInputWrap: { marginBottom: 12 },
  editInputLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#62625C",
    marginBottom: 7,
  },
  editInputLabelGreen: { color: GREEN },
  editTextInput: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: WHITE,
    color: TEXT,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: "700",
  },
  editStrengthCard: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(15,110,86,0.14)",
    padding: 12,
    marginTop: 4,
  },
  editStrengthTitle: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    color: GREEN,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  editStrengthCaption: { fontSize: 12, color: GREEN, lineHeight: 17, marginBottom: 10 },
  editModalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  editCancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    backgroundColor: WHITE,
  },
  editSaveBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: GREEN,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    backgroundColor: GREEN,
  },
  editCancelText: { fontSize: 14, fontWeight: "900", color: TEXT },
  editSaveText: { fontSize: 14, fontWeight: "900", color: WHITE },
  cameraModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  cameraModalCard: {
    width: "96%",
    height: "94%",
    borderWidth: 1,
    padding: 12,
    alignSelf: "center",
  },
  cameraHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cameraTitle: { fontSize: 16, fontWeight: "800" },
  cameraCloseBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cameraCloseText: { fontSize: 13, fontWeight: "700" },
  cameraPreviewWrap: {
    width: "100%",
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  cameraFloatingCloseBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraFloatingCloseText: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", lineHeight: 20 },
  cameraPermissionBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 12,
  },
  cameraPermissionText: { fontSize: 13, textAlign: "center", lineHeight: 18, fontWeight: "600" },
  cameraAllowBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cameraAllowText: { fontSize: 13, fontWeight: "800" },
  cameraFullScreen: { flex: 1, backgroundColor: "#050b16" },
  cameraPermissionFull: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
    backgroundColor: "#050b16",
  },
  cameraPermissionFullTxt: { color: "#fff", textAlign: "center", fontWeight: "600", lineHeight: 22 },
  cameraCloseLink: { marginTop: 8, padding: 12 },
  cameraCloseLinkTxt: { color: "rgba(255,255,255,0.7)", fontWeight: "600", textDecorationLine: "underline" },
});
