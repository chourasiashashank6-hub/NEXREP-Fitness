import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import {
  EXERCISE_GUIDANCE,
  type ExerciseGuidance,
} from "../constants/ExerciseGuidanceData";

type ExerciseGuidanceCardProps = {
  exerciseName: string;
};

const SELECT_PLACEHOLDERS = new Set([
  "select choice",
  "default",
  "no choice",
  "none",
  "",
]);

function normalizeExerciseName(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findExerciseGuidance(exerciseName?: string): ExerciseGuidance | null {
  const normalizedTarget = normalizeExerciseName(exerciseName);
  if (!normalizedTarget || SELECT_PLACEHOLDERS.has(normalizedTarget)) {
    return null;
  }
  const exact = EXERCISE_GUIDANCE.find(
    (record) => normalizeExerciseName(record.exerciseName) === normalizedTarget,
  );
  if (exact) return exact;
  const partial = EXERCISE_GUIDANCE.find((record) => {
    const candidate = normalizeExerciseName(record.exerciseName);
    return (
      candidate &&
      (candidate.includes(normalizedTarget) || normalizedTarget.includes(candidate))
    );
  });
  return partial || null;
}

function PersonIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Circle cx={12} cy={5} r={2.5} fill="#ffffff" />
      <Line x1={12} y1={7.5} x2={12} y2={14} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
      <Line x1={12} y1={10} x2={8} y2={13} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
      <Line x1={12} y1={10} x2={16} y2={13} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
      <Line x1={12} y1={14} x2={9} y2={20} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
      <Line x1={12} y1={14} x2={15} y2={20} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

type TileProps = {
  label: string;
  dotColor: string;
  labelColor: string;
  children: ReactNode;
  isDark: boolean;
};

function GuidanceTile({ label, dotColor, labelColor, children, isDark }: TileProps) {
  return (
    <View style={[styles.tile, { backgroundColor: isDark ? "#0d1b2e" : "#f0f4f8" }]}>
      <View style={styles.tileLabelRow}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text
          style={[
            styles.tileLabel,
            { color: labelColor, letterSpacing: 0.06 * 10 },
          ]}
        >
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

export default function ExerciseGuidanceCard({ exerciseName }: ExerciseGuidanceCardProps) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  const guidance = useMemo(() => findExerciseGuidance(exerciseName), [exerciseName]);

  if (!guidance) return null;

  const cardBg = isDark ? "#0d1b2e" : "#f0f4f8";
  const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const sepColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const titleColor = isDark ? "#ffffff" : "#0d1b2e";
  const subtitleColor = isDark ? "#7a8fa6" : "#5a6a7a";
  const bodyColor = isDark ? "#c8d8e8" : "#334155";
  const tipColor = isDark ? "#c8aa6e" : "#92400e";
  const tipIconBg = "rgba(250,199,117,0.15)";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor: cardBorder,
        },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: sepColor }]}>
        <View style={styles.headerIcon}>
          <PersonIcon />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: titleColor }]}>
            Exercise guidance — {guidance.exerciseName}
          </Text>
          <Text style={[styles.headerSubtitle, { color: subtitleColor }]}>
            Posture · Muscles · Form cues · Cautions
          </Text>
        </View>
      </View>

      <View style={[styles.grid, { backgroundColor: sepColor }]}>
        <View style={styles.gridRow}>
          <GuidanceTile
            label="POSTURE"
            dotColor="#4ecba0"
            labelColor={isDark ? "#4ecba0" : "#0f6e56"}
            isDark={isDark}
          >
            <Text style={[styles.tileBody, { color: bodyColor }]}>{guidance.posture}</Text>
          </GuidanceTile>
          <View style={[styles.vSep, { backgroundColor: sepColor }]} />
          <GuidanceTile
            label="MUSCLES WORKED"
            dotColor="#6db8f0"
            labelColor={isDark ? "#6db8f0" : "#185fa5"}
            isDark={isDark}
          >
            <View style={styles.muscleRow}>
              {guidance.muscles.map((muscle) => {
                const primary = muscle.role === "primary";
                return (
                  <View
                    key={`${muscle.name}-${muscle.role}`}
                    style={[
                      styles.musclePill,
                      primary
                        ? {
                            backgroundColor: "rgba(29,158,117,0.18)",
                            borderColor: "rgba(29,158,117,0.3)",
                          }
                        : {
                            backgroundColor: "rgba(55,138,221,0.14)",
                            borderColor: "rgba(55,138,221,0.25)",
                          },
                    ]}
                  >
                    <Text
                      style={[
                        styles.musclePillText,
                        { color: primary ? (isDark ? "#4ecba0" : "#0f6e56") : isDark ? "#6db8f0" : "#185fa5" },
                      ]}
                    >
                      {muscle.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          </GuidanceTile>
        </View>
        <View style={[styles.hSep, { backgroundColor: sepColor }]} />
        <View style={styles.gridRow}>
          <GuidanceTile
            label="FORM CUES"
            dotColor="#c87eff"
            labelColor={isDark ? "#c87eff" : "#6d28d9"}
            isDark={isDark}
          >
            <Text style={[styles.tileBody, { color: bodyColor }]}>{guidance.formCues}</Text>
          </GuidanceTile>
          <View style={[styles.vSep, { backgroundColor: sepColor }]} />
          <GuidanceTile
            label="CAUTIONS"
            dotColor="#f4845f"
            labelColor={isDark ? "#f4845f" : "#c2410c"}
            isDark={isDark}
          >
            <Text style={[styles.tileBody, { color: bodyColor }]}>{guidance.cautions}</Text>
          </GuidanceTile>
        </View>
      </View>

      <View
        style={[
          styles.proTip,
          {
            borderTopColor: sepColor,
            backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
          },
        ]}
      >
        <View style={[styles.proTipIcon, { backgroundColor: tipIconBg }]}>
          <Text style={[styles.proTipIconText, { color: tipColor }]}>⚡</Text>
        </View>
        <Text style={[styles.proTipText, { color: tipColor }]}>
          Pro tip: {guidance.proTip}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#0f6e56",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  headerSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  grid: {
    overflow: "hidden",
  },
  gridRow: {
    flexDirection: "row",
  },
  hSep: {
    height: 1,
    width: "100%",
  },
  vSep: {
    width: 1,
  },
  tile: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  tileLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  tileLabel: {
    fontSize: 10,
    fontWeight: "700",
  },
  tileBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  muscleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  musclePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 4,
    marginBottom: 4,
  },
  musclePillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  proTip: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  proTipIcon: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  proTipIconText: {
    fontSize: 10,
  },
  proTipText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    marginLeft: 8,
  },
});
