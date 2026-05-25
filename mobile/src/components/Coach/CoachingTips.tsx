import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import type { DynamicCoachingTip, DynamicCoachingTipPriority } from "../../types/workoutCoach";
import { WC_COLORS } from "../../constants/workoutCoach";
import { useAppTheme } from "../../theme";
import { CoachingIcon } from "../../utils/coachingIcons";

const PRIORITY_ORDER: Record<DynamicCoachingTipPriority, number> = { high: 0, medium: 1, low: 2 };

const PRIORITY_STYLES: Record<
  DynamicCoachingTipPriority,
  { badgeBg: string; badgeText: string; border: string }
> = {
  high: { badgeBg: "rgba(239, 68, 68, 0.15)", badgeText: "#EF4444", border: "#EF4444" },
  medium: { badgeBg: "rgba(251, 146, 60, 0.15)", badgeText: "#FB923C", border: "#FB923C" },
  low: { badgeBg: "rgba(74, 222, 128, 0.15)", badgeText: "#4ADE80", border: "#4ADE80" },
};

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function sortTips(tips: DynamicCoachingTip[]): DynamicCoachingTip[] {
  return [...tips].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

function TipSkeleton() {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity: pulse }]}>
      <View style={styles.skeletonIcon} />
      <View style={styles.skeletonBody}>
        <View style={[styles.skeletonLine, { width: "72%" }]} />
        <View style={[styles.skeletonBadge, { marginLeft: "auto" }]} />
      </View>
    </Animated.View>
  );
}

function TipCard({ tip }: { tip: DynamicCoachingTip }) {
  const { colors, radius } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const priorityStyle = PRIORITY_STYLES[tip.priority];

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  };

  return (
    <Pressable
      onPress={toggle}
      style={[
        styles.tipCard,
        {
          backgroundColor: colors.cardAlt,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderLeftColor: priorityStyle.border,
        },
      ]}
    >
      <View style={styles.tipRow}>
        <View style={[styles.iconBox, { backgroundColor: WC_COLORS.surface }]}>
          <CoachingIcon iconName={tip.icon} size={18} />
        </View>
        <Text style={[styles.tipTitle, { color: colors.text }]} numberOfLines={expanded ? undefined : 1}>
          {tip.title}
        </Text>
        <View style={[styles.priorityBadge, { backgroundColor: priorityStyle.badgeBg }]}>
          <Text style={[styles.priorityText, { color: priorityStyle.badgeText }]}>{tip.priority}</Text>
        </View>
        <Text style={[styles.chevron, { color: colors.muted }]}>{expanded ? "∨" : "›"}</Text>
      </View>
      {expanded ? (
        <View style={styles.expandedBody}>
          <Text style={[styles.tipBody, { color: colors.muted }]}>{tip.body}</Text>
          <View style={[styles.categoryPill, { backgroundColor: WC_COLORS.surface }]}>
            <Text style={styles.categoryText}>{tip.category}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

type Props = {
  tips: DynamicCoachingTip[];
  loading?: boolean;
};

export default function CoachingTips({ tips, loading = false }: Props) {
  const { colors } = useAppTheme();
  const sorted = useMemo(() => sortTips(tips), [tips]);
  const highCount = sorted.filter((t) => t.priority === "high").length;

  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>AI COACHING TIPS</Text>
        {!loading && sorted.length > 0 ? (
          <Text style={[styles.tipCount, { color: colors.muted }]}>{sorted.length} tips ›</Text>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.list}>
          <TipSkeleton />
          <TipSkeleton />
          <TipSkeleton />
        </View>
      ) : (
        <>
          {highCount > 0 ? (
            <View style={styles.priorityBanner}>
              <Text style={styles.priorityBannerIcon}>⚡</Text>
              <Text style={styles.priorityBannerText}>
                {highCount} high-priority tip{highCount === 1 ? "" : "s"} for you today
              </Text>
            </View>
          ) : null}
          <View style={styles.list}>
            {sorted.map((tip, i) => (
              <TipCard key={`${tip.title}-${tip.priority}-${i}`} tip={tip} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: WC_COLORS.textTertiary,
  },
  tipCount: { fontSize: 11, fontWeight: "600" },
  priorityBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(251, 146, 60, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(251, 146, 60, 0.35)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  priorityBannerIcon: { fontSize: 14 },
  priorityBannerText: { flex: 1, fontSize: 12, fontWeight: "600", color: "#FDE68A", lineHeight: 17 },
  list: { gap: 8 },
  tipCard: {
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 12,
  },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tipTitle: { flex: 1, fontSize: 13, fontWeight: "700" },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  priorityText: { fontSize: 10, fontWeight: "700", textTransform: "lowercase" },
  chevron: { fontSize: 16, fontWeight: "600", width: 14, textAlign: "center" },
  expandedBody: { marginTop: 10, paddingLeft: 42 },
  tipBody: { fontSize: 12, lineHeight: 18 },
  categoryPill: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: "600",
    color: WC_COLORS.textTertiary,
    textTransform: "lowercase",
  },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: WC_COLORS.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: WC_COLORS.border,
  },
  skeletonIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: WC_COLORS.border,
  },
  skeletonBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  skeletonLine: { height: 10, borderRadius: 4, backgroundColor: WC_COLORS.border },
  skeletonBadge: { width: 44, height: 18, borderRadius: 99, backgroundColor: WC_COLORS.border },
});
