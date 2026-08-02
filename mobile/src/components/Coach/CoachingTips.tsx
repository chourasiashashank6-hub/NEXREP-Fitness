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
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { DynamicCoachingTip, DynamicCoachingTipPriority } from "../../types/workoutCoach";
import { WC_COLORS } from "../../constants/workoutCoach";
import { CoachingIcon } from "../../utils/coachingIcons";

const PRIORITY_ORDER: Record<DynamicCoachingTipPriority, number> = { high: 0, medium: 1, low: 2 };

const PRIORITY_STYLES: Record<
  DynamicCoachingTipPriority,
  { badgeBg: string; badgeText: string; border: string }
> = {
  high: { badgeBg: WC_COLORS.ORANGE_LIGHT, badgeText: WC_COLORS.ORANGE, border: WC_COLORS.ORANGE },
  medium: { badgeBg: WC_COLORS.AMBER_LIGHT, badgeText: WC_COLORS.AMBER_TEXT, border: WC_COLORS.AMBER },
  low: { badgeBg: WC_COLORS.GREEN_LIGHT, badgeText: WC_COLORS.GREEN, border: WC_COLORS.GREEN },
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
          borderLeftColor: priorityStyle.border,
        },
      ]}
    >
      <View style={styles.tipRow}>
        <View style={[styles.iconBox, { backgroundColor: priorityStyle.badgeBg }]}>
          <CoachingIcon iconName={tip.icon} size={18} />
        </View>
        <Text style={styles.tipTitle} numberOfLines={expanded ? undefined : 1}>
          {tip.title}
        </Text>
        <View style={[styles.priorityBadge, { backgroundColor: priorityStyle.badgeBg }]}>
          <Text style={[styles.priorityText, { color: priorityStyle.badgeText }]}>{tip.priority}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? "∨" : "›"}</Text>
      </View>
      {expanded ? (
        <View style={styles.expandedBody}>
          <Text style={styles.tipBody}>{tip.body}</Text>
          <View style={styles.categoryPill}>
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
  const { t } = useTranslation();
  const sorted = useMemo(() => sortTips(tips), [tips]);
  const highCount = sorted.filter((t) => t.priority === "high").length;

  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{t("coach.components.aiCoachingTips")}</Text>
        {!loading && sorted.length > 0 ? (
          <Text style={styles.tipCount}>{t("coach.components.tipsCount", { count: sorted.length })}</Text>
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
              <Ionicons name="flash" size={14} color={WC_COLORS.PURPLE} />
              <Text style={styles.priorityBannerText}>
                {t("coach.components.highPriorityTips", { count: highCount, plural: highCount === 1 ? "" : "s" })}
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
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: WC_COLORS.MUTED,
  },
  tipCount: { color: WC_COLORS.PURPLE_MID, fontSize: 11, fontWeight: "800" },
  priorityBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: WC_COLORS.PURPLE_LIGHT,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  priorityBannerText: { flex: 1, fontSize: 12, fontWeight: "800", color: WC_COLORS.PURPLE, lineHeight: 17 },
  list: { gap: 8 },
  tipCard: {
    backgroundColor: WC_COLORS.WHITE,
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
    borderLeftWidth: 3,
    borderRadius: 16,
    padding: 14,
  },
  tipRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tipTitle: { flex: 1, color: WC_COLORS.TEXT, fontSize: 13, fontWeight: "800" },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  priorityText: { fontSize: 9, fontWeight: "800", textTransform: "lowercase" },
  chevron: { color: WC_COLORS.MUTED, fontSize: 16, fontWeight: "600", width: 14, textAlign: "center" },
  expandedBody: { marginTop: 10, paddingLeft: 43 },
  tipBody: { color: "#555555", fontSize: 11, lineHeight: 17, marginBottom: 6 },
  categoryPill: {
    alignSelf: "flex-start",
    backgroundColor: WC_COLORS.BG,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#888888",
    textTransform: "lowercase",
  },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: WC_COLORS.BG,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: WC_COLORS.BORDER,
  },
  skeletonIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: WC_COLORS.BORDER,
  },
  skeletonBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  skeletonLine: { height: 10, borderRadius: 4, backgroundColor: WC_COLORS.BORDER },
  skeletonBadge: { width: 44, height: 18, borderRadius: 99, backgroundColor: WC_COLORS.BORDER },
});
