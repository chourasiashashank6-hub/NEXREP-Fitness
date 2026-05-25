import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Text as SvgText } from "react-native-svg";
import type { ReadinessFactor, WorkoutCoachInsight } from "../../types/workoutCoach";
import { READINESS_FACTOR_COLORS, WC_COLORS } from "../../constants/workoutCoach";

function getArcColor(score: number): string {
  if (score >= 76) return WC_COLORS.green;
  if (score >= 51) return WC_COLORS.amber;
  if (score >= 31) return "#F59E0B";
  return WC_COLORS.red;
}

export default function ReadinessRow({ insight, hideGauge = false }: { insight: WorkoutCoachInsight; hideGauge?: boolean }) {
  const { readinessScore, readinessLabel, readinessDescription, readinessFactors } = insight;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, readinessScore)) / 100) * circumference;

  return (
    <View style={styles.container}>
      {!hideGauge ? (
        <Svg width={64} height={64} viewBox="0 0 64 64">
          <Circle cx={32} cy={32} r={radius} fill="none" stroke={WC_COLORS.border} strokeWidth={6} />
          <Circle
            cx={32}
            cy={32}
            r={radius}
            fill="none"
            stroke={getArcColor(readinessScore)}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={offset}
            rotation="-90"
            origin="32, 32"
          />
          <SvgText x={32} y={37} textAnchor="middle" fontSize={14} fontWeight="700" fill={WC_COLORS.textPrimary}>
            {Math.round(readinessScore)}
          </SvgText>
        </Svg>
      ) : null}
      <View style={styles.info}>
        {!hideGauge ? (
          <>
            <Text style={styles.label}>Training readiness</Text>
            <Text style={styles.value}>{readinessLabel}</Text>
            <Text style={styles.desc}>{readinessDescription}</Text>
          </>
        ) : (
          <Text style={styles.label}>Readiness factors</Text>
        )}
        <View style={styles.factors}>
          {(readinessFactors ?? []).map((f: ReadinessFactor, i: number) => {
            const cfg = READINESS_FACTOR_COLORS[f.type];
            return (
              <View key={`${f.label}-${i}`} style={[styles.factor, { backgroundColor: cfg.bg }]}>
                <Text style={[styles.factorText, { color: cfg.color }]}>{f.label}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: WC_COLORS.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  info: { flex: 1 },
  label: {
    fontSize: 10,
    fontWeight: "600",
    color: WC_COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  value: { fontSize: 18, fontWeight: "700", color: WC_COLORS.textPrimary, lineHeight: 22 },
  desc: { fontSize: 11, color: WC_COLORS.textSecondary, marginTop: 2 },
  factors: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  factor: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  factorText: { fontSize: 10, fontWeight: "600" },
});
