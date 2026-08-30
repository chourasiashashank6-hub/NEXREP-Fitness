/** App calendar dates always use IST (Asia/Kolkata), regardless of device timezone. */
export const APP_TIMEZONE = "Asia/Kolkata";

/** YYYY-MM-DD in IST */
export function localDateIso(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(d);
}

export function monthYearLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleString("en-IN", {
    timeZone: APP_TIMEZONE,
    month: "long",
    year: "numeric",
  });
}

export function weekdayLabel(month: number, year: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleString("en-IN", {
    timeZone: APP_TIMEZONE,
    weekday: "short",
  });
}

export function fullDayLabel(month: number, year: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleString("en-IN", {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** True when plan day is strictly before today in the IST calendar. */
export function isPastPlanDay(month: number, year: number, day: number, ref = new Date()): boolean {
  const today = localDateIso(ref);
  const target = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return target < today;
}

/** e.g. "Jun 1" — first day of next calendar month in IST. */
export function getNextMonthResetLabel(ref = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "numeric",
  })
    .formatToParts(ref)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  const next = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return next.toLocaleDateString("en-IN", { timeZone: APP_TIMEZONE, month: "short", day: "numeric" });
}

/** Absolute instant for a wall-clock time on a plan calendar day in IST. */
export function istDateFromWallClock(year: number, month: number, day: number, hour: number, minute: number): Date {
  const pad = (value: number) => String(value).padStart(2, "0");
  return new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`);
}

/** Food scan quota resets at IST midnight — time only; copy adds "(midnight IST)". */
export function formatScanResetAtIST(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: APP_TIMEZONE,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}
