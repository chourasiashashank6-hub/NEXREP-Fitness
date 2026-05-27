import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../theme";
import { weekdayLabel } from "../../utils/localDate";

export type PlannerCalendarDay = {
  day: number;
  is_past: boolean;
  is_today: boolean;
  is_future: boolean;
  is_cheat_day?: boolean;
  is_rest_day?: boolean;
  split_name?: string;
};

type Props = {
  month: number;
  year: number;
  days: PlannerCalendarDay[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
  mode: "meal" | "workout";
  allowFutureSelection?: boolean;
};

function splitAbbrev(name?: string): string {
  if (!name) return "";
  const n = name.toLowerCase();
  if (n.includes("push")) return "Push";
  if (n.includes("pull")) return "Pull";
  if (n.includes("leg")) return "Legs";
  if (n.includes("upper")) return "Upper";
  if (n.includes("lower")) return "Lower";
  if (n.includes("full")) return "Full";
  if (n.includes("rest") || n.includes("recovery")) return "Rest";
  return name.split(" ")[0]?.slice(0, 4) ?? "";
}

export function PlannerMonthCalendar({
  month,
  year,
  days,
  selectedDay,
  onSelectDay,
  mode,
  allowFutureSelection = false,
}: Props) {
  const { colors, radius } = useAppTheme();

  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={days}
      keyExtractor={(item) => String(item.day)}
      contentContainerStyle={styles.strip}
      renderItem={({ item }) => {
        const locked = item.is_future && !allowFutureSelection;
        const selected = item.day === selectedDay;
        const center =
          mode === "meal"
            ? item.is_cheat_day && !locked
              ? "🎉"
              : locked
                ? "🔒"
                : item.is_past
                  ? "✓"
                  : String(item.day)
            : item.is_rest_day && !locked
              ? "😴"
              : locked
                ? "🔒"
                : splitAbbrev(item.split_name) || String(item.day);

        return (
          <Pressable
            disabled={locked}
            onPress={() => onSelectDay(item.day)}
            style={[
              styles.cell,
              {
                borderColor: selected ? "#22d3ee" : colors.border,
                backgroundColor: item.is_today ? "rgba(34,211,238,0.15)" : colors.card,
                borderRadius: radius.md,
                opacity: locked ? 0.45 : 1,
              },
            ]}
          >
            <View style={[styles.circle, item.is_today ? styles.circleToday : null]}>
              <Text style={[styles.circleText, { color: colors.text }]} numberOfLines={1}>
                {center}
              </Text>
            </View>
            <Text style={[styles.dayNum, { color: colors.muted }]}>{item.day}</Text>
            <Text style={[styles.wd, { color: colors.muted }]}>{weekdayLabel(month, year, item.day)}</Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingVertical: 8 },
  cell: { width: 56, alignItems: "center", borderWidth: 1, paddingVertical: 8, paddingHorizontal: 4 },
  circle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  circleToday: { borderWidth: 2, borderColor: "#22d3ee" },
  circleText: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  dayNum: { fontSize: 10, marginTop: 4 },
  wd: { fontSize: 9, marginTop: 2 },
});
