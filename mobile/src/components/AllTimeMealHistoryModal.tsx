import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BlurredModal } from "./BlurredModal";
import {
  getCalorieMealHistory,
  type CalorieMealDayTotal,
  type CalorieMealHistoryItem,
  type MealType,
} from "../api/caloriesLog";

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
  refreshToken?: number;
};

type MealHistorySection = {
  key: string;
  title: string;
  data: CalorieMealHistoryItem[];
  total?: CalorieMealDayTotal;
};

const MEAL_LABELS: Record<MealType, string> = {
  Breakfast: "Breakfast",
  Lunch: "Lunch",
  Dinner: "Dinner",
  Snack: "Snacks",
  Pre_Workout: "Pre-workout",
  Post_Workout: "Post-workout",
};

const fmt1 = (value: number) => (Math.round((Number(value) || 0) * 10) / 10).toString();

const parseServerDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(raw) && !/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateHeader = (dateKey: string): string => {
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

const getDateKey = (item: CalorieMealHistoryItem): string => item.date || "unknown";

const buildSections = (
  items: CalorieMealHistoryItem[],
  dayTotals: Record<string, CalorieMealDayTotal>,
): MealHistorySection[] => {
  const grouped = new Map<string, CalorieMealHistoryItem[]>();
  for (const item of items) {
    const key = getDateKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return Array.from(grouped.entries()).map(([key, data]) => ({
    key,
    title: key === "unknown" ? "Unknown date" : formatDateHeader(key),
    data,
    total: dayTotals[key],
  }));
};

const sortMealsNewestFirst = (items: CalorieMealHistoryItem[]) =>
  [...items].sort((a, b) => {
    const aTime = parseServerDate(a.logged_at)?.getTime() ?? 0;
    const bTime = parseServerDate(b.logged_at)?.getTime() ?? 0;
    return bTime - aTime;
  });

const mealSubtitle = (item: CalorieMealHistoryItem): string => {
  const category = MEAL_LABELS[item.meal_type] ?? item.meal_type;
  return `${category} · ${fmt1(item.quantity_g)}g · P ${fmt1(item.total_protein_g)} · C ${fmt1(item.total_carbs_g)} · F ${fmt1(item.total_fat_g)} · Fi ${fmt1(item.total_fiber_g || 0)}`;
};

const dayTotalLine = (total: CalorieMealDayTotal): string =>
  `${fmt1(total.total_calories)} kcal · ${fmt1(total.total_protein_g)}p · ${fmt1(total.total_carbs_g)}c · ${fmt1(total.total_fat_g)}f · ${fmt1(total.total_fiber_g || 0)}fi`;

export default function AllTimeMealHistoryModal({ visible, onClose, refreshToken = 0 }: Props) {
  const [items, setItems] = useState<CalorieMealHistoryItem[]>([]);
  const [dayTotals, setDayTotals] = useState<Record<string, CalorieMealDayTotal>>({});
  const [search, setSearch] = useState("");
  const [totalMeals, setTotalMeals] = useState(0);
  const [totalKcal, setTotalKcal] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);

  const sections = useMemo(() => buildSections(items, dayTotals), [dayTotals, items]);
  const hasMore = items.length < historyTotal;
  const showEverything = !loading && !hasMore && items.length > 0;

  const loadPage = useCallback(async (offset: number, query: string) => {
    const requestId = ++requestIdRef.current;
    const isFirstPage = offset === 0;
    if (isFirstPage) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const historyData = await getCalorieMealHistory({
        range: "all",
        limit: PAGE_SIZE,
        offset,
        search: query.trim() || undefined,
      });
      if (requestId !== requestIdRef.current) return;
      setHistoryTotal(historyData.total ?? historyData.items.length);
      setItems((prev) => (isFirstPage ? historyData.items ?? [] : sortMealsNewestFirst([...prev, ...(historyData.items ?? [])])));
      setDayTotals((prev) => (isFirstPage ? historyData.dayTotals ?? {} : { ...prev, ...(historyData.dayTotals ?? {}) }));
      setTotalMeals(historyData.summary?.totalMealsLogged ?? historyData.total ?? 0);
      setTotalKcal(Math.round(Number(historyData.summary?.totalCalories) || 0));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setItems([]);
    setDayTotals({});
    setHistoryTotal(0);
    void loadPage(0, search);
  }, [loadPage, refreshToken, search, visible]);

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    void loadPage(items.length, search);
  };

  return (
    <BlurredModal visible={visible} onClose={onClose} variant="bottom">
      <View style={styles.sheetInner}>
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
              <Text style={styles.statLabel}>Total meals logged</Text>
              <Text style={styles.statValue}>{totalMeals}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total kcal</Text>
              <Text style={styles.statValueBurn}>{totalKcal} kcal</Text>
            </View>
          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search food"
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
              keyExtractor={(item) => `${item.source_type ?? "database"}-${item.meal_id}`}
              contentContainerStyle={items.length === 0 ? styles.emptyListContent : styles.listContent}
              stickySectionHeadersEnabled={false}
              keyboardShouldPersistTaps="handled"
              onEndReached={loadMore}
              onEndReachedThreshold={0.35}
              ListEmptyComponent={<Text style={styles.emptyText}>No meals logged yet</Text>}
              ListFooterComponent={
                loadingMore ? (
                  <ActivityIndicator color={GREEN} style={styles.footerLoader} />
                ) : showEverything ? (
                  <Text style={styles.endText}>That's everything so far</Text>
                ) : null
              }
              renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
              renderSectionFooter={({ section }) =>
                section.total ? (
                  <View style={styles.dayTotalRow}>
                    <Text style={styles.dayTotalLabel}>Day total</Text>
                    <Text style={styles.dayTotalValue}>{dayTotalLine(section.total)}</Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <View style={styles.mealRow}>
                  <View style={styles.rowBody}>
                    <Text style={styles.foodName} numberOfLines={1}>
                      {item.food_name || "Meal"}
                    </Text>
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {mealSubtitle(item)}
                    </Text>
                  </View>
                  <Text style={styles.kcalText}>{fmt1(item.total_calories)} kcal</Text>
                </View>
              )}
            />
          )}
      </View>
    </BlurredModal>
  );
}

const styles = StyleSheet.create({
  sheetInner: {
    flex: 1,
    minHeight: 420,
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
  mealRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    paddingVertical: 12,
    gap: 10,
  },
  rowBody: { flex: 1, minWidth: 0 },
  foodName: { color: TEXT, fontSize: 14, fontWeight: "500" },
  subtitle: { color: MUTED, fontSize: 12, marginTop: 4 },
  kcalText: { color: ORANGE_DARK, fontSize: 13, fontWeight: "800", textAlign: "right" },
  dayTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    paddingTop: 10,
    paddingBottom: 8,
  },
  dayTotalLabel: { color: TERTIARY, fontSize: 12, fontWeight: "700" },
  dayTotalValue: { color: TEXT, fontSize: 13, fontWeight: "500", textAlign: "right", flex: 1 },
  emptyText: { color: MUTED, fontSize: 14, fontWeight: "600", textAlign: "center" },
  footerLoader: { marginTop: 14 },
  endText: { color: TERTIARY, fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 16 },
});
