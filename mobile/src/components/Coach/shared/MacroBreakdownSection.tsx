import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { MacroStatusValue } from "../../../types/coachSummary";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../../../theme/colors";

const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const AMBER_TEXT = "#C08000";
const AMBER_LIGHT = "#FFF8E8";
const MUTED = "#BBBBBB";
type MacroKey = "protein" | "carbs" | "fat";

const MACRO_META: Record<MacroKey, { labelKey: string; color: string; light: string }> = {
  protein: { labelKey: "coach.calorie.card.protein", color: BLUE, light: BLUE_LIGHT },
  carbs: { labelKey: "coach.calorie.card.carbs", color: GREEN, light: GREEN_LIGHT },
  fat: { labelKey: "coach.calorie.card.fat", color: AMBER_TEXT, light: AMBER_LIGHT },
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function MacroRing({ value, target, color }: { value: number; target: number; color: string }) {
  const size = 64;
  const radius = 28;
  const circumference = 175.9;
  const progress = clamp(target > 0 ? value / target : 0);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#E5E4E0" strokeWidth={7} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${progress * circumference} ${circumference}`}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.macroRingCenter}>
        <Text style={[styles.macroRingText, { color }]}>{Math.round(value)}g</Text>
      </View>
    </View>
  );
}

function statusTone(status: MacroStatusValue, t: (k: string) => string) {
  if (status === "low") return { bg: ORANGE_LIGHT, color: ORANGE, label: t("coach.calorie.card.low") };
  if (status === "high") return { bg: AMBER_LIGHT, color: AMBER_TEXT, label: t("coach.calorie.card.high") };
  return { bg: GREEN_LIGHT, color: GREEN, label: t("coach.calorie.card.onTrack") };
}

type Props = {
  values: Record<MacroKey, number>;
  targets: Record<MacroKey, number>;
  statuses: Record<MacroKey, MacroStatusValue>;
  titleKey?: string;
};

export function MacroBreakdownSection({ values, targets, statuses, titleKey = "coach.calorie.card.macroBreakdown" }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>{t(titleKey)}</Text>
      <View style={styles.macroRow}>
        {(["protein", "carbs", "fat"] as MacroKey[]).map((key) => {
          const meta = MACRO_META[key];
          const status = statusTone(statuses[key], t);
          return (
            <View key={key} style={styles.macroColumn}>
              <MacroRing value={values[key]} target={targets[key]} color={meta.color} />
              <Text style={styles.macroName}>{t(meta.labelKey)}</Text>
              <Text style={styles.macroTarget}>/ {Math.round(targets[key])}g</Text>
              <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type GapProps = {
  gaps: MacroKey[];
  values: Record<MacroKey, number>;
  targets: Record<MacroKey, number>;
  foodChips: Record<MacroKey, string[]>;
};

export function MacroGapSection({ gaps, values, targets, foodChips }: GapProps) {
  const { t } = useTranslation();
  if (!gaps.length) {
    return (
      <View style={styles.successCard}>
        <Text style={styles.successText}>{t("coach.calorie.card.allMacrosOnTrack")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.gapSection}>
      <Text style={styles.sectionLabel}>{t("coach.calorie.card.dietRecommendations")}</Text>
      {gaps.map((key) => {
        const meta = MACRO_META[key];
        const gap = Math.max(0, Math.round(targets[key] - values[key]));
        return (
          <View key={key} style={styles.gapCard}>
            <View style={[styles.gapStrip, { backgroundColor: meta.light }]}>
              <Text style={[styles.gapTitle, { color: meta.color }]}>{t("coach.calorie.card.macroGap", { macro: t(meta.labelKey) })}</Text>
              <View style={[styles.gapBadge, { backgroundColor: meta.color }]}>
                <Text style={styles.gapBadgeText}>{gap}g</Text>
              </View>
            </View>
            <View style={styles.chips}>
              {foodChips[key].map((food) => (
                <View key={food} style={styles.chip}>
                  <Text style={styles.chipText}>{food}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, marginBottom: 12 },
  sectionLabel: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 12 },
  macroRow: { flexDirection: "row", justifyContent: "space-between" },
  macroColumn: { flex: 1, alignItems: "center" },
  macroRingCenter: { position: "absolute", top: 0, left: 0, width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  macroRingText: { fontSize: 13, fontWeight: "900" },
  macroName: { color: TEXT, fontSize: 11, fontWeight: "800", marginTop: 8 },
  macroTarget: { color: MUTED, fontSize: 10, marginTop: 2 },
  statusBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  statusText: { fontSize: 9, fontWeight: "900" },
  gapSection: { marginBottom: 12 },
  successCard: { backgroundColor: GREEN_LIGHT, borderRadius: 14, padding: 14, marginBottom: 12 },
  successText: { color: GREEN, fontSize: 12, fontWeight: "800", textAlign: "center" },
  gapCard: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 14, overflow: "hidden", marginBottom: 8 },
  gapStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  gapTitle: { fontSize: 13, fontWeight: "900", flex: 1 },
  gapBadge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  gapBadgeText: { color: WHITE, fontSize: 11, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 12, paddingTop: 0 },
  chip: { backgroundColor: BG, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: TEXT, fontSize: 10, fontWeight: "700" },
});

export { MACRO_META };
