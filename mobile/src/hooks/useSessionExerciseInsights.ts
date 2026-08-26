import { useEffect, useRef, useState } from "react";
import { getStrengthProgress } from "../api/strength";
import { getWorkoutHistory } from "../api/workout";
import type { SessionExercise } from "../store/workoutSessionStore";
import {
  buildExerciseBestMap,
  type ExerciseBest,
} from "../utils/sessionExerciseBest";

/**
 * Prefetch PR data once per session screen mount.
 * Merges goal-lift progress (/api/strength/progress) with workout-history top sets
 * so non-goal exercises logged with a top set still resolve a "Your best" card.
 */
export function useSessionExerciseInsights(exercises: SessionExercise[] | undefined) {
  const [bestByExercise, setBestByExercise] = useState<Map<string, ExerciseBest>>(new Map());
  const prefetched = useRef(false);

  useEffect(() => {
    if (prefetched.current || !exercises?.length) return;
    prefetched.current = true;

    void Promise.all([
      getStrengthProgress().catch(() => null),
      getWorkoutHistory({ range: "all", limit: 500 }).catch(() => ({ items: [] })),
    ]).then(([strengthProgress, history]) => {
      setBestByExercise(buildExerciseBestMap(strengthProgress, history.items));
    });
  }, [exercises]);

  return { bestByExercise };
}
