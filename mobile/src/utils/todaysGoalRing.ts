/**
 * Combined eat + burn progress for the Home "Today's Goal" ring.
 * Each fraction is clamped to 1.0 before averaging so overeating cannot
 * fake a complete goal when burn is incomplete.
 */
export type TodaysGoalProgress = {
  eatFrac: number;
  burnFrac: number;
  combined: number;
  percent: number;
  complete: boolean;
};

export type TodaysGoalPendingItem = "warm-up" | "workout" | "intake";

export type PlannedBurnBreakdown = {
  warmupTargetKcal: number;
  sessionTargetKcal: number;
};

export type TodayBurnActuals = {
  warmupKcal: number;
  sessionKcal: number;
};

export type TodaysGoalPendingLabels = Record<TodaysGoalPendingItem, string>;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function plannedBurnBreakdownFromActivities(
  activities: ReadonlyArray<{ kind: string; kcal: number }>,
): PlannedBurnBreakdown {
  const warmupTargetKcal = Math.max(
    0,
    Math.round(activities.find((activity) => activity.kind === "cardioWarmup")?.kcal ?? 0),
  );
  const sessionTargetKcal = Math.max(
    0,
    Math.round(activities.find((activity) => activity.kind === "workoutSession")?.kcal ?? 0),
  );
  return { warmupTargetKcal, sessionTargetKcal };
}

function deriveBurnPendingItems(
  caloriesBurnedToday: number,
  dailyBurnTarget: number,
  planned: PlannedBurnBreakdown | null | undefined,
  actuals: TodayBurnActuals | null | undefined,
): TodaysGoalPendingItem[] {
  if (dailyBurnTarget <= 0 || caloriesBurnedToday >= dailyBurnTarget) return [];

  const warmupTarget = planned?.warmupTargetKcal ?? 0;
  const sessionTarget = planned?.sessionTargetKcal ?? 0;
  const hasBreakdown = warmupTarget > 0 || sessionTarget > 0;

  if (!hasBreakdown) return ["workout"];

  const warmupActual = Math.max(0, Number(actuals?.warmupKcal) || 0);
  const sessionActual = Math.max(
    0,
    Number(actuals?.sessionKcal) || Math.max(0, caloriesBurnedToday - warmupActual),
  );

  const items: TodaysGoalPendingItem[] = [];

  if (warmupTarget > 0 && warmupActual < warmupTarget) {
    items.push("warm-up");
  }
  if (sessionTarget > 0 && sessionActual < sessionTarget) {
    items.push("workout");
  }

  if (items.length === 0 && caloriesBurnedToday < dailyBurnTarget) {
    items.push("workout");
  }

  return items;
}

/** Category names only — no numbers. Empty when the ring is already complete. */
export function deriveTodaysGoalPendingItems(opts: {
  caloriesEatenToday: number;
  dailyCalorieTarget: number;
  caloriesBurnedToday: number;
  dailyBurnTarget: number;
  restDayActive?: boolean;
  plannedBurn?: PlannedBurnBreakdown | null;
  todayBurnActuals?: TodayBurnActuals | null;
}): TodaysGoalPendingItem[] {
  const progress = computeTodaysGoalProgress(
    opts.caloriesEatenToday,
    opts.dailyCalorieTarget,
    opts.caloriesBurnedToday,
    opts.dailyBurnTarget,
    { restDayActive: opts.restDayActive },
  );

  if (progress.complete) return [];

  const items: TodaysGoalPendingItem[] = [];

  if (!opts.restDayActive && progress.burnFrac < 1) {
    items.push(
      ...deriveBurnPendingItems(
        opts.caloriesBurnedToday,
        opts.dailyBurnTarget,
        opts.plannedBurn,
        opts.todayBurnActuals,
      ),
    );
  }

  if (progress.eatFrac < 1) {
    items.push("intake");
  }

  return items;
}

export function formatTodaysGoalPendingLabel(
  items: TodaysGoalPendingItem[],
  labels: TodaysGoalPendingLabels,
  prefix: string,
): string | null {
  if (!items.length) return null;
  return `${prefix}${items.map((item) => labels[item]).join(", ")}`;
}

export function computeTodaysGoalProgress(
  caloriesEatenToday: number,
  dailyCalorieTarget: number,
  caloriesBurnedToday: number,
  dailyBurnTarget: number,
  opts?: { restDayActive?: boolean },
): TodaysGoalProgress {
  const eaten = Math.max(0, Number(caloriesEatenToday) || 0);
  const burned = Math.max(0, Number(caloriesBurnedToday) || 0);
  const eatTarget = Math.max(0, Number(dailyCalorieTarget) || 0);
  const burnTarget = Math.max(0, Number(dailyBurnTarget) || 0);

  const eatFrac = eatTarget > 0 ? Math.min(1, eaten / eatTarget) : 0;
  const burnFrac = burnTarget > 0 ? Math.min(1, burned / burnTarget) : 0;
  // Rest day: eat-only — do not average in a phantom burn target.
  const combined = opts?.restDayActive ? eatFrac : (eatFrac + burnFrac) / 2;
  const percent = Math.round(combined * 100);
  const complete = combined >= 1;

  return { eatFrac, burnFrac, combined, percent, complete };
}

/** SVG polar helper — angle 0 is 12 o'clock; positive angles sweep clockwise. */
export function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleInDegrees: number,
): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

/** Clockwise arc from startAngle → endAngle (degrees, 0 = top). */
export function describeArc(
  x: number,
  y: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return ["M", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(" ");
}
