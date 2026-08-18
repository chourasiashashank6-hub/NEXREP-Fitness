import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { fetchJourneyEvents, type JourneyEventItem } from "../../api/journey";

type Props = {
  domain?: string;
  titleKey?: string;
  accentColor?: string;
  limit?: number;
};

const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";

export function CoachJourneySection({
  domain,
  titleKey = "coach.journey.sectionTitle",
  accentColor = "#0F6E56",
  limit = 5,
}: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<JourneyEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

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
    void load(0, false);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="small" color={accentColor} />
      </View>
    );
  }

  if (!items.length) return null;

  const hasMore = items.length < total;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>{t(titleKey)}</Text>
        <View style={[styles.badge, { backgroundColor: `${accentColor}18` }]}>
          <Text style={[styles.badgeText, { color: accentColor }]}>{items.filter((i) => i.status === "active").length}</Text>
        </View>
      </View>
      {items.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={[styles.dot, { backgroundColor: item.status === "active" ? accentColor : MUTED }]} />
            <Text style={styles.cardStatus}>
              {item.status === "active" ? t("coach.journey.active") : t("coach.journey.resolved")}
            </Text>
            {item.detected_at ? (
              <Text style={styles.cardDate}>{new Date(item.detected_at).toLocaleDateString()}</Text>
            ) : null}
          </View>
          <Text style={styles.cardBody}>{t(item.recommendation_key, item.recommendation_params)}</Text>
        </View>
      ))}
      {hasMore ? (
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  loadingBox: { paddingVertical: 8, alignItems: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sectionLabel: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  badge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "900" },
  card: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  dot: { width: 7, height: 7, borderRadius: 99 },
  cardStatus: { color: TEXT, fontSize: 10, fontWeight: "800", flex: 1 },
  cardDate: { color: MUTED, fontSize: 10, fontWeight: "700" },
  cardBody: { color: "#555555", fontSize: 12, lineHeight: 18 },
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
