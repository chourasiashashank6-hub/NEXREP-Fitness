import { StyleSheet, Text, View } from "react-native";

const GREEN = "#0F6E56";
const GREEN_SOFT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_SOFT = "#FEF1EE";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#8A8A84";
const BORDER = "#E8E6E1";
const CARD_BG = "#FFFFFF";

export type MilestoneItem = {
  key: string;
  label: string;
  filled: boolean;
  /** e.g. "Meal Planner", "Manual", "Scan" — shown under the meal label when filled */
  sourceLabel?: string;
};

type Props = {
  title: string;
  items: MilestoneItem[];
  /** green = meals, orange = sessions */
  accent?: "green" | "orange";
  emptyMessage?: string | null;
};

function boxSizeForCount(count: number): number {
  if (count <= 3) return 44;
  if (count === 4) return 42;
  if (count === 5) return 38;
  return 34;
}

export function MilestoneBoxes({ title, items, accent = "green", emptyMessage }: Props) {
  const solid = accent === "orange" ? ORANGE : GREEN;
  const soft = accent === "orange" ? ORANGE_SOFT : GREEN_SOFT;
  const done = items.filter((i) => i.filled).length;
  const total = items.length;
  const size = boxSizeForCount(total);

  if (emptyMessage) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <View style={[styles.restBanner, { backgroundColor: soft }]}>
          <Text style={[styles.emptyMessage, { color: solid }]}>{emptyMessage}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.countPill, { backgroundColor: soft }]}>
          <Text style={[styles.count, { color: solid }]}>
            {done}/{total}
          </Text>
        </View>
      </View>

      <View style={styles.boxRow}>
        {items.map((item) => (
          <View key={item.key} style={styles.boxCol}>
            <View
              style={[
                styles.box,
                {
                  width: size,
                  height: size,
                  borderRadius: Math.max(10, Math.round(size * 0.28)),
                },
                item.filled
                  ? { backgroundColor: solid, borderColor: solid }
                  : { backgroundColor: soft, borderColor: "transparent" },
              ]}
            >
              {item.filled ? (
                <Text style={[styles.check, { fontSize: size >= 40 ? 17 : 14 }]}>✓</Text>
              ) : (
                <View
                  style={[
                    styles.emptyDot,
                    {
                      width: size * 0.28,
                      height: size * 0.28,
                      borderColor: solid,
                      opacity: 0.45,
                    },
                  ]}
                />
              )}
            </View>
            <Text style={styles.boxLabel} numberOfLines={2}>
              {item.label}
            </Text>
            {item.filled && item.sourceLabel ? (
              <Text style={styles.sourceLabel} numberOfLines={1}>
                {item.sourceLabel}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    marginBottom: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  title: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },
  countPill: {
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  count: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  boxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
  },
  boxCol: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
    paddingHorizontal: 2,
  },
  box: {
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  check: {
    color: WHITE,
    fontWeight: "800",
  },
  emptyDot: {
    borderRadius: 99,
    borderWidth: 2,
    backgroundColor: "transparent",
  },
  boxLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 13,
    width: "100%",
  },
  sourceLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 11,
    width: "100%",
    opacity: 0.85,
    marginTop: 1,
  },
  restBanner: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 2,
  },
  emptyMessage: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
});
