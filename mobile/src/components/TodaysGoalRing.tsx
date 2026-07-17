import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTranslation } from "react-i18next";
import {
  computeTodaysGoalProgress,
  describeArc,
  polarToCartesian,
} from "../utils/todaysGoalRing";

const GREEN = "#0F6E56";
const TRACK = "#E5E4E0";
const TEXT_MUTED = "#888780";
const TEXT_PRIMARY = "#1A1A18";

const DEFAULT_SIZE = 168;
const STROKE = 16;
const DOT_R = 4;

type Props = {
  caloriesEatenToday: number;
  dailyCalorieTarget: number;
  caloriesBurnedToday: number;
  dailyBurnTarget: number;
  size?: number;
};

export function TodaysGoalRing({
  caloriesEatenToday,
  dailyCalorieTarget,
  caloriesBurnedToday,
  dailyBurnTarget,
  size = DEFAULT_SIZE,
}: Props) {
  const { t } = useTranslation();
  const { combined, percent, complete } = computeTodaysGoalProgress(
    caloriesEatenToday,
    dailyCalorieTarget,
    caloriesBurnedToday,
    dailyBurnTarget,
  );

  const radius = (size - STROKE) / 2;
  const center = size / 2;
  const topDot = polarToCartesian(center, center, radius, 0);
  const sweepDegrees = Math.min(359.999, Math.max(0, combined * 360));
  const arcPath =
    sweepDegrees > 0.5 && !complete ? describeArc(center, center, radius, 0, sweepDegrees) : null;

  const labelSize = size >= DEFAULT_SIZE ? 10 : 9;
  const valueSize = size >= DEFAULT_SIZE ? 36 : 28;
  const completeSize = size >= DEFAULT_SIZE ? 15 : 13;

  return (
    <View style={[styles.ringContainer, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius} stroke={TRACK} strokeWidth={STROKE} fill="none" />
        {complete ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={GREEN}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
        ) : arcPath ? (
          <Path
            d={arcPath}
            stroke={GREEN}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
        ) : null}
        {/* Fixed decorative marker at 12 o'clock — does not move with progress */}
        <Circle cx={topDot.x} cy={topDot.y} r={DOT_R} fill={GREEN} />
      </Svg>
      <View style={styles.ringCenterOverlay}>
        <Text style={[styles.ringCenterLabel, { fontSize: labelSize }]}>{t("home.todaysGoal")}</Text>
        {complete ? (
          <>
            <Text style={styles.celebrateEmoji}>🎉</Text>
            <Text style={[styles.completeText, { fontSize: completeSize }]}>{t("home.goalComplete")}</Text>
          </>
        ) : (
          <Text style={[styles.ringCenterValue, { fontSize: valueSize, lineHeight: valueSize + 4 }]}>
            {percent}%
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ringContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  ringCenterOverlay: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  ringCenterLabel: {
    letterSpacing: 1.2,
    color: TEXT_MUTED,
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: 4,
  },
  ringCenterValue: {
    fontWeight: "800",
    color: TEXT_PRIMARY,
  },
  celebrateEmoji: {
    fontSize: 22,
    marginBottom: 2,
  },
  completeText: {
    fontWeight: "800",
    color: GREEN,
    textAlign: "center",
  },
});
