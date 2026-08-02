import type { AppTheme } from "./colors";
import type { PlanTier } from "../types/subscription";

export type PlanTierTheme = {
  heroBg: string;
  heroBorder: string;
  accent: string;
  accentSoft: string;
  statusActive: string;
  btnPrimaryBg: string;
  btnPrimaryBorder: string;
  btnPrimaryText: string;
  btnGhostBorder: string;
  btnGhostText: string;
};

export function planTierTheme(tier: PlanTier, colors: AppTheme["colors"]): PlanTierTheme {
  if (tier === "FREE") {
    return {
      heroBg: `${colors.muted}12`,
      heroBorder: colors.muted,
      accent: colors.muted,
      accentSoft: `${colors.muted}22`,
      statusActive: colors.muted,
      btnPrimaryBg: "transparent",
      btnPrimaryBorder: colors.muted,
      btnPrimaryText: colors.text,
      btnGhostBorder: "rgba(255,255,255,0.2)",
      btnGhostText: colors.text,
    };
  }
  if (tier === "ELITE") {
    return {
      heroBg: `${colors.authBorderOrange}14`,
      heroBorder: colors.authBorderOrange,
      accent: colors.authBorderOrange,
      accentSoft: `${colors.authBorderOrange}22`,
      statusActive: colors.authBorderOrange,
      btnPrimaryBg: colors.authBorderOrange,
      btnPrimaryBorder: colors.authBorderOrange,
      btnPrimaryText: colors.background,
      btnGhostBorder: colors.authBorderOrange,
      btnGhostText: colors.authBorderOrange,
    };
  }
  return {
    heroBg: `${colors.authBorderGreen}14`,
    heroBorder: colors.authBorderGreen,
    accent: colors.authBorderGreen,
    accentSoft: `${colors.authBorderGreen}22`,
    statusActive: colors.authBorderGreen,
    btnPrimaryBg: colors.authBorderGreen,
    btnPrimaryBorder: colors.authBorderGreen,
    btnPrimaryText: colors.background,
    btnGhostBorder: "rgba(255,255,255,0.2)",
    btnGhostText: colors.text,
  };
}
