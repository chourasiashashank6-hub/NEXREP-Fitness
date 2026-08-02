import type { PlanTier } from "../types/subscription";

export type TierColors = {
  cardBg: string;
  cardBorder: string;
  titleColor: string;
  badgeBg: string;
  badgeText: string;
  mutedText: string;
  buttonBg: string;
  buttonText: string;
  checkColor: string;
};

export const TIER_COLORS: Record<PlanTier, TierColors> = {
  FREE: {
    cardBg: "#F7F6F3",
    cardBorder: "#ECEAE5",
    titleColor: "#1A1A18",
    badgeBg: "#BBBBBB",
    badgeText: "#FFFFFF",
    mutedText: "#BBBBBB",
    buttonBg: "#1A1A18",
    buttonText: "#FFFFFF",
    checkColor: "#BBBBBB",
  },
  ELITE: {
    cardBg: "#FFF8E1",
    cardBorder: "#E8B400",
    titleColor: "#8A6400",
    badgeBg: "#E8B400",
    badgeText: "#FFFFFF",
    mutedText: "#A08040",
    buttonBg: "#E8B400",
    buttonText: "#FFFFFF",
    checkColor: "#E8B400",
  },
  PRO: {
    cardBg: "#EEF4FB",
    cardBorder: "#4A90D9",
    titleColor: "#2A6BB0",
    badgeBg: "#4A90D9",
    badgeText: "#FFFFFF",
    mutedText: "#7AA5D0",
    buttonBg: "#4A90D9",
    buttonText: "#FFFFFF",
    checkColor: "#4A90D9",
  },
};

export const TIER_ICONS: Record<PlanTier, string> = {
  FREE: "🆓",
  PRO: "⚡",
  ELITE: "👑",
};
