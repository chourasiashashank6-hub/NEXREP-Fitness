import i18n from "../i18n";

function parseSummaryDate(dateIso: string): Date {
  return new Date(`${dateIso}T12:00:00`);
}

export function formatSummaryWeekday(dateIso: string): string {
  return parseSummaryDate(dateIso).toLocaleDateString(i18n.language, { weekday: "short" });
}

export function formatSummaryMonth(dateIso: string): string {
  return parseSummaryDate(dateIso).toLocaleDateString(i18n.language, { month: "long" });
}

export function formatSummaryDateLong(dateIso: string): string {
  return parseSummaryDate(dateIso).toLocaleDateString(i18n.language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Human-readable inclusive date range for coach report windows. */
export function formatSummaryDateRange(startIso: string, endIso: string): string {
  const start = parseSummaryDate(startIso);
  const end = parseSummaryDate(endIso);
  if (startIso === endIso) {
    return formatSummaryDateLong(endIso);
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    const monthYear = end.toLocaleDateString(i18n.language, { month: "short", year: "numeric" });
    return `${start.getDate()} – ${end.getDate()} ${monthYear}`;
  }

  const medium = (d: Date) =>
    d.toLocaleDateString(i18n.language, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const endLabel = end.toLocaleDateString(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  if (sameYear) {
    return `${medium(start)} – ${endLabel}`;
  }

  return `${formatSummaryDateLong(startIso)} – ${formatSummaryDateLong(endIso)}`;
}
