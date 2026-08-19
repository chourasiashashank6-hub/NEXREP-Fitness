import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const GOLD = "#FFD700";
const WHITE = "#FFFFFF";

type Props = {
  score: number;
  title: string;
  subtitle: string;
  statLeft: { value: string; label: string };
  statRight: { value: string; label: string };
  accentColor?: string;
};

export function CoachNutritionHero({
  score,
  title,
  subtitle,
  statLeft,
  statRight,
  accentColor = "#0F6E56",
}: Props) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const size = 90;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <View style={[styles.hero, { backgroundColor: accentColor }]}>
      <View style={styles.circleOne} />
      <View style={styles.circleTwo} />
      <View style={styles.row}>
        <View style={styles.ringWrap}>
          <Svg width={size} height={size}>
            <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.15)" strokeWidth={8} fill="none" />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={GOLD}
              strokeWidth={8}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference}`}
              strokeDashoffset={offset}
              rotation="-90"
              origin={`${size / 2}, ${size / 2}`}
            />
          </Svg>
          <View style={styles.ringCenter}>
            <Text style={styles.ringText}>{clamped}</Text>
          </View>
        </View>
        <View style={styles.info}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={styles.statsRow}>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{statLeft.value}</Text>
              <Text style={styles.statLabel}>{statLeft.label}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={[styles.statValue, styles.statAccent]}>{statRight.value}</Text>
              <Text style={styles.statLabel}>{statRight.label}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 22,
    paddingVertical: 20,
    paddingHorizontal: 18,
    overflow: "hidden",
    marginBottom: 12,
  },
  circleOne: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.05)",
    top: -62,
    right: -42,
  },
  circleTwo: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.04)",
    bottom: -38,
    left: -26,
  },
  row: { flexDirection: "row", gap: 16, alignItems: "center" },
  ringWrap: { width: 90, height: 90 },
  ringCenter: { position: "absolute", top: 0, left: 0, width: 90, height: 90, alignItems: "center", justifyContent: "center" },
  ringText: { color: GOLD, fontSize: 28, fontWeight: "900" },
  info: { flex: 1 },
  title: { color: WHITE, fontSize: 18, fontWeight: "900" },
  subtitle: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 3 },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  statTile: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 9 },
  statValue: { color: WHITE, fontSize: 14, fontWeight: "900" },
  statAccent: { color: "#A8F0C8" },
  statLabel: { color: "rgba(255,255,255,0.55)", fontSize: 9, marginTop: 1 },
});
