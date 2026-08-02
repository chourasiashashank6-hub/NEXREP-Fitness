/**
 * NexRep design tokens — single source of truth for the visual refresh.
 * Import from `../design-system` in screens; do not hardcode hex values in new UI.
 */

export const colors = {
  /** App canvas — softer than pure black */
  surface: "#0d1117",
  surfaceElevated: "#161b22",
  surfaceCard: "#1c2128",
  surfaceInput: "#0f1419",

  /** Brand accents */
  accent: "#00e5a0",
  accentMuted: "rgba(0, 229, 160, 0.15)",
  accentBlue: "#00aaff",
  accentPurple: "#a78bfa",
  accentAmber: "#fbbf24",
  accentRose: "#fb7185",

  text: "#f0f3f6",
  textSecondary: "#9ca3af",
  textTertiary: "#6b7280",
  textInverse: "#0d1117",

  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.14)",

  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
  info: "#60a5fa",

  pro: "#3fcf8e",
  elite: "#a5a0f0",
  free: "#8b949e",

  overlay: "rgba(0, 0, 0, 0.55)",
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

/** Minimum touch target per platform HIG */
export const minTouchTarget = 44;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const typography = {
  /** Page title — e.g. screen headers */
  display: { fontSize: 28, lineHeight: 34, fontWeight: "700" as const, letterSpacing: -0.5 },
  /** Section headers — GOAL OVERVIEW, TODAY'S BURN */
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const },
  /** Card titles */
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
  /** Section labels — uppercase micro labels */
  label: { fontSize: 11, lineHeight: 14, fontWeight: "700" as const, letterSpacing: 1.4, textTransform: "uppercase" as const },
  /** Primary body — larger than legacy 13–14px */
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  bodyMedium: { fontSize: 16, lineHeight: 24, fontWeight: "500" as const },
  /** Secondary / meta */
  caption: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const },
  captionMedium: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  /** Stat numbers */
  stat: { fontSize: 24, lineHeight: 28, fontWeight: "800" as const },
  /** Brand wordmark */
  brand: { fontSize: 26, lineHeight: 30, fontWeight: "700" as const, letterSpacing: 2 },
} as const;

export const shadows = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  elevated: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  glow: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

export type DesignTokens = {
  colors: typeof colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadows: typeof shadows;
  minTouchTarget: typeof minTouchTarget;
};

export const tokens: DesignTokens = {
  colors,
  spacing,
  radius,
  typography,
  shadows,
  minTouchTarget,
};
