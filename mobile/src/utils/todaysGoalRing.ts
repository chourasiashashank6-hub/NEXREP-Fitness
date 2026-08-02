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

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
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
