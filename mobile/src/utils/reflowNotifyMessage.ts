import type { TFunction } from "i18next";
import type { ReflowTaggedExercise } from "./reflowExerciseMeta";
import type { SmartReflowPatch } from "./smartReflow";

export type ReflowMove = {
  name: string;
  sourceDay: number;
  targetDay: number;
};

export function extractReflowMoves(patches: SmartReflowPatch[]): ReflowMove[] {
  const moves: ReflowMove[] = [];
  for (const patch of patches) {
    for (const exercise of patch.exercises) {
      const sourceDay = (exercise as ReflowTaggedExercise).reflow_source_day;
      if (typeof sourceDay !== "number" || sourceDay <= 0) continue;
      moves.push({
        name: exercise.name,
        sourceDay,
        targetDay: patch.day,
      });
    }
  }
  return moves;
}

function sameRoute(moves: ReflowMove[]): { sourceDay: number; targetDay: number } | null {
  if (!moves.length) return null;
  const { sourceDay, targetDay } = moves[0];
  const same = moves.every((move) => move.sourceDay === sourceDay && move.targetDay === targetDay);
  return same ? { sourceDay, targetDay } : null;
}

/** Builds a user-facing Smart Reflow notification body from concrete move metadata. */
export function formatReflowAppliedBody(moves: ReflowMove[], t: TFunction): string {
  if (!moves.length) {
    return t("coach.reflow.appliedFallback");
  }
  if (moves.length === 1) {
    const move = moves[0];
    return t("coach.reflow.appliedSingle", {
      name: move.name,
      source: move.sourceDay,
      target: move.targetDay,
    });
  }
  const route = sameRoute(moves);
  if (route) {
    const names = moves.map((move) => move.name).join(", ");
    return t("coach.reflow.appliedSameRoute", {
      count: moves.length,
      source: route.sourceDay,
      target: route.targetDay,
      names,
    });
  }
  const lines = moves.map((move) =>
    t("coach.reflow.appliedLine", {
      name: move.name,
      source: move.sourceDay,
      target: move.targetDay,
    }),
  );
  return `${t("coach.reflow.appliedMultiIntro")}\n${lines.join("\n")}`;
}
