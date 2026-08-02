import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../theme";
import { PRIORITY_COLORS, TAG_STYLES, type Task } from "../../types/coach";

export function TaskItem({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  const { colors } = useAppTheme();
  const tagTone = TAG_STYLES[task.tag];
  return (
    <Pressable style={[styles.row, { borderBottomColor: colors.border }]} onPress={() => onToggle(task.id)}>
      <View style={[styles.check, { borderColor: colors.muted }, task.done && styles.checkDone]}>
        <Text style={styles.checkText}>{task.done ? "✓" : ""}</Text>
      </View>
      <View style={styles.content}>
        <Text style={[styles.name, { color: colors.text }]}>{task.name}</Text>
        <Text style={[styles.desc, { color: colors.muted }]}>{task.description}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.tag, { backgroundColor: tagTone.bg }]}>
            <Text style={[styles.tagText, { color: tagTone.color }]}>{task.tag}</Text>
          </View>
          <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[task.priority] }]} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 99,
    borderWidth: 1,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkDone: { borderColor: "#16A34A", backgroundColor: "#16A34A" },
  checkText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  content: { flex: 1 },
  name: { fontSize: 13, fontWeight: "600" },
  desc: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  metaRow: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: "600", textTransform: "lowercase" },
  priorityDot: { width: 8, height: 8, borderRadius: 99 },
});
