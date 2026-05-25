import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../theme";

const DEFAULT_MAX_LINES = 4;

type Props = {
  insight: string;
  loading: boolean;
  error?: string | null;
  placeholder?: string;
  maxLines?: number;
  expandLinkColor?: string;
};

export function InsightBubble({
  insight,
  loading,
  error,
  placeholder = "",
  maxLines = DEFAULT_MAX_LINES,
  expandLinkColor,
}: Props) {
  const { colors, radius } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const linkColor = expandLinkColor ?? colors.primary;

  useEffect(() => {
    setExpanded(false);
    setCanExpand(false);
  }, [insight]);

  const displayText = insight.trim() || placeholder;
  const isPlaceholder = !insight.trim() && Boolean(placeholder);

  return (
    <View style={[styles.wrap, { backgroundColor: colors.cardAlt, borderColor: colors.border, borderRadius: radius.md }]}>
      {loading ? (
        <Text style={[styles.loading, { color: colors.muted }]}>●  ●  ●</Text>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <View>
          <Text
            style={[styles.text, { color: isPlaceholder ? colors.muted : colors.text }]}
            numberOfLines={expanded ? undefined : maxLines}
            ellipsizeMode={canExpand && !expanded ? "clip" : "tail"}
            onTextLayout={(e) => {
              if (expanded) return;
              const lines = e.nativeEvent.lines;
              if (lines.length > maxLines) {
                setCanExpand(true);
                return;
              }
              const last = lines[lines.length - 1] as { truncated?: boolean } | undefined;
              if (lines.length >= maxLines && last?.truncated) {
                setCanExpand(true);
              }
            }}
          >
            {displayText}
          </Text>

          {canExpand && !expanded ? (
            <Pressable
              onPress={() => setExpanded(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Expand insight"
              style={styles.expandRow}
            >
              <Text style={[styles.expandLink, { color: linkColor }]}>...</Text>
            </Pressable>
          ) : null}

          {canExpand && expanded ? (
            <Pressable
              onPress={() => setExpanded(false)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Collapse insight"
              style={styles.expandRow}
            >
              <Text style={[styles.collapseLink, { color: linkColor }]}>Show less</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    padding: 12,
    minHeight: 72,
    justifyContent: "center",
  },
  text: { fontSize: 13, lineHeight: 19 },
  expandRow: {
    alignSelf: "flex-start",
    marginTop: 2,
  },
  expandLink: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 19,
    textDecorationLine: "underline",
  },
  collapseLink: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  loading: { fontSize: 14, letterSpacing: 1, textAlign: "center" },
  error: { color: "#A32D2D", fontSize: 13, lineHeight: 19 },
});
