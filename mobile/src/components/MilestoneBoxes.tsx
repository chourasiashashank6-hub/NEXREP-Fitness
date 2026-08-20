import { useCallback, useEffect, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

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

const VISIBLE_COUNT = 5;
const ITEM_GAP = 8;
/** Matches `styles.card` padding — used to derive inner row width from card layout. */
const CARD_PADDING = 14;
const MIN_BOX_SIZE = 28;
const MAX_BOX_SIZE = 44;
/** Used for the first frame only, before onLayout reports the card's content width. */
const FALLBACK_ITEM_WIDTH = 60;

function boxSizeForCount(count: number): number {
  if (count <= 3) return 44;
  if (count === 4) return 42;
  if (count === 5) return 38;
  return 34;
}

function exactItemWidth(contentWidth: number): number {
  if (contentWidth <= 0) return FALLBACK_ITEM_WIDTH;
  const gapsTotal = ITEM_GAP * (VISIBLE_COUNT - 1);
  return (contentWidth - gapsTotal) / VISIBLE_COUNT;
}

function boxSizeForItemWidth(itemWidth: number): number {
  return Math.min(MAX_BOX_SIZE, Math.max(MIN_BOX_SIZE, Math.round(itemWidth * 0.7)));
}

export function MilestoneBoxes({ title, items, accent = "green", emptyMessage }: Props) {
  const solid = accent === "orange" ? ORANGE : GREEN;
  const soft = accent === "orange" ? ORANGE_SOFT : GREEN_SOFT;
  const done = items.filter((i) => i.filled).length;
  const total = items.length;
  const scrollable = total > VISIBLE_COUNT;

  const [contentWidth, setContentWidth] = useState(0);
  const [atEnd, setAtEnd] = useState(false);

  // A changed item count means there is fresh content to the right again.
  useEffect(() => {
    setAtEnd(false);
  }, [total]);

  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setContentWidth((prev) => (Math.abs(prev - width) > 0.5 ? width : prev));
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setAtEnd(contentOffset.x + layoutMeasurement.width >= contentSize.width - 1);
  }, []);

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

  // Exactly VISIBLE_COUNT items span the card's content width, gaps included.
  const itemWidth = exactItemWidth(contentWidth);
  const size = scrollable ? boxSizeForItemWidth(itemWidth) : boxSizeForCount(total);

  const viewportWidth = contentWidth > 0 ? contentWidth : undefined;

  return (
    <View style={styles.card}>
      <View style={styles.header} onLayout={handleHeaderLayout}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.countPill, { backgroundColor: soft }]}>
          <Text style={[styles.count, { color: solid }]}>
            {done}/{total}
          </Text>
        </View>
      </View>

      <View style={styles.rowWrap}>
        {scrollable ? (
          <View
            style={[
              styles.scrollViewport,
              viewportWidth != null ? { width: viewportWidth, maxWidth: viewportWidth } : null,
            ]}
          >
            <ScrollView
              horizontal
              style={[styles.scroll, viewportWidth != null ? { width: viewportWidth } : null]}
              contentContainerStyle={styles.scrollContent}
              showsHorizontalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              nestedScrollEnabled
            >
              {items.map((item) => (
                <MilestoneBox key={item.key} item={item} size={size} solid={solid} soft={soft} fixedWidth={itemWidth} />
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.boxRow}>
            {items.map((item) => (
              <MilestoneBox key={item.key} item={item} size={size} solid={solid} soft={soft} />
            ))}
          </View>
        )}
        {scrollable ? (
          <View style={[styles.moreHint, atEnd && styles.moreHintHidden]} pointerEvents="none">
            <Ionicons name="chevron-forward" size={14} color={solid} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MilestoneBox({
  item,
  size,
  solid,
  soft,
  fixedWidth,
}: {
  item: MilestoneItem;
  size: number;
  solid: string;
  soft: string;
  fixedWidth?: number;
}) {
  return (
    <View style={fixedWidth ? [styles.boxColFixed, { width: fixedWidth }] : styles.boxCol}>
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
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: CARD_PADDING,
    marginBottom: 10,
    width: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
    minWidth: 0,
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
  rowWrap: {
    width: "100%",
    position: "relative",
    alignSelf: "stretch",
  },
  scrollViewport: {
    width: "100%",
    overflow: "hidden",
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    ...(Platform.OS === "web" ? { maxWidth: "100%" as unknown as number } : null),
  },
  boxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
    alignSelf: "stretch",
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: ITEM_GAP,
  },
  boxCol: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  /** Used inside the horizontal ScrollView — must not inherit boxCol's flex:1
   * (which sets flexBasis:0%) or the column collapses instead of scrolling. */
  boxColFixed: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    alignItems: "center",
    ...(Platform.OS === "web" ? { flexShrink: 0 as const } : null),
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
  /** Overlays the row — no extra card height. */
  moreHint: {
    position: "absolute",
    right: 0,
    bottom: 0,
    opacity: 0.55,
  },
  moreHintHidden: {
    opacity: 0,
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
