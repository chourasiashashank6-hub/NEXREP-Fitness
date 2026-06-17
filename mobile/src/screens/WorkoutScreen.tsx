import { useCallback, useEffect, useMemo, useState } from "react";
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
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCameraPermissions } from "expo-camera";
import axios from "axios";
import {
  addWorkout,
  deleteWorkout,
  estimateWorkoutCalories,
  getWorkoutCatalogFiltered,
  getWorkoutHistory,
  updateWorkout,
  type WorkoutHistoryItem,
} from "../api/workout";
import { fetchOnboardingMe } from "../api/onboarding";
import { getProfile } from "../api/user";
import { AppInput } from "../components/AppInput";
import ExerciseSearchInput from "../components/ExerciseSearchInput";
import MediaPipeGuidanceView from "../components/MediaPipeGuidanceView";
import type { GlobalExercise } from "../constants/GlobalExercisesData";
import {
  EXERCISE_GUIDANCE,
  type ExerciseGuidance,
} from "../constants/ExerciseGuidanceData";
import type { MediaPipeGuidanceViewProps } from "../components/MediaPipeGuidanceView";
import { useAppTheme } from "../theme";
import { formatDate } from "../utils/date";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const PURPLE = "#534AB7";
const PURPLE_LIGHT = "#F3F0FB";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#E2E2DD";
const DANGER = "#E85B5B";
const BURN_TARGET = 154;

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

const SELECT_CHOICE = "Select choice";
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
  bodyPart: string;
  type: string;
  goalTag: string;
  difficulty: string;
  metValue?: number;
  exerciseName: string;
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

const sessionHistoryLabel = (item: WorkoutHistoryItem): string => {
  const explicit = typeof item.bodyPart === "string" ? item.bodyPart.trim() : "";
  const body = explicit || parseBodyPartFromNotes(item.notes) || "Body";
  const name = String(item.exerciseName || "Exercise").trim() || "Exercise";
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

function formatWorkoutHeaderDate(now: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now);
}

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
  placeholder = "Select choice",
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

