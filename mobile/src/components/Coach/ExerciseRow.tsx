import { StyleSheet, Text, View } from "react-native";
import type { WorkoutExercise } from "../../types/workoutCoach";
import { useAppTheme } from "../../theme";

type Props = WorkoutExercise & { index: number };

export function ExerciseRow({ index, name, sets, reps, muscle, note }: Props) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.index, { color: colors.muted }]}>{index}.</Text>
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {sets} × {reps} · {muscle}
        </Text>
        {note ? <Text style={[styles.note, { color: colors.muted }]}>{note}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.06)" },
  index: { fontSize: 14, fontWeight: "700", width: 20 },
  body: { flex: 1 },
  name: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  note: { fontSize: 11, marginTop: 4, lineHeight: 16, fontStyle: "italic" },
});
