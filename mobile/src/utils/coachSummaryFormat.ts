import i18n from "../i18n";

export function formatSummaryWeekday(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  return d.toLocaleDateString(i18n.language, { weekday: "short" });
}

export function formatSummaryMonth(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  return d.toLocaleDateString(i18n.language, { month: "long" });
}
