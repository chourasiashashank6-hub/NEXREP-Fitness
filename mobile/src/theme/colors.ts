export const calmTheme = {
  colors: {
    primary: "#A8E6A3",
    secondary: "#1B3A6F",
    background: "#080c12",
    card: "#0f1620",
    cardAlt: "#0f1620",
    text: "#ECF2FF",
    muted: "#9AA8C4",
    danger: "#E85B5B",
    border: "rgba(255,255,255,0.07)",
    inputBg: "#0B1220",
    tabBg: "#111D33",
    /** Auth tabs / Firebase UI tokens */
    authBorderGreen: "#86EFAC",
    authBorderOrange: "#FB923C",
    tabInactive: "#131C2E",
    errorInline: "#F87171",
  },
  gradient: ["#15223A", "#1B3A6F"] as const,
  radius: {
    md: 14,
    lg: 18,
    xl: 22,
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 20,
  },
};

export type ColorSchemeName = "light" | "dark";

export type AppTheme = typeof calmTheme & { colorScheme: ColorSchemeName };
