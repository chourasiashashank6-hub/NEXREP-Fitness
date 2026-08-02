import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { WC_COLORS } from "../../constants/workoutCoach";

const DEFAULT_MAX_LINES = 4;

type Props = {
  insight: string;
  loading: boolean;
  error?: string | null;
  placeholder?: string;
  maxLines?: number;
  expandLinkColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  placeholderColor?: string;
  lineHeight?: number;
};

export function InsightBubble({
  insight,
  loading,
  error,
  placeholder = "",
  maxLines = DEFAULT_MAX_LINES,
  expandLinkColor,
  backgroundColor = WC_COLORS.BG,
  borderColor = WC_COLORS.BORDER,
  textColor = WC_COLORS.TEXT,
  placeholderColor = WC_COLORS.MUTED,
  lineHeight = 19,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const linkColor = expandLinkColor ?? WC_COLORS.PURPLE_MID;

  useEffect(() => {
    setExpanded(false);
    setCanExpand(false);
  }, [insight]);

  const displayText = insight.trim() || placeholder;
  const isPlaceholder = !insight.trim() && Boolean(placeholder);

  return (
    <View style={[styles.wrap, { backgroundColor, borderColor }]}>
      {loading ? (
        <Text style={[styles.loading, { color: placeholderColor }]}>●  ●  ●</Text>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <View>
          <Text
            style={[styles.text, { color: isPlaceholder ? placeholderColor : textColor, lineHeight }]}
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
              accessibilityLabel={t("coach.components.showLess")}
              style={styles.expandRow}
            >
              <Text style={[styles.collapseLink, { color: linkColor }]}>{t("coach.components.showLess")}</Text>
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
    borderRadius: 12,
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
