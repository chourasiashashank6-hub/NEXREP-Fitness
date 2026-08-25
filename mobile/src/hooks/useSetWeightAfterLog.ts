import { useCallback, useRef, useState } from "react";
import { fetchLoadHints } from "../api/workoutSessions";
import type { TrackingMethod, SetLog } from "../store/workoutSessionStore";
import { useWorkoutSessionStore } from "../store/workoutSessionStore";
import {
  formatPrefillWeight,
  isBodyweightExerciseClient,
  resolvePrefillLoadKg,
} from "../utils/resolveLoadWeight";
import { calcActiveSetKcal } from "../utils/sessionCalories";

export type SetWeightPromptState = {
  exercise_name: string;
  set_number: number;
  reps: number;
  workSec: number;
  restSec: number;
  prescribedReps: number;
  tracking_method: TrackingMethod;
  started_at: string;
  completed_at: string;
  baselineLoadKg: number | null;
  prefillKg: number | null;
  showRest: boolean;
  onDone: () => void;
};

type LoadHints = {
  baseline_load_kg: number | null;
  prefill_kg: number | null;
  is_bodyweight: boolean;
};

type LoggedSetDraft = {
  exercise_name: string;
  set_number: number;
  reps: number;
  workSec: number;
  restSec: number;
  prescribedReps: number;
  tracking_method: TrackingMethod;
  started_at: string;
  completed_at: string;
  form_quality_pct?: number | null;
};

export function useSetWeightAfterLog(userWeightKg: number) {
  const updateSetLog = useWorkoutSessionStore((s) => s.updateSetLog);
  const [weightPrompt, setWeightPrompt] = useState<SetWeightPromptState | null>(null);
  const hintsCache = useRef<Map<string, LoadHints>>(new Map());

  const getLoadHints = useCallback(async (exerciseName: string): Promise<LoadHints> => {
    const cached = hintsCache.current.get(exerciseName);
    if (cached) return cached;
    try {
      const hints = await fetchLoadHints(exerciseName);
      hintsCache.current.set(exerciseName, hints);
      return hints;
    } catch {
      const fallback: LoadHints = {
        baseline_load_kg: null,
        prefill_kg: null,
        is_bodyweight: isBodyweightExerciseClient(exerciseName),
      };
      hintsCache.current.set(exerciseName, fallback);
      return fallback;
    }
  }, []);

  const applyWeight = useCallback(
    (weightKg: number | null) => {
      if (!weightPrompt) return;
      const kcal = calcActiveSetKcal({
        exerciseName: weightPrompt.exercise_name,
        userWeightKg,
        workSec: weightPrompt.workSec,
        restSec: weightPrompt.restSec,
        reps: weightPrompt.reps,
        prescribedReps: weightPrompt.prescribedReps,
        loadKg: weightKg,
        baselineLoadKg: weightPrompt.baselineLoadKg,
      });
      updateSetLog(weightPrompt.exercise_name, weightPrompt.set_number, {
        weight_kg: weightKg,
        kcal,
      });
      const done = weightPrompt.onDone;
      setWeightPrompt(null);
      done();
    },
    [updateSetLog, userWeightKg, weightPrompt],
  );

  const afterSetLogged = useCallback(
    async (
      draft: LoggedSetDraft,
      options: { showRest: boolean; onDone: () => void; setLogs: SetLog[] },
    ): Promise<boolean> => {
      const hints = await getLoadHints(draft.exercise_name);
      const skipPrompt =
        hints.is_bodyweight || isBodyweightExerciseClient(draft.exercise_name);
      if (skipPrompt) {
        options.onDone();
        return false;
      }
      const prefillKg = resolvePrefillLoadKg(
        draft.exercise_name,
        options.setLogs,
        hints.prefill_kg,
      );
      setWeightPrompt({
        exercise_name: draft.exercise_name,
        set_number: draft.set_number,
        reps: draft.reps,
        workSec: draft.workSec,
        restSec: draft.restSec,
        prescribedReps: draft.prescribedReps,
        tracking_method: draft.tracking_method,
        started_at: draft.started_at,
        completed_at: draft.completed_at,
        baselineLoadKg: hints.baseline_load_kg,
        prefillKg,
        showRest: options.showRest,
        onDone: options.onDone,
      });
      return true;
    },
    [getLoadHints],
  );

  return {
    weightPrompt,
    afterSetLogged,
    confirmSetWeight: applyWeight,
    skipSetWeight: () => applyWeight(null),
    prefillForPrompt: weightPrompt ? formatPrefillWeight(weightPrompt.prefillKg) : "",
  };
}
