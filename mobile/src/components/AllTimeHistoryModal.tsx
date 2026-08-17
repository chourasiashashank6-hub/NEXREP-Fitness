import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getWorkoutHistory, getWorkoutTotalBurn, type WorkoutHistoryItem } from "../api/workout";
import { useTranslation } from "react-i18next";
import { resolveWorkoutLogSource, WORKOUT_LOG_SOURCE_I18N_KEY } from "../utils/workoutLogSource";

const GREEN = "#0F6E56";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#8A8A86";
const TERTIARY = "#BBBBBB";
const BORDER = "#E2E2DD";
const ORANGE_DARK = "#993C1D";
const PAGE_SIZE = 20;

type Props = {
  visible: boolean;
  onClose: () => void;
};

type HistorySection = {
  title: string;
  data: WorkoutHistoryItem[];
};

const parseBodyPartFromNotes = (notes?: string | null): string => {
  if (!notes) return "";
  const match = String(notes).match(/body_part=([^;]+)/i);
  return match?.[1]?.trim() || "";
};

const parseServerDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(raw) && !/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateKey = (value: unknown): string => {
  const parsed = parseServerDate(value);
  if (!parsed) return "unknown";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateHeader = (dateKey: string): string => {
  if (dateKey === "unknown") return "Unknown date";
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return isToday ? `Today · ${label}` : label;
};

const buildSections = (items: WorkoutHistoryItem[]): HistorySection[] => {
  const grouped = new Map<string, WorkoutHistoryItem[]>();
  for (const item of items) {
    const key = toDateKey(item.date);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return Array.from(grouped.entries()).map(([key, data]) => ({
    title: formatDateHeader(key),
    data,
  }));
};

const rowSubtitle = (item: WorkoutHistoryItem): string => {
  const bodyPart = item.bodyPart || parseBodyPartFromNotes(item.notes) || "Body";
  const sets = Number(item.sets) || 0;
  const reps = Number(item.reps) || 0;
  return `${bodyPart} · ${sets} x ${reps}`;
};

export default function AllTimeHistoryModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<WorkoutHistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [totalBurned, setTotalBurned] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const sections = useMemo(() => buildSections(items), [items]);
  const hasMore = items.length < historyTotal;
  const showEverything = !loading && !hasMore && items.length > 0;

  const loadPage = useCallback(
    async (offset: number, query: string) => {
      const isFirstPage = offset === 0;
      if (isFirstPage) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const [historyData, totals] = await Promise.all([
          getWorkoutHistory({
            range: "all",
            limit: PAGE_SIZE,
            offset,
            search: query.trim() || undefined,
          }),
          isFirstPage ? getWorkoutTotalBurn() : Promise.resolve(null),
        ]);
        setHistoryTotal(historyData.total ?? historyData.items.length);
        setItems((prev) => (isFirstPage ? historyData.items ?? [] : [...prev, ...(historyData.items ?? [])]));
        if (totals) {
          setTotalCount(totals.sessionCount);
          setTotalBurned(Math.round(Number(totals.totalCaloriesBurned) || 0));
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!visible) return;
    setItems([]);
    setHistoryTotal(0);
    void loadPage(0, search);
  }, [loadPage, search, visible]);

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    void loadPage(items.length, search);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Pressable style={styles.iconButton} onPress={onClose} hitSlop={10}>
              <Text style={styles.backText}>‹</Text>
            </Pressable>
            <Text style={styles.title}>All time history</Text>
            <Pressable style={styles.iconButton} onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total sessions</Text>
              <Text style={styles.statValue}>{totalCount}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total burned</Text>
              <Text style={styles.statValueBurn}>{totalBurned} kcal</Text>
            </View>
          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search exercise"
            placeholderTextColor={TERTIARY}
            style={styles.searchInput}
            returnKeyType="search"
          />

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={GREEN} />
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={items.length === 0 ? styles.emptyListContent : styles.listContent}
              stickySectionHeadersEnabled={false}
              keyboardShouldPersistTaps="handled"
              onEndReached={loadMore}
              onEndReachedThreshold={0.35}
              ListEmptyComponent={<Text style={styles.emptyText}>No workouts yet</Text>}
              ListFooterComponent={
                loadingMore ? (
                  <ActivityIndicator color={GREEN} style={styles.footerLoader} />
                ) : showEverything ? (
                  <Text style={styles.endText}>That's everything so far</Text>
                ) : null
              }
              renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
              renderItem={({ item }) => {
                const logSource = resolveWorkoutLogSource(item);
                return (
                <View style={styles.historyRow}>
                  <View style={styles.checkCircle}>
                    <Text style={styles.checkText}>✓</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.exerciseName} numberOfLines={1}>
                      {item.exerciseName || "Workout"}
                    </Text>
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {rowSubtitle(item)} · {t(WORKOUT_LOG_SOURCE_I18N_KEY[logSource])}
                    </Text>
                  </View>
                  <Text style={styles.kcalText}>{Math.round(Number(item.caloriesBurned) || 0)} kcal</Text>
                </View>
              );
              }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%",
    minHeight: "62%",
    backgroundColor: WHITE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    alignSelf: "center",
    marginBottom: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: GREEN, fontSize: 28, fontWeight: "500", lineHeight: 30 },
  closeText: { color: TEXT, fontSize: 23, fontWeight: "500", lineHeight: 26 },
  title: { flex: 1, textAlign: "center", color: TEXT, fontSize: 18, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: BG, borderRadius: 16, padding: 14 },
  statLabel: { color: MUTED, fontSize: 11, fontWeight: "700", marginBottom: 8 },
  statValue: { color: TEXT, fontSize: 22, fontWeight: "800" },
  statValueBurn: { color: ORANGE_DARK, fontSize: 22, fontWeight: "800" },
  searchInput: {
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    color: TEXT,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 12,
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  listContent: { paddingBottom: 10 },
  emptyListContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48 },
  dateHeader: { color: MUTED, fontSize: 12, fontWeight: "800", marginTop: 8, marginBottom: 6 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: WHITE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    paddingVertical: 12,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#E8F5EE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  rowBody: { flex: 1, minWidth: 0, paddingRight: 10 },
  exerciseName: { color: TEXT, fontSize: 14, fontWeight: "500" },
  subtitle: { color: MUTED, fontSize: 12, marginTop: 3 },
  kcalText: { color: ORANGE_DARK, fontSize: 13, fontWeight: "800", textAlign: "right" },
  emptyText: { color: MUTED, fontSize: 14, fontWeight: "600", textAlign: "center" },
  footerLoader: { marginTop: 14 },
  endText: { color: TERTIARY, fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 16 },
});
