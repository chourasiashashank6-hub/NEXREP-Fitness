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
