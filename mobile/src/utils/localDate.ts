/** YYYY-MM-DD in the device's local timezone */
export function localDateIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthYearLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

export function weekdayLabel(month: number, year: number, day: number): string {
  return new Date(year, month - 1, day).toLocaleString(undefined, { weekday: "short" });
}

export function fullDayLabel(month: number, year: number, day: number): string {
  const d = new Date(year, month - 1, day);
  return d.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** True when plan day is strictly before today in the device's local calendar. */
export function isPastPlanDay(month: number, year: number, day: number, ref = new Date()): boolean {
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const target = new Date(year, month - 1, day);
  return target < today;
}

/** e.g. "Jun 1" — first day of next calendar month (device local). */
export function getNextMonthResetLabel(ref = new Date()): string {
  const next = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  return next.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
