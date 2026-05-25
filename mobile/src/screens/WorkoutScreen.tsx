import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
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
import { AppCard } from "../components/AppCard";
import { AppInput } from "../components/AppInput";
import ExerciseGuidanceCard from "../components/ExerciseGuidanceCard";
import ExerciseSearchInput from "../components/ExerciseSearchInput";
import MediaPipeGuidanceView from "../components/MediaPipeGuidanceView";
import type { GlobalExercise } from "../constants/GlobalExercisesData";
import type { MediaPipeGuidanceViewProps } from "../components/MediaPipeGuidanceView";
import { ScreenContainer } from "../components/ScreenContainer";
import { useAppTheme } from "../theme";
import { formatDate } from "../utils/date";

const SELECT_CHOICE = "Select choice";
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
const SESSION_MILESTONES = [1, 2, 3, 4, 5, 6] as const;
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

const DropdownField = ({
  label,
  value,
  options,
  enabled = true,
  onChange,
  colors,
  radius,
}: {
  label: string;
  value: string;
  options: string[];
  enabled?: boolean;
  onChange: (value: string) => void;
  colors: { text: string; muted: string; border: string; cardAlt: string; tabBg: string; primary: string; inputBg: string };
  radius: { md: number; lg: number };
}) => {
  const [open, setOpen] = useState(false);
  const isPlaceholder = value === SELECT_CHOICE;

  return (
    <View style={styles.selectWrap}>
      <Text style={[styles.selectLabel, { color: colors.muted }]}>{label}</Text>
      <Pressable
        style={({ pressed }) => [
          styles.selectButton,
          {
            borderColor: open ? colors.primary : colors.border,
            backgroundColor: colors.inputBg,
            borderRadius: radius.lg,
          },
          !enabled ? styles.selectDisabled : null,
          pressed && enabled ? styles.selectPressed : null,
        ]}
        disabled={!enabled}
        onPress={() => setOpen((prev) => !prev)}
      >
        <Text
          style={[styles.selectValue, { color: isPlaceholder ? colors.muted : colors.text }, isPlaceholder ? styles.placeholderValue : null]}
          numberOfLines={1}
        >
          {value}
        </Text>
        <Text style={[styles.selectChevron, { color: colors.muted }]}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open && enabled ? (
        <View style={[styles.optionsCard, { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: radius.lg }]}>
          <ScrollView nestedScrollEnabled style={styles.optionsScroll} keyboardShouldPersistTaps="always">
            {[SELECT_CHOICE, ...options].map((option, index, all) => (
              <Pressable
                key={`${option}-${index}`}
                style={[
                  styles.optionRow,
                  { borderBottomColor: colors.border },
                  option === value ? [styles.optionRowActive, { borderLeftColor: colors.primary }] : null,
                  index === all.length - 1 ? styles.optionRowLast : null,
                ]}
                onPress={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionText, { color: option === value ? colors.primary : colors.text }]}>{option}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  colors,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  colors: { muted: string; text: string };
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionEyebrow, { color: colors.muted }]}>{eyebrow}</Text>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
    </View>
  );
}

function InsightTile({
  label,
  value,
  accent,
  colors,
  radius,
}: {
  label: string;
  value: string;
  accent: readonly [string, string];
  colors: { text: string; muted: string; border: string; inputBg: string };
  radius: { md: number };
}) {
  return (
    <View style={[styles.insightTile, { borderColor: colors.border, backgroundColor: colors.inputBg, borderRadius: radius.md }]}>
      <LinearGradient colors={accent} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.insightAccent} />
      <View style={styles.insightBody}>
        <Text style={[styles.insightLabel, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.insightValue, { color: colors.text }]} numberOfLines={3}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function SetupProgressBar({ filled, total, colors }: { filled: number; total: number; colors: { primary: string; border: string; muted: string } }) {
  const pct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  return (
    <View style={styles.setupProgressWrap}>
      <View style={[styles.setupProgressTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.setupProgressFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
      </View>
      <Text style={[styles.setupProgressCaption, { color: colors.muted }]}>
        Setup {filled}/{total} — filters, exercise, then your sets & time
      </Text>
    </View>
  );
}

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

  const accentPlanner = ["#3b82f6", "#22d3ee", "transparent"] as const;
  const accentHistory = ["#ef4444", "#fb7185", "transparent"] as const;
  const dropdownColors = { ...colors, inputBg: colors.inputBg };
  const canOpenCamera = exerciseName !== SELECT_CHOICE;
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const todayHistory = useMemo(() => {
    if (!todayKey) return [];
    return history.filter((item) => toDateKey(item?.date) === todayKey);
  }, [history, todayKey]);
  const latestTodayWorkout = todayHistory[0];
  const latestWorkoutLabel = latestTodayWorkout ? sessionHistoryLabel(latestTodayWorkout) : "No sessions logged today";
  const todayCaloriesBurned = useMemo(
    () => todayHistory.reduce((sum, item) => sum + (Number(item?.caloriesBurned) || 0), 0),
    [todayHistory],
  );
  const todaySessionCount = todayHistory.length;
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
    <ScreenContainer>
      <Text style={[styles.pageTitle, { color: colors.text }]}>Workout Log</Text>
      <Text style={[styles.pageSub, { color: colors.muted }]}>Track sessions, calories burned, and training progress</Text>

      <AppCard>
        <LinearGradient colors={accentPlanner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardTopAccent} />
        <View style={styles.topTrackerHeader}>
          <View>
            <Text style={[styles.section, { color: colors.text, marginBottom: 0 }]}>Workout tracker</Text>
          </View>
          {canOpenCamera ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open camera tracker"
              style={[styles.cameraIconBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
              onPress={() => void openCameraTracker()}
            >
              <Text style={styles.cameraIconText}>📷</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.toggleHint, { color: colors.muted, marginTop: 4 }]}>
          {todaySessionCount} sessions today · Latest: {latestWorkoutLabel}
        </Text>
        <View style={[styles.lastSessionCard, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
          <Text style={[styles.lastSessionEyebrow, { color: colors.muted }]}>Last session performed today</Text>
          <Text style={[styles.lastSessionValue, { color: colors.text }]}>{latestWorkoutLabel}</Text>
        </View>
        <View style={styles.sessionDialRow}>
          {SESSION_MILESTONES.map((goal) => {
            const isLast = goal === SESSION_MILESTONES[SESSION_MILESTONES.length - 1];
            const hit = todaySessionCount >= goal;
            return (
              <View key={goal} style={styles.sessionDialCell}>
                <View
                  style={[
                    styles.sessionDialRing,
                    {
                      borderColor: hit ? colors.primary : colors.border,
                      backgroundColor: hit ? `${colors.primary}22` : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.sessionDialText, { color: hit ? colors.primary : colors.muted }]}>
                    {isLast ? (todaySessionCount > 6 ? "6+" : "6") : hit ? "✓" : goal}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        <Text style={[styles.dailyBurnLabel, { color: colors.text }]}>Total Calories burned = {todayCaloriesBurned} kcal</Text>
      </AppCard>

      <AppCard>
        <LinearGradient colors={accentPlanner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardTopAccent} />
        {showHistory ? (
          <Pressable
            style={[styles.backToFormBanner, { borderColor: colors.border, backgroundColor: colors.tabBg, borderRadius: radius.lg }]}
            onPress={() => setShowHistory(false)}
          >
            <Text style={[styles.backToFormText, { color: colors.text }]}>Back to workout form</Text>
            <Text style={[styles.headerArrow, { color: colors.muted }]}>▾</Text>
          </Pressable>
        ) : null}

        <View style={showHistory ? styles.hiddenSection : null}>
          <SectionHeader
            eyebrow="STEP 1"
            title="Choose Workout"
            subtitle="Each choice narrows the next list. Disabled fields unlock as you go."
            colors={colors}
          />
          <SetupProgressBar filled={setupStepsFilled} total={4} colors={colors} />

          {needsGoalTagInput ? (
            <DropdownField
              label="Goal tag"
              value={goalTag}
              options={goalTagOptions}
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
              colors={dropdownColors}
              radius={radius}
            />
          ) : null}

          {needsDifficultyInput ? (
            <DropdownField
              label="Difficulty"
              value={difficulty}
              options={difficultyOptions}
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
              colors={dropdownColors}
              radius={radius}
            />
          ) : null}

          <DropdownField
            label="Body part"
            value={bodyPart}
            options={bodyPartOptions}
            enabled={(!needsGoalTagInput || goalTag !== SELECT_CHOICE) && (!needsDifficultyInput || difficulty !== SELECT_CHOICE)}
            onChange={async (value) => {
              setBodyPart(value);
              setType(SELECT_CHOICE);
              setExerciseName(SELECT_CHOICE);
              setSelectedGlobalExercise(null);
              setRecommendation(SELECT_CHOICE);
              await fetchCatalog(buildFilterParams({ bodyPart: value === SELECT_CHOICE ? undefined : value, goalTag, difficulty }));
            }}
            colors={dropdownColors}
            radius={radius}
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
            placeholder="Search or select exercise"
            disabled={bodyPart === SELECT_CHOICE}
            colors={dropdownColors}
            radius={radius}
          />

          <View style={[styles.chipRow, { marginBottom: 12 }]}>
            <View style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.tabBg }]}>
              <Text style={[styles.chipKey, { color: colors.muted }]}>Goal</Text>
              <Text style={[styles.chipVal, { color: colors.text }]} numberOfLines={1}>
                {activeGoalTag}
              </Text>
            </View>
            <View style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.tabBg }]}>
              <Text style={[styles.chipKey, { color: colors.muted }]}>Level</Text>
              <Text style={[styles.chipVal, { color: colors.text }]} numberOfLines={1}>
                {activeDifficulty}
              </Text>
            </View>
          </View>

          <ExerciseGuidanceCard exerciseName={exerciseName} />

          <SectionHeader
            eyebrow="STEP 2"
            title="Exercise detail"
            subtitle="Read-only values from the matched catalog row. Honest numbers drive better calorie estimates."
            colors={colors}
          />

          <View style={styles.insightGrid}>
            <InsightTile label="Movement type" value={type === SELECT_CHOICE ? "—" : type} accent={["#5BC0EB", "#1B3A6F"]} colors={colors} radius={radius} />
            <InsightTile
              label="Recommendation"
              value={recommendation === SELECT_CHOICE ? "—" : recommendation}
              accent={[colors.primary, "#2D4A2F"]}
              colors={colors}
              radius={radius}
            />
            <InsightTile
              label="Suggested weight (kg)"
              value={recommendedWeight === SELECT_CHOICE ? "—" : recommendedWeight}
              accent={["#E8A54B", "#5c4a2f"]}
              colors={colors}
              radius={radius}
            />
          </View>

          <View style={styles.inputGrid}>
            <View style={styles.inputGridHalf}>
              <AppInput
                label="Sets"
                placeholder="4"
                value={performedSets}
                onChangeText={(value) => setPerformedSets(value.replace(/\D/g, ""))}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={styles.inputGridHalf}>
              <AppInput
                label="Reps / set"
                placeholder="12"
                value={performedRepsPerSet}
                onChangeText={(value) => setPerformedRepsPerSet(value.replace(/\D/g, ""))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          </View>
          {timeRangeError ? <Text style={[styles.inlineError, { color: colors.danger }]}>{timeRangeError}</Text> : null}
          {estimateKcal != null && workoutEstimatePayload ? (
            <View style={[styles.estimateBanner, { borderColor: colors.border, backgroundColor: colors.tabBg }]}>
              <Text style={[styles.estimateLabel, { color: colors.muted }]}>Estimated burn (MET)</Text>
              <Text style={[styles.estimateValue, { color: colors.text }]}>~{estimateKcal} kcal</Text>
            </View>
          ) : null}
          {estimateError ? <Text style={[styles.inlineError, { color: colors.danger }]}>{estimateError}</Text> : null}
          <View style={styles.durationWrap}>
            <Text style={[styles.durationLabel, { color: colors.text }]}>Duration (mm:ss)</Text>
            <Pressable
              style={({ pressed }) => [
                styles.durationField,
                { borderColor: colors.border, backgroundColor: colors.inputBg, borderRadius: radius.md },
                pressed ? { opacity: 0.9 } : null,
              ]}
              onPress={openDurationPicker}
            >
              <Text style={[styles.durationValue, { color: colors.text }]}>{timeTaken || "00:00"}</Text>
            </Pressable>
          </View>

          <Pressable onPress={submit} style={({ pressed }) => [styles.ctaWrap, pressed && { opacity: 0.92 }]}>
            <LinearGradient colors={[colors.primary, "#7BC976"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.ctaGradient, { borderRadius: radius.lg }]}>
              <Text style={[styles.ctaLabel, { color: colors.background }]}>Log workout</Text>
              <Text style={[styles.ctaSub, { color: `${colors.background}CC` }]}>Saves to history & updates burn</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </AppCard>

      <AppCard>
        <LinearGradient colors={accentHistory} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cardTopAccent} />
        <Pressable
          style={({ pressed }) => [
            styles.historyToggle,
            { borderColor: colors.border, backgroundColor: colors.inputBg, borderRadius: radius.lg },
            pressed && { opacity: 0.9 },
          ]}
          onPress={() => setShowHistory((prev) => !prev)}
        >
          <View style={styles.cardHeaderContent}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[styles.historyEyebrow, { color: colors.muted }]}>RECENT</Text>
              <Text style={[styles.section, { color: colors.text, marginBottom: 0 }]}>Session history</Text>
              <Text style={[styles.toggleHint, { color: colors.muted }]}>
                {showHistory ? "Tap header to collapse" : `Tap to expand · ${todaySessionCount} saved today`}
              </Text>
            </View>
            <Text style={[styles.headerArrow, { color: colors.muted, transform: [{ rotate: showHistory ? "180deg" : "0deg" }] }]}>▾</Text>
          </View>
        </Pressable>

        {showHistory ? (
          todayHistory.length === 0 ? (
            <View style={[styles.emptyHistory, { borderColor: colors.border, borderRadius: radius.md }]}>
              <Text style={[styles.emptyHistoryTitle, { color: colors.text }]}>No sessions today</Text>
              <Text style={[styles.emptyHistorySub, { color: colors.muted }]}>Log a workout above — today&apos;s entries will appear here with type, burn, and date.</Text>
            </View>
          ) : (
            todayHistory.map((item, idx) => (
              <View
                key={item.id}
                style={[styles.historyRow, { borderBottomColor: colors.border }, idx === todayHistory.length - 1 ? styles.historyRowLast : null]}
              >
                <LinearGradient colors={["#5BC0EB", colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.historyStripe} />
                <View style={styles.historyBody}>
                  <Text style={[styles.historySessionLine, { color: colors.text }]} numberOfLines={2}>
                    {sessionHistoryLabel(item)}
                  </Text>
                  <Text style={[styles.historySessionMeta, { color: colors.muted }]} numberOfLines={1}>
                    {String(item.type || "")} · {formatDate(item.date)}
                  </Text>
                </View>
                <View style={styles.historyActions}>
                  <Pressable
                    style={[styles.editLogBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => openEditModal(item)}
                    disabled={deletingId === item.id}
                  >
                    <Text style={[styles.editLogText, { color: colors.primary }]}>Edit</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.deleteLogBtn, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    disabled={deletingId === item.id}
                    onPress={() => void removeHistoryItem(item.id)}
                  >
                    <Text style={[styles.deleteLogText, { color: colors.danger }]}>{deletingId === item.id ? "…" : "✕"}</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )
        ) : null}
      </AppCard>

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
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  pageTitle: { fontSize: 26, fontWeight: "800", marginBottom: 4 },
  pageSub: { fontSize: 14, marginBottom: 18 },
  cardTopAccent: {
    height: 3,
    width: "100%",
    borderRadius: 2,
    marginBottom: 12,
  },
  backToFormBanner: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backToFormText: { fontSize: 15, fontWeight: "800" },
  sectionHeader: { marginBottom: 14 },
  sectionEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, lineHeight: 18 },
  setupProgressWrap: { marginBottom: 18 },
  setupProgressTrack: { height: 6, borderRadius: 4, overflow: "hidden" },
  setupProgressFill: { height: 6, borderRadius: 4 },
  setupProgressCaption: { fontSize: 11, fontWeight: "600", marginTop: 8, textAlign: "right" },
  chipRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  chip: { flex: 1, minWidth: "42%", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  chipKey: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, marginBottom: 4 },
  chipVal: { fontSize: 14, fontWeight: "700" },
  insightGrid: { gap: 10, marginBottom: 8 },
  insightTile: { flexDirection: "row", overflow: "hidden", borderWidth: 1 },
  insightAccent: { width: 5, minHeight: 72 },
  insightBody: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  insightLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, marginBottom: 6, textTransform: "uppercase" },
  insightValue: { fontSize: 15, fontWeight: "700", lineHeight: 21 },
  inputGrid: { flexDirection: "row", gap: 10, marginBottom: 0 },
  inputGridHalf: { flex: 1, minWidth: "40%" },
  ctaWrap: { marginTop: 6, marginBottom: 4 },
  ctaGradient: { paddingVertical: 16, paddingHorizontal: 16, alignItems: "center" },
  ctaLabel: { fontSize: 17, fontWeight: "900" },
  ctaSub: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  section: { fontWeight: "800", marginBottom: 4, fontSize: 17 },
  historyEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  topTrackerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cameraIconBtn: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraIconText: { fontSize: 19 },
  sessionDialRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  dailyBurnLabel: { marginTop: 12, fontSize: 13, fontWeight: "700" },
  lastSessionCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lastSessionEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  lastSessionValue: { marginTop: 4, fontSize: 14, fontWeight: "700" },
  sessionDialCell: { alignItems: "center", flex: 1 },
  sessionDialRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionDialText: { fontSize: 13, fontWeight: "800" },
  cardHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  headerArrow: { fontSize: 16, fontWeight: "700" },
  historyToggle: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12 },
  toggleHint: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  hiddenSection: { display: "none" },
  selectWrap: { marginBottom: 14 },
  selectLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" },
  selectButton: {
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  selectChevron: { fontSize: 12, fontWeight: "800", marginLeft: 8 },
  selectPressed: { opacity: 0.88 },
  selectDisabled: { opacity: 0.45 },
  selectValue: { fontWeight: "700", fontSize: 15, flex: 1 },
  placeholderValue: { fontWeight: "600" },
  optionsCard: {
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  optionsScroll: { maxHeight: 220 },
  optionRow: { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderLeftColor: "transparent" },
  optionRowLast: { borderBottomWidth: 0 },
  optionRowActive: { backgroundColor: "rgba(168, 230, 163, 0.1)", borderLeftColor: "transparent" },
  optionText: { fontWeight: "600", fontSize: 15 },
  inlineError: { marginBottom: 8, marginTop: -4, fontSize: 12, fontWeight: "700" },
  estimateBanner: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, marginTop: 4 },
  estimateLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
  estimateValue: { fontSize: 22, fontWeight: "900" },
  estimateHint: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  emptyHistory: { borderWidth: 1, padding: 18, marginTop: 8, alignItems: "center" },
  emptyHistoryTitle: { fontSize: 16, fontWeight: "800", marginBottom: 6 },
  emptyHistorySub: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  historyRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingRight: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  historyRowLast: { borderBottomWidth: 0 },
  historyStripe: { width: 4, borderRadius: 2, marginRight: 12 },
  historyBody: { flex: 1, minWidth: 0, justifyContent: "center", paddingRight: 6 },
  historySessionLine: { fontWeight: "800", fontSize: 14, lineHeight: 19 },
  historySessionMeta: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  historyActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginLeft: 6, flexShrink: 0 },
  editLogBtn: {
    minWidth: 52,
    height: 32,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  editLogText: { fontSize: 12, fontWeight: "800" },
  deleteLogBtn: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  deleteLogText: { fontSize: 16, fontWeight: "900", lineHeight: 18 },
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
