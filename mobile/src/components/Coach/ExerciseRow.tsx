import { StyleSheet, Text, View } from "react-native";
import type { WorkoutExercise } from "../../types/workoutCoach";
import { WC_COLORS } from "../../constants/workoutCoach";

type Props = WorkoutExercise & { index: number };

export function ExerciseRow({ index, name, sets, reps, muscle, note }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.index}>{index}.</Text>
      <View style={styles.body}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.meta}>
          {sets} × {reps} · {muscle}
        </Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: WC_COLORS.BORDER },
  index: { color: WC_COLORS.MUTED, fontSize: 14, fontWeight: "700", width: 20 },
  body: { flex: 1 },
  name: { color: WC_COLORS.TEXT, fontSize: 13, fontWeight: "700" },
  meta: { color: WC_COLORS.MUTED, fontSize: 11, marginTop: 2 },
  note: { color: WC_COLORS.MUTED, fontSize: 11, marginTop: 4, lineHeight: 16, fontStyle: "italic" },
});
