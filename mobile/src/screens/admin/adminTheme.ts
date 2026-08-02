export const COLORS = {
  bg: "#0d1117",
  card: "#161b22",
  cardAlt: "#1c2128",
  border: "rgba(255,255,255,0.07)",
  borderMid: "rgba(255,255,255,0.12)",
  text: "#e6edf3",
  textSub: "#c9d1d9",
  textMuted: "#8b949e",
  textHint: "#6e7681",
  teal: "#1d9e75",
  tealLight: "#3fcf8e",
  blue: "#378add",
  purple: "#7f77dd",
  amber: "#ef9f27",
  coral: "#d85a30",
  pink: "#d4537e",
  grid: "rgba(255,255,255,0.06)",
};

/** @deprecated use COLORS */
export const adminColors = {
  bg: COLORS.bg,
  card: COLORS.card,
  text: COLORS.textSub,
  muted: COLORS.textMuted,
  accent: COLORS.teal,
  amber: COLORS.amber,
  danger: "#f85149",
  border: COLORS.borderMid,
};

export function formatInr(amount: number, decimals = 0): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
