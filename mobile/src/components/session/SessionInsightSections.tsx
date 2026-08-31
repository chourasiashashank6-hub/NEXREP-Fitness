import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getExerciseCoachCue } from "../../utils/exerciseGuidanceLookup";
import { resolveExerciseCoachMuscles } from "../../utils/resolveExerciseCoachMuscles";
import { lookupExerciseBest, type ExerciseBest } from "../../utils/sessionExerciseBest";
import { TEXT } from "../../theme/colors";

const MUTED = "#6B7280";
const BORDER = "#E5E7EB";
const GREEN_LIGHT = "#E1F5EE";
const GREEN_DARK = "#085041";
const AMBER_BG = "#FAEEDA";
const AMBER_TEXT = "#BA7517";
const PURPLE_BG = "#EEEDFE";
const PURPLE_TEXT = "#534AB7";

type SessionInsightSectionsProps = {
  exerciseName: string;
  plannerMuscle?: string | null;
  bestByExercise: Map<string, ExerciseBest>;
};

function formatBestDate(dateIso: string | null): string | null {
  if (!dateIso) return null;
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TargetsChipsSection({
  exerciseName,
  plannerMuscle,
}: Pick<SessionInsightSectionsProps, "exerciseName" | "plannerMuscle">) {
  const muscles = useMemo(
    () => resolveExerciseCoachMuscles(exerciseName, plannerMuscle),
    [exerciseName, plannerMuscle],
  );
  if (!muscles.length) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Targets this set</Text>
      <View style={styles.muscleChipRow}>
        {muscles.map((muscle) => (
          <View key={muscle} style={styles.muscleChip}>
            <Text style={styles.muscleChipText}>{muscle}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function YourBestCard({
  exerciseName,
  bestByExercise,
}: Pick<SessionInsightSectionsProps, "exerciseName" | "bestByExercise">) {
  const best = useMemo(
    () => lookupExerciseBest(bestByExercise, exerciseName),
    [bestByExercise, exerciseName],
  );
  if (!best) return null;

  const dateLabel = formatBestDate(best.date);

  return (
    <View style={[styles.infoCard, styles.bestCard]}>
      <Text style={styles.cardEyebrow}>Your best</Text>
      <Text style={styles.cardValue}>
        {Math.round(best.weight_kg * 10) / 10} kg × {best.reps}
      </Text>
      <Text style={styles.cardMeta}>
        Est. 1RM {Math.round(best.estimated_1rm_kg * 10) / 10} kg
        {dateLabel ? ` · ${dateLabel}` : ""}
      </Text>
    </View>
  );
}

function CoachCueCard({ exerciseName }: Pick<SessionInsightSectionsProps, "exerciseName">) {
  const cue = useMemo(() => getExerciseCoachCue(exerciseName), [exerciseName]);
  if (!cue) return null;

  return (
    <View style={[styles.infoCard, styles.cueCard]}>
      <Text style={styles.cardEyebrow}>Coach cue</Text>
      <Text style={styles.cueText} numberOfLines={4}>
        {cue}
      </Text>
    </View>
  );
}

export default function SessionInsightSections({
  exerciseName,
  plannerMuscle,
  bestByExercise,
}: SessionInsightSectionsProps) {
  const best = lookupExerciseBest(bestByExercise, exerciseName);
  const cue = getExerciseCoachCue(exerciseName);
  const muscles = resolveExerciseCoachMuscles(exerciseName, plannerMuscle);

  if (!muscles.length && !best && !cue) return null;

  const showBest = Boolean(best);
  const showCue = Boolean(cue);
  const showInsightRow = showBest || showCue;

  return (
    <View style={styles.wrap}>
      <TargetsChipsSection exerciseName={exerciseName} plannerMuscle={plannerMuscle} />
      {showInsightRow ? (
        <View style={[styles.infoRow, showBest && showCue ? null : styles.infoRowSingle]}>
          {showBest ? (
            <YourBestCard exerciseName={exerciseName} bestByExercise={bestByExercise} />
          ) : null}
          {showCue ? <CoachCueCard exerciseName={exerciseName} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: TEXT,
    marginBottom: 8,
  },
  muscleChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  muscleChip: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  muscleChipText: {
    color: GREEN_DARK,
    fontSize: 12,
    fontWeight: "700",
  },
  infoRow: {
    flexDirection: "row",
    gap: 10,
  },
  infoRowSingle: {
    flexDirection: "column",
  },
  infoCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    minHeight: 96,
  },
  bestCard: {
    backgroundColor: AMBER_BG,
    borderColor: "rgba(186, 117, 23, 0.18)",
  },
  cueCard: {
    backgroundColor: PURPLE_BG,
    borderColor: "rgba(83, 74, 183, 0.18)",
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
    letterSpacing: 0.3,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  cardValue: {
    fontSize: 16,
    fontWeight: "800",
    color: AMBER_TEXT,
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 11,
    color: MUTED,
    lineHeight: 16,
  },
  cueText: {
    fontSize: 12,
    lineHeight: 17,
    color: PURPLE_TEXT,
    fontWeight: "600",
  },
});
