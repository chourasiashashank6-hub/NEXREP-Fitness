import type { JourneyEventItem } from "../api/journey";
import i18n from "../i18n";

const ROOT = "coach.journey.events";

export type JourneyEventCopy = {
  statusLabel: string;
  title: string;
  body: string;
  action?: string;
  dateLine?: string;
};

function formatJourneyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(i18n.language, { day: "numeric", month: "short" });
}

function domainLabel(raw: string): string {
  const t = i18n.t.bind(i18n);
  if (raw === "nutrition") return t("coach.journey.domains.nutrition");
  if (raw === "workout") return t("coach.journey.domains.workout");
  return raw;
}

function paramsFor(item: JourneyEventItem): Record<string, string | number> {
  const p = item.payload_json ?? {};
  const rec = item.recommendation_params ?? {};
  const rawDomain = String(p.disengagement_domain ?? p.domain_label ?? rec.domain ?? "");
  return {
    days: Number(p.streak_days ?? rec.days ?? rec.daysSince ?? p.days_since ?? 0),
    target: Math.round(Number(p.target_protein_g ?? rec.targetProteinG ?? 0)),
    muscle: String(p.muscle ?? rec.muscle ?? ""),
    percentIncrease: Number(p.percent_increase ?? rec.percentIncrease ?? 0),
    exerciseName: String(p.exercise_name ?? rec.exerciseName ?? ""),
    weeksFlat: Number(p.weeks_flat ?? rec.weeksFlat ?? 0),
    domain: domainLabel(rawDomain),
    daysOnTarget: Number(p.days_on_target ?? rec.daysOnTarget ?? 0),
    windowDays: Number(p.window_days ?? rec.windowDays ?? 7),
  };
}

export function copyForJourneyEvent(item: JourneyEventItem): JourneyEventCopy {
  const t = i18n.t.bind(i18n);
  const type = item.event_type || "generic";
  const eventBase = `${ROOT}.${type}`;
  const base = i18n.exists(`${eventBase}.activeTitle`) ? eventBase : `${ROOT}.generic`;
  const p = paramsFor(item);
  const clearedDate = formatJourneyDate(item.resolved_at);
  const spottedDate = formatJourneyDate(item.detected_at);

  if (item.status === "resolved") {
    return {
      statusLabel: t("coach.journey.cleared"),
      title: t(`${base}.clearedTitle`, p),
      body: clearedDate
        ? t(`${base}.clearedBodyWithDate`, { ...p, date: clearedDate })
        : t(`${base}.clearedBody`, p),
    };
  }

  return {
    statusLabel: t("coach.journey.needsAttention"),
    title: t(`${base}.activeTitle`, p),
    body: t(`${base}.activeBody`, p),
    action: t(`${base}.activeAction`, { ...p, defaultValue: "" }) || undefined,
    dateLine: spottedDate ? t("coach.journey.spottedOn", { date: spottedDate }) : undefined,
  };
}