export const WorkoutScreen = () => {
  const { colors, radius } = useAppTheme();
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
  const [timeTaken, setTimeTaken] = useState("");
  const [durationPickerOpen, setDurationPickerOpen] = useState(false);
  const [pickerMinutes, setPickerMinutes] = useState(0);
  const [pickerSeconds, setPickerSeconds] = useState(0);
  const [history, setHistory] = useState<WorkoutHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSets, setEditSets] = useState("");
  const [editReps, setEditReps] = useState("");
  const [editTimeTaken, setEditTimeTaken] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mediaPipeReady, setMediaPipeReady] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [estimateKcal, setEstimateKcal] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

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
    return selectedEntry.recommendedWeightKg?.[difficultyKey] || "Not specified";
  }, [selectedEntry, activeDifficulty]);

  useEffect(() => {
    if (!selectedEntry) return;
    const firstNumber = (value: string) => {
      const match = String(value || "").match(/\d+/);
      return match ? match[0] : "";
    };
    if (!performedSets) {
      const nextSets = firstNumber(selectedEntry.sets);
      if (nextSets) setPerformedSets(nextSets);
    }
    if (!performedRepsPerSet) {
      const nextReps = firstNumber(selectedEntry.reps);
      if (nextReps) setPerformedRepsPerSet(nextReps);
    }
  }, [selectedEntry, performedSets, performedRepsPerSet]);

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
      const [historyData, profileData, onboardingData] = await Promise.all([
        getWorkoutHistory(24 * 7),
        getProfile(),
        fetchOnboardingMe().catch(() => null),
      ]);
      setHistory(historyData.items ?? []);
      const resolvedGoalTag = profileData.goalTag || SELECT_CHOICE;
      const onboardingDifficulty = normalizeDifficultyLabel(onboardingData?.onboarding?.goal?.difficulty);
      const profileDifficulty = normalizeDifficultyLabel(profileData.difficulty);
      const resolvedDifficulty = onboardingDifficulty || profileDifficulty || SELECT_CHOICE;
      setProfileGoalTag(resolvedGoalTag);
      setProfileDifficulty(resolvedDifficulty);
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
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : "Failed to load workout data.";
      Alert.alert("Error", String(message));
    }
  };

  useEffect(() => {
    loadInitial();
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Always show planner form when user returns to this tab.
      setShowHistory(false);
      loadInitial({ preservePlannerState: true });
    }, [needsGoalTagInput, needsDifficultyInput]),
  );

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
    if (seconds > 59) return "second range is from 0 to 60";
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
      setType(globalExercise.is_compound ? "Compound" : "Isolation");
      setRecommendation("3-4 sets x 8-12 reps, rest 60s");
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
    setType(exercise.is_compound ? "Compound" : "Isolation");
    setRecommendation("3-4 sets x 8-12 reps, rest 60s");
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
    const durMatch = /^(\d{1,3}):(\d{1,2})$/.exec(timeTaken.trim());
    const durationMin = durMatch
      ? Math.max(1, Math.round(Number(durMatch[1]) + Number(durMatch[2]) / 60))
      : 1;

    if (resolvedEntry) {
      return {
        type: workoutTypeFromCatalog(resolvedEntry.type),
        exerciseName,
        sets: parsedSets,
        reps: parsedReps,
        duration: durationMin,
        difficulty: activeDifficulty === SELECT_CHOICE ? resolvedEntry.difficulty : activeDifficulty,
        metValue: resolvedEntry.metValue,
        timeTaken,
      };
    }

    if (selectedGlobalExercise) {
      return {
        type: workoutTypeFromGlobalCategory(selectedGlobalExercise.category),
        exerciseName,
        sets: parsedSets,
        reps: parsedReps,
        duration: durationMin,
        difficulty: activeDifficulty === SELECT_CHOICE ? selectedGlobalExercise.difficulty : activeDifficulty,
        metValue: selectedGlobalExercise.met_value,
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
    const t = setTimeout(() => {
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
                ? "Live kcal preview is unavailable. Restart backend to load /workout/estimate."
                : "Could not load live kcal preview right now."
              : "Could not load live kcal preview right now.";
            setEstimateError(message);
          }
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
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
      Alert.alert("Missing fields", "Please select goal_tag.");
      return;
    }
    if (needsDifficultyInput && difficulty === SELECT_CHOICE) {
      Alert.alert("Missing fields", "Please select difficulty.");
      return;
    }
    if (bodyPart === SELECT_CHOICE || type === SELECT_CHOICE || exerciseName === SELECT_CHOICE) {
      Alert.alert("Missing fields", "Please complete body part, exercise, and type.");
      return;
    }
    if (!performedSets || !performedRepsPerSet || !timeTaken) {
      Alert.alert("Missing fields", "Please fill sets performed, reps per set, and time taken.");
      return;
    }
    const parsedSets = Number(performedSets);
    const parsedReps = Number(performedRepsPerSet);
    if (!Number.isInteger(parsedSets) || parsedSets <= 0) {
      Alert.alert("Invalid sets", "No. of sets must be a positive integer.");
      return;
    }
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) {
      Alert.alert("Invalid reps", "No. of reps per set must be a positive integer.");
      return;
    }
    if (!isValidTimeTaken) {
      Alert.alert("Invalid time format", "Use m:s, mm:ss, or similar. Examples: 5:0, 05:00, 12:30");
      return;
    }

    const resolvedEntry = selectedEntry;

    const globalEntry = !resolvedEntry ? selectedGlobalExercise : null;
    if (!resolvedEntry && !globalEntry) {
      Alert.alert("Invalid selection", "No matching workout found. Try a different combination.");
      return;
    }

    try {
      if (resolvedEntry) {
        const resolvedRecommendation =
          recommendation !== SELECT_CHOICE ? recommendation : resolvedEntry.recommendation;
        await addWorkout({
          type: workoutTypeFromCatalog(resolvedEntry.type),
          exerciseName,
          sets: parsedSets,
          reps: parsedReps,
          duration: toDurationMinutes(timeTaken),
          difficulty: activeDifficulty === SELECT_CHOICE ? resolvedEntry.difficulty : activeDifficulty,
          metValue: resolvedEntry.metValue,
          timeTaken,
          notes: `body_part=${resolvedEntry.bodyPart}; goal_tag=${activeGoalTag === SELECT_CHOICE ? resolvedEntry.goalTag : activeGoalTag}; difficulty=${activeDifficulty === SELECT_CHOICE ? resolvedEntry.difficulty : activeDifficulty}; equipment=${resolvedEntry.equipment}; recommendation=${resolvedRecommendation}; recommended_weight_kg=${recommendedWeight}; planned_sets=${resolvedEntry.sets}; planned_reps=${resolvedEntry.reps}; planned_duration=${resolvedEntry.duration}`,
        });
      } else if (globalEntry) {
        await addWorkout({
          type: workoutTypeFromGlobalCategory(globalEntry.category),
          exerciseName,
          sets: parsedSets,
          reps: parsedReps,
          duration: toDurationMinutes(timeTaken),
          difficulty: activeDifficulty === SELECT_CHOICE ? globalEntry.difficulty : activeDifficulty,
          metValue: globalEntry.met_value,
          timeTaken,
          notes: `body_part=${bodyPart}; global_exercise=1; equipment=${globalEntry.equipment}; category=${globalEntry.category}; difficulty=${globalEntry.difficulty}`,
        });
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
      setTimeTaken("");
      await loadInitial({ preservePlannerState: true });
      Alert.alert("Saved", "Workout submitted and calories burned updated.");
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : "Workout could not be saved.";
      Alert.alert("Error", String(message));
    }
  };

  const openEditModal = (item: WorkoutHistoryItem) => {
    setEditingId(item.id);
    setEditSets(String(item.sets ?? ""));
    setEditReps(String(item.reps ?? ""));
    setEditTimeTaken(toTimeTaken(item.duration));
  };

  const submitEdit = async () => {
    if (editingId == null || savingEdit) return;
    const parsedSets = Number(editSets);
    const parsedReps = Number(editReps);
    if (!Number.isInteger(parsedSets) || parsedSets <= 0) {
      Alert.alert("Invalid sets", "No. of sets must be a positive integer.");
      return;
    }
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) {
      Alert.alert("Invalid reps", "No. of reps per set must be a positive integer.");
      return;
    }
    const parsedTime = /^(\d{1,3}):(\d{1,2})$/.exec(editTimeTaken.trim());
    if (!parsedTime) {
      Alert.alert("Invalid time format", "Use m:s, mm:ss, or similar. Examples: 5:0, 05:00, 12:30");
      return;
    }
    const seconds = Number(parsedTime[2]);
    if (seconds > 59) {
      Alert.alert("Invalid time format", "Seconds must be between 0 and 59.");
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
      Alert.alert("Updated", "Workout session updated.");
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : "Workout could not be updated.";
      Alert.alert("Error", String(message));
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
      Alert.alert("Deleted", "Workout log removed successfully.");
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : "Workout could not be deleted.";
      Alert.alert("Error", String(message));
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
          setCameraError("Camera permission denied. Please allow camera access.");
          setShowCamera(true);
          return;
        }
      } else if (!cameraPermission.granted) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          setCameraError("Camera permission denied. Please allow camera access.");
          setShowCamera(true);
          return;
        }
      }
      setShowCamera(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Camera failed to open.";
      setCameraError(message);
      setShowCamera(true);
    }
  };
  const closeCameraTracker = () => {
    // Ensure detection/camera stream shuts down with the view.
    setShowCamera(false);
    setMediaPipeReady(false);
    setCameraError(null);
  };

  const canOpenCamera = exerciseName !== SELECT_CHOICE;
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const todayHistory = useMemo(() => {
    if (!todayKey) return [];
    return history.filter((item) => toDateKey(item?.date) === todayKey);
  }, [history, todayKey]);
  const latestTodayWorkout = todayHistory[0];
  const todayCaloriesBurned = useMemo(
    () => todayHistory.reduce((sum, item) => sum + (Number(item?.caloriesBurned) || 0), 0),
    [todayHistory],
  );
  const todaySessionCount = todayHistory.length;
  const burnTargetReached = todayCaloriesBurned >= BURN_TARGET;
  const burnProgressPct = Math.min(todayCaloriesBurned / BURN_TARGET, 1);
  const headerDateLabel = useMemo(() => formatWorkoutHeaderDate(new Date()), []);
  const exerciseGuidance = useMemo(() => findExerciseGuidance(exerciseName), [exerciseName]);
  const showGuideCard = exerciseName !== SELECT_CHOICE && !isNoChoice(exerciseName);
  const movementTypeDisplay =
    selectedEntry?.type ?? (type !== SELECT_CHOICE ? type : "—");
  const recommendationDisplay = recommendation !== SELECT_CHOICE ? recommendation : "—";
  const weightDisplay = recommendedWeight !== SELECT_CHOICE ? recommendedWeight : "—";
  const displayGoalTag = profileGoalTag !== SELECT_CHOICE ? profileGoalTag : goalTag;
  const displayDifficulty = profileDifficulty !== SELECT_CHOICE ? profileDifficulty : difficulty;

  const toggleGuide = () => {
    LayoutAnimation.easeInEaseOut();
    setGuideOpen((prev) => !prev);
  };

  const toggleHistory = () => {
    LayoutAnimation.easeInEaseOut();
    setShowHistory((prev) => !prev);
  };

  const mediaPipeProps: MediaPipeGuidanceViewProps = {
    selectedExerciseName: canOpenCamera ? exerciseName : undefined,
    isActive: showCamera,
    onReady: () => {
      setMediaPipeReady(true);
      setCameraError(null);
    },
    onError: (message: string) => {
      setCameraError(message);
      setMediaPipeReady(false);
    },
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.greetingHeader}>
          <View style={styles.greetingLeft}>
            <Text style={styles.greetingDate}>{headerDateLabel}</Text>
            <Text style={styles.greetingTitle}>Workout Log 🏋️</Text>
          </View>
          {canOpenCamera ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open camera tracker"
              style={styles.headerCameraBtn}
              onPress={() => void openCameraTracker()}
            >
              <Text style={styles.headerCameraEmoji}>📷</Text>
            </Pressable>
          ) : null}
        </View>

        {todaySessionCount > 0 ? (
          <View style={styles.milestoneCard}>
            <View style={styles.milestoneTopRow}>
              <View style={styles.milestoneTopLeft}>
                <Text style={styles.milestoneEyebrow}>SESSION MILESTONE</Text>
                {latestTodayWorkout ? (
                  <>
                    <Text style={styles.milestoneExerciseName} numberOfLines={1}>
                      {bodyPartEmoji(
                        latestTodayWorkout.bodyPart || parseBodyPartFromNotes(latestTodayWorkout.notes) || "Body",
                      )}{" "}
                      {latestTodayWorkout.exerciseName}
                    </Text>
                    <Text style={styles.milestoneLastMeta}>
                      Last session · {Math.round(Number(latestTodayWorkout.caloriesBurned) || 0)} kcal
                    </Text>
                  </>
                ) : null}
              </View>
              <View style={styles.milestoneCountCol}>
                <Text style={[styles.milestoneCount, todaySessionCount >= 6 ? styles.milestoneCountMet : null]}>
                  {todaySessionCount}
                </Text>
                <Text style={styles.milestoneCountDenom}>/ 6 sessions</Text>
              </View>
            </View>

            <View style={styles.milestoneTileRow}>
              {Array.from({ length: Math.max(todaySessionCount, 6) }, (_, index) => {
                const tileNum = index + 1;
                const filled = tileNum <= Math.min(todaySessionCount, 6);
                const bonus = tileNum > 6;
                const empty = !filled && !bonus;
                return (
                  <View
                    key={`milestone-tile-${tileNum}`}
                    style={[
                      styles.milestoneTile,
                      filled ? styles.milestoneTileFilled : null,
                      bonus ? styles.milestoneTileBonus : null,
                      empty ? styles.milestoneTileEmpty : null,
                    ]}
                  >
                    {filled ? (
                      <Text style={styles.milestoneTileCheck}>✓</Text>
                    ) : bonus ? (
                      <Text style={styles.milestoneTileBonusText}>+{tileNum - 6}</Text>
                    ) : (
                      <Text style={styles.milestoneTileEmptyText}>{tileNum}</Text>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={styles.milestoneProgressTrack}>
              <View
                style={[
                  styles.milestoneProgressFill,
                  { width: `${Math.min(todaySessionCount / 6, 1) * 100}%` },
                ]}
              />
            </View>

            <View style={styles.milestoneFooterRow}>
              <Text style={styles.milestoneFooterGoal}>Goal: 6 sessions</Text>
              {todaySessionCount > 6 ? (
                <Text style={styles.milestoneFooterSuccess}>
                  🎉 Goal crushed! +{todaySessionCount - 6} bonus
                </Text>
              ) : todaySessionCount === 6 ? (
                <Text style={styles.milestoneFooterSuccess}>✓ Goal reached!</Text>
              ) : (
                <Text style={styles.milestoneFooterRemaining}>{6 - todaySessionCount} more to go</Text>
              )}
            </View>
          </View>
        ) : null}

        <View style={styles.kpiRow}>
          <View style={styles.kpiPill}>
            <Text style={styles.kpiEmoji}>🔥</Text>
            <Text style={styles.kpiValueOrange}>{todayCaloriesBurned}</Text>
            <Text style={styles.kpiLabel}>kcal burned</Text>
          </View>
          <View style={styles.kpiPill}>
            <Text style={styles.kpiEmoji}>✅</Text>
            <Text style={styles.kpiValue}>{todaySessionCount}</Text>
            <Text style={styles.kpiLabel}>sessions</Text>
          </View>
          <View style={styles.kpiPill}>
            <Text style={styles.kpiEmoji}>🎯</Text>
            <Text style={styles.kpiValueGreen}>{BURN_TARGET}</Text>
            <Text style={styles.kpiLabel}>target</Text>
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
            <Text style={styles.burnTitle}>🔥 Burn progress</Text>
            {burnTargetReached ? (
              <Text style={styles.burnTargetReached}>✓ Target reached!</Text>
            ) : (
              <Text style={styles.burnMeta}>
                {todayCaloriesBurned} / {BURN_TARGET} kcal
              </Text>
            )}
          </View>
          <View style={styles.burnTrack}>
            <View style={[styles.burnFill, { width: `${burnProgressPct * 100}%` }]} />
          </View>
        </View>

        {todaySessionCount > 0 && latestTodayWorkout ? (
          <View style={styles.bgCard}>
            <View style={styles.lastSessionRow}>
              <View style={styles.lastSessionBody}>
                <Text style={styles.lastSessionTitle} numberOfLines={2}>
                  {bodyPartEmoji(
                    latestTodayWorkout.bodyPart || parseBodyPartFromNotes(latestTodayWorkout.notes) || "Body",
                  )}{" "}
                  {latestTodayWorkout.exerciseName}
                </Text>
                <Text style={styles.lastSessionSub} numberOfLines={1}>
                  {latestTodayWorkout.bodyPart || parseBodyPartFromNotes(latestTodayWorkout.notes) || "Body"} ·{" "}
                  {Math.round(Number(latestTodayWorkout.caloriesBurned) || 0)} kcal · {latestTodayWorkout.sets ?? 0} ×{" "}
                  {latestTodayWorkout.reps ?? 0}
                </Text>
              </View>
              <View style={styles.donePill}>
                <Text style={styles.donePillText}>Done ✓</Text>
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Log new workout</Text>

        {needsGoalTagInput ? (
          <ChipDropdownField
            value={goalTag}
            options={goalTagOptions}
            placeholder="Goal tag"
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
            placeholder="Difficulty"
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
          placeholder="Body part"
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
          placeholder="Exercise"
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
                    {guideOpen ? "Tap to collapse guide" : "Tap to see exercise guide"}
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
                    <Text style={styles.guideSectionLabelGreen}>🎯 MUSCLES WORKED</Text>
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
                    <Text style={styles.guideBlockLabelGreen}>🧍 POSTURE</Text>
                    <Text style={styles.guideBlockBody}>{exerciseGuidance.posture}</Text>
                  </View>
                ) : null}

                {exerciseGuidance?.formCues ? (
                  <View style={styles.guideBlockPurple}>
                    <Text style={styles.guideBlockLabelPurple}>✋ FORM CUES</Text>
                    <Text style={styles.guideBlockBody}>{exerciseGuidance.formCues}</Text>
                  </View>
                ) : null}

                {exerciseGuidance?.cautions ? (
                  <View style={styles.guideBlockOrange}>
                    <Text style={styles.guideBlockLabelOrange}>⚠️ CAUTIONS</Text>
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
                  <Text style={styles.guideDetailLabel}>Movement</Text>
                  <Text style={styles.guideDetailValue} numberOfLines={2}>
                    {movementTypeDisplay}
                  </Text>
                </View>
                <View style={styles.guideDetailRow}>
                  <Text style={styles.guideDetailLabel}>Recommendation</Text>
                  <Text style={styles.guideDetailValue} numberOfLines={3}>
                    {recommendationDisplay}
                  </Text>
                </View>
                <View style={styles.guideDetailRow}>
                  <Text style={styles.guideDetailLabel}>Suggested weight</Text>
                  <Text style={styles.guideDetailValueGreen} numberOfLines={2}>
                    {weightDisplay}
                  </Text>
                </View>
              </View>
            ) : null}
          </Pressable>
        ) : null}

        <View style={styles.srdCard}>
          <Text style={styles.srdLabel}>Sets · Reps · Duration</Text>
          <View style={styles.srdRow}>
            <View style={styles.srdTile}>
              <Text style={styles.srdTileLabel}>Sets</Text>
              <TextInput
                style={styles.srdTileInput}
                placeholder="4"
                placeholderTextColor={MUTED}
                value={performedSets}
                onChangeText={(value) => setPerformedSets(value.replace(/\D/g, ""))}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={styles.srdTile}>
              <Text style={styles.srdTileLabel}>Reps</Text>
              <TextInput
                style={styles.srdTileInput}
                placeholder="12"
                placeholderTextColor={MUTED}
                value={performedRepsPerSet}
                onChangeText={(value) => setPerformedRepsPerSet(value.replace(/\D/g, ""))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
            <Pressable style={styles.srdTile} onPress={openDurationPicker}>
              <Text style={styles.srdTileLabel}>Duration</Text>
              <Text style={styles.srdTileValue}>{timeTaken || "00:00"}</Text>
            </Pressable>
          </View>
        </View>

        {timeRangeError ? <Text style={styles.inlineError}>{timeRangeError}</Text> : null}
        {estimateKcal != null && workoutEstimatePayload ? (
          <View style={styles.estimatePill}>
            <Text style={styles.estimatePillText}>~{estimateKcal} kcal estimated</Text>
          </View>
        ) : null}
        {estimateError ? <Text style={styles.inlineError}>{estimateError}</Text> : null}

        <Pressable style={styles.logBtn} onPress={submit}>
          <Text style={styles.logBtnTitle}>Log workout 🔥</Text>
          <Text style={styles.logBtnSub}>Saves to history & updates burn</Text>
        </Pressable>

        <View style={styles.bgCard}>
          <Pressable style={styles.historyHeader} onPress={toggleHistory}>
            <View style={styles.historyHeaderLeft}>
              <Text style={styles.historyEyebrow}>Recent</Text>
              <Text style={styles.historyTitle}>Session history</Text>
            </View>
            <View style={styles.historyHeaderRight}>
              <Text style={styles.historyCount}>{todaySessionCount} today</Text>
              <Text style={[styles.historyChevron, showHistory ? styles.historyChevronOpen : null]}>▾</Text>
            </View>
          </Pressable>

          {showHistory ? (
            todayHistory.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Text style={styles.emptyHistoryTitle}>No sessions today</Text>
                <Text style={styles.emptyHistorySub}>
                  Log a workout above — today&apos;s entries will appear here with type, burn, and date.
                </Text>
              </View>
            ) : (
              todayHistory.map((item, idx) => (
                <View
                  key={item.id}
                  style={[styles.historyRow, idx === todayHistory.length - 1 ? styles.historyRowLast : null]}
                >
                  <View style={styles.historyStripe} />
                  <View style={styles.historyBody}>
                    <Text style={styles.historySessionLine} numberOfLines={2}>
                      {sessionHistoryLabel(item)}
                    </Text>
                    <Text style={styles.historySessionMeta} numberOfLines={1}>
                      {String(item.type || "")} · {formatDate(item.date)}
                    </Text>
                  </View>
                  <View style={styles.historyActions}>
                    <Pressable
                      style={styles.editLogBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      onPress={() => openEditModal(item)}
                      disabled={deletingId === item.id}
                    >
                      <Text style={styles.editLogText}>Edit</Text>
                    </Pressable>
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
              ))
            )
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={durationPickerOpen} transparent animationType="fade" onRequestClose={() => setDurationPickerOpen(false)}>
        <View style={styles.durationModalBackdrop}>
          <View style={[styles.durationModalCard, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.lg }]}>
            <Text style={[styles.durationModalTitle, { color: colors.text }]}>Set Duration</Text>
            <Text style={[styles.durationModalSub, { color: colors.muted }]}>Pick minutes and seconds</Text>
            <View style={styles.durationPickerRow}>
              <View style={styles.durationCol}>
                <Text style={[styles.durationUnit, { color: colors.muted }]}>Minutes</Text>
                <Pressable
                  style={[styles.durationStepBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  onPress={() => setPickerMinutes((m) => Math.max(0, m - 1))}
                >
                  <Text style={[styles.durationStepText, { color: colors.text }]}>−</Text>
                </Pressable>
                <Text style={[styles.durationNumber, { color: colors.text }]}>{pickerMinutes}</Text>
                <Pressable
                  style={[styles.durationStepBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  onPress={() => setPickerMinutes((m) => Math.min(999, m + 1))}
                >
                  <Text style={[styles.durationStepText, { color: colors.text }]}>＋</Text>
                </Pressable>
              </View>

              <Text style={[styles.durationSeparator, { color: colors.text }]}>:</Text>

              <View style={styles.durationCol}>
                <Text style={[styles.durationUnit, { color: colors.muted }]}>Seconds</Text>
                <Pressable
                  style={[styles.durationStepBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  onPress={() => setPickerSeconds((s) => Math.max(0, s - 1))}
                >
                  <Text style={[styles.durationStepText, { color: colors.text }]}>−</Text>
                </Pressable>
                <Text style={[styles.durationNumber, { color: colors.text }]}>{String(pickerSeconds).padStart(2, "0")}</Text>
                <Pressable
                  style={[styles.durationStepBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  onPress={() => setPickerSeconds((s) => Math.min(59, s + 1))}
                >
                  <Text style={[styles.durationStepText, { color: colors.text }]}>＋</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.durationModalActions}>
              <Pressable
                style={[styles.durationActionBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                onPress={() => setDurationPickerOpen(false)}
              >
                <Text style={[styles.durationActionText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.durationActionBtn, { borderColor: colors.primary, backgroundColor: colors.primary }]}
                onPress={applyDurationSelection}
              >
                <Text style={[styles.durationActionText, { color: colors.background }]}>Set</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editingId !== null} transparent animationType="fade" onRequestClose={() => setEditingId(null)}>
        <View style={styles.durationModalBackdrop}>
          <View style={[styles.durationModalCard, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.lg }]}>
            <Text style={[styles.durationModalTitle, { color: colors.text }]}>Edit workout session</Text>
            <View style={styles.inputGrid}>
              <View style={styles.inputGridHalf}>
                <AppInput
                  label="Sets"
                  placeholder="4"
                  value={editSets}
                  onChangeText={(value) => setEditSets(value.replace(/\D/g, ""))}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
              <View style={styles.inputGridHalf}>
                <AppInput
                  label="Reps / set"
                  placeholder="12"
                  value={editReps}
                  onChangeText={(value) => setEditReps(value.replace(/\D/g, ""))}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            </View>
            <View style={styles.durationWrap}>
              <AppInput
                label="Time taken (mm:ss)"
                placeholder="12:30"
                value={editTimeTaken}
                onChangeText={setEditTimeTaken}
              />
            </View>
            <View style={styles.durationModalActions}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.durationActionBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                onPress={() => {
                  if (savingEdit) return;
                  setEditingId(null);
                }}
              >
                <Text style={[styles.durationActionText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.durationActionBtn, { borderColor: colors.primary, backgroundColor: colors.primary }, savingEdit ? { opacity: 0.7 } : null]}
                onPress={() => void submitEdit()}
                disabled={savingEdit}
              >
                <Text style={[styles.durationActionText, { color: colors.background }]}>{savingEdit ? "Saving..." : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showCamera} transparent animationType="slide" onRequestClose={closeCameraTracker}>
        <View style={styles.cameraModalBackdrop}>
          <View style={[styles.cameraModalCard, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.lg }]}>
            <View style={styles.cameraHeaderRow}>
              <Text style={[styles.cameraTitle, { color: colors.text }]}>Workout camera tracker</Text>
              <Pressable
                style={[styles.cameraCloseBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                onPress={closeCameraTracker}
              >
                <Text style={[styles.cameraCloseText, { color: colors.text }]}>Close</Text>
              </Pressable>
            </View>
            {cameraPermission?.granted ? (
              <View style={[styles.cameraPreviewWrap, { borderColor: colors.border }]}>
                <MediaPipeGuidanceView
                  {...mediaPipeProps}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close camera"
                  style={[styles.cameraFloatingCloseBtn, { borderColor: colors.border, backgroundColor: "rgba(0,0,0,0.6)" }]}
                  onPress={closeCameraTracker}
                >
                  <Text style={styles.cameraFloatingCloseText}>✕</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.cameraPermissionBox, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
                <Text style={[styles.cameraPermissionText, { color: colors.text }]}>
                  {cameraError || "Camera permission is required to use workout tracking."}
                </Text>
                <Pressable
                  style={[styles.cameraAllowBtn, { borderColor: colors.primary, backgroundColor: colors.primary }]}
                  onPress={() => void openCameraTracker()}
                >
                  <Text style={[styles.cameraAllowText, { color: colors.background }]}>Allow Camera</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WHITE },
  scroll: { flex: 1, backgroundColor: WHITE },
  scrollContent: { padding: 16, paddingBottom: 40 },
  greetingHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  greetingLeft: { flex: 1, paddingRight: 12 },
  greetingDate: { fontSize: 13, color: MUTED, marginBottom: 4 },
  greetingTitle: { fontSize: 22, fontWeight: "700", color: TEXT },
  headerCameraBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCameraEmoji: { fontSize: 18 },
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
  burnTrack: {
    height: 7,
    borderRadius: 100,
    backgroundColor: TRACK,
    overflow: "hidden",
  },
  burnFill: { height: 7, borderRadius: 100, backgroundColor: ORANGE },
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
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  logBtnTitle: { fontSize: 15, fontWeight: "700", color: WHITE },
  logBtnSub: { fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 4 },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyHeaderLeft: { flex: 1 },
  historyEyebrow: { fontSize: 10, fontWeight: "700", color: MUTED, textTransform: "uppercase", marginBottom: 4 },
  historyTitle: { fontSize: 16, fontWeight: "700", color: TEXT },
  historyHeaderRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyCount: { fontSize: 12, fontWeight: "700", color: GREEN },
  historyChevron: { fontSize: 14, color: GREEN, fontWeight: "700" },
  historyChevronOpen: { transform: [{ rotate: "180deg" }] },
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
  historySessionLine: { fontWeight: "700", fontSize: 14, lineHeight: 19, color: TEXT },
  historySessionMeta: { fontSize: 11, fontWeight: "600", marginTop: 4, color: MUTED },
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
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  durationModalCard: {
    width: "100%",
    maxWidth: 360,
    borderWidth: 1,
    padding: 16,
  },
  durationModalTitle: { fontSize: 18, fontWeight: "800" },
  durationModalSub: { fontSize: 12, marginTop: 4, marginBottom: 14 },
  durationPickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  durationCol: { alignItems: "center", flex: 1 },
  durationUnit: { fontSize: 11, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 },
  durationStepBtn: {
    borderWidth: 1,
    borderRadius: 10,
    width: 44,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  durationStepText: { fontSize: 18, fontWeight: "800" },
  durationNumber: { fontSize: 28, fontWeight: "900", marginVertical: 8 },
  durationSeparator: { fontSize: 28, fontWeight: "900", marginHorizontal: 8 },
  durationModalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  durationActionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  durationActionText: { fontSize: 14, fontWeight: "800" },
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
});
