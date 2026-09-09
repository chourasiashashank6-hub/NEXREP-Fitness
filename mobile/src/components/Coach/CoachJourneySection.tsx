import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { fetchJourneyEvents, resolveJourneyEvent, type JourneyEventItem } from "../../api/journey";
import { todayLocal } from "../../api/caloriesLog";
import { runJourneyDetectionOnce } from "../../utils/journeyDetectionSession";
import { copyForJourneyEvent } from "../../utils/journeyEventPresentation";
import { CoachJourneyHowItWorksSheet } from "./CoachJourneyHowItWorksSheet";
import { GREEN, BG, TEXT, BORDER, WHITE } from "../../theme/colors";

type Props = {
  domain?: string;
  titleKey?: string;
  accentColor?: string;
  limit?: number;
  refreshOnLoad?: boolean;
};

const MUTED = "#BBBBBB";
const AMBER = "#C08000";
const AMBER_LIGHT = "#FFF8E8";

function JourneyCard({
  item,
  accentColor,
  resolvingId,
  onDismiss,
}: {
  item: JourneyEventItem;
  accentColor: string;
  resolvingId: number | null;
  onDismiss?: (id: number) => void;
}) {
  const { t } = useTranslation();
  const copy = copyForJourneyEvent(item);
  const isActive = item.status === "active";
  const chipColor = isActive ? AMBER : MUTED;
  const chipBg = isActive ? AMBER_LIGHT : BG;

  return (
    <View style={[styles.card, !isActive && styles.cardCleared]}>
      <View style={styles.cardTop}>
        <View style={[styles.chip, { backgroundColor: chipBg }]}>
          <View style={[styles.dot, { backgroundColor: chipColor }]} />
          <Text style={[styles.chipText, { color: chipColor }]}>{copy.statusLabel}</Text>
        </View>
        {isActive && onDismiss ? (
          <Pressable
            style={styles.sortedBtn}
            onPress={() => onDismiss(item.id)}
            disabled={resolvingId === item.id}
            accessibilityRole="button"
            accessibilityLabel={t("coach.journey.markSorted")}
          >
            {resolvingId === item.id ? (
              <ActivityIndicator size="small" color={accentColor} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color={accentColor} />
                <Text style={[styles.sortedBtnText, { color: accentColor }]}>{t("coach.journey.markSorted")}</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.cardTitle}>{copy.title}</Text>
      <Text style={styles.cardBody}>{copy.body}</Text>
      {copy.action ? <Text style={styles.cardAction}>{copy.action}</Text> : null}
      {copy.dateLine ? <Text style={styles.cardDate}>{copy.dateLine}</Text> : null}
    </View>
  );
}

export function CoachJourneySection({
  domain,
  titleKey = "coach.journey.sectionTitle",
  accentColor = GREEN,
  limit = 30,
  refreshOnLoad = false,
}: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<JourneyEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [howItWorksVisible, setHowItWorksVisible] = useState(false);

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      try {
        if (append) setLoadingMore(true);
        else setLoading(true);
        const response = await fetchJourneyEvents({
          domain,
          limit,
          offset: nextOffset,
        });
        setTotal(response.total);
        setOffset(nextOffset + response.items.length);
        setItems((prev) => (append ? [...prev, ...response.items] : response.items));
      } catch {
        if (!append) {
          setItems([]);
          setTotal(0);
          setOffset(0);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [domain, limit],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (refreshOnLoad) {
          await runJourneyDetectionOnce(todayLocal(), domain);
        }
      } catch {
        // Still fetch whatever events exist if refresh fails.
      }
      if (!cancelled) {
        await load(0, false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, refreshOnLoad]);

  const activeItems = useMemo(() => items.filter((i) => i.status === "active"), [items]);
  const clearedItems = useMemo(() => items.filter((i) => i.status === "resolved"), [items]);

  const handleDismiss = async (eventId: number) => {
    setResolvingId(eventId);
    try {
      const updated = await resolveJourneyEvent(eventId);
      setItems((prev) => prev.map((item) => (item.id === eventId ? updated : item)));
    } catch {
      // Keep item visible if resolve fails.
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) return null;

  const hasMore = items.length < total;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerBlock}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionLabel}>{t(titleKey)}</Text>
          {activeItems.length > 0 ? (
            <View style={[styles.badge, { backgroundColor: `${AMBER}18` }]}>
              <Text style={[styles.badgeText, { color: AMBER }]}>
                {t("coach.journey.activeCount", { count: activeItems.length })}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.subheaderRow}>
          <Text style={styles.sectionSubtitle}>{t("coach.journey.sectionSubtitle")}</Text>
          <Pressable
            onPress={() => setHowItWorksVisible(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("coach.journey.howItWorks")}
          >
            <Text style={[styles.howItWorksLink, { color: accentColor }]}>{t("coach.journey.howItWorks")}</Text>
          </Pressable>
        </View>
      </View>

      {activeItems.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{t("coach.journey.emptyActive")}</Text>
        </View>
      ) : (
        activeItems.map((item) => (
          <JourneyCard
            key={item.id}
            item={item}
            accentColor={accentColor}
            resolvingId={resolvingId}
            onDismiss={handleDismiss}
          />
        ))
      )}

      {clearedItems.length > 0 ? (
        <>
          <Pressable
            style={styles.pastToggle}
            onPress={() => setShowPast((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showPast }}
          >
            <Ionicons name={showPast ? "chevron-up" : "chevron-down"} size={14} color={MUTED} />
            <Text style={styles.pastToggleText}>
              {showPast
                ? t("coach.journey.hidePastFlags")
                : t("coach.journey.showPastFlags", { count: clearedItems.length })}
            </Text>
          </Pressable>
          {showPast
            ? clearedItems.map((item) => <JourneyCard key={item.id} item={item} accentColor={accentColor} resolvingId={null} />)
            : null}
        </>
      ) : null}

      {showPast && hasMore ? (
        <Pressable style={styles.loadMoreBtn} onPress={() => void load(offset, true)} disabled={loadingMore}>
          {loadingMore ? (
            <ActivityIndicator size="small" color={accentColor} />
          ) : (
            <>
              <Ionicons name="chevron-down" size={14} color={accentColor} />
              <Text style={[styles.loadMoreText, { color: accentColor }]}>{t("coach.journey.loadMore")}</Text>
            </>
          )}
        </Pressable>
      ) : null}

      <CoachJourneyHowItWorksSheet
        visible={howItWorksVisible}
        onClose={() => setHowItWorksVisible(false)}
        accentColor={accentColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  headerBlock: { marginBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionLabel: { color: TEXT, fontSize: 13, fontWeight: "900", flex: 1 },
  badge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "900" },
  subheaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginTop: 4 },
  sectionSubtitle: { color: MUTED, fontSize: 11, lineHeight: 16, flex: 1 },
  howItWorksLink: { fontSize: 11, fontWeight: "800" },
  emptyBox: {
    backgroundColor: BG,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
  },
  emptyText: { color: MUTED, fontSize: 12, lineHeight: 18 },
  card: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  cardCleared: { opacity: 0.92 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 99 },
  chipText: { fontSize: 10, fontWeight: "800" },
  sortedBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2, paddingHorizontal: 2 },
  sortedBtnText: { fontSize: 10, fontWeight: "800" },
  cardTitle: { color: TEXT, fontSize: 13, fontWeight: "900", marginBottom: 4 },
  cardBody: { color: "#555555", fontSize: 12, lineHeight: 18 },
  cardAction: { color: TEXT, fontSize: 12, lineHeight: 18, fontWeight: "700", marginTop: 8 },
  cardDate: { color: MUTED, fontSize: 10, fontWeight: "700", marginTop: 8 },
  pastToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    marginBottom: 4,
  },
  pastToggleText: { color: MUTED, fontSize: 11, fontWeight: "800" },
  loadMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: BG,
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  loadMoreText: { fontSize: 11, fontWeight: "800" },
});
