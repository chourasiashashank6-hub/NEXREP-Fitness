import { useEffect, useMemo, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { weekdayLabel } from "../../utils/localDate";

const BLUE = '#4A90D9';
const BLUE_LIGHT = '#EEF4FB';
const ORANGE = '#D85A30';
const ORANGE_LIGHT = '#FFF1EE';
const AMBER = '#FFB800';
const AMBER_LIGHT = '#FFF8E8';
const AMBER_TEXT = '#C08000';
const GOLD = '#FFD700';
const BG = '#F7F6F3';
const WHITE = '#FFFFFF';
const TEXT = '#1A1A18';
const MUTED = '#BBBBBB';
const TRACK = '#E5E4E0';
const BORDER = '#ECEAE5';
const CELL_WIDTH = 40;
const CELL_GAP = 12;
const CELL_STEP = CELL_WIDTH + CELL_GAP;

export type PlannerCalendarDay = {
  day: number;
  is_past: boolean;
  is_today: boolean;
  is_future: boolean;
  is_cheat_day?: boolean;
  is_rest_day?: boolean;
  split_name?: string;
};

type Props = {
  month: number;
  year: number;
  days: PlannerCalendarDay[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
  mode: "meal" | "workout";
  allowFutureSelection?: boolean;
};

export function PlannerMonthCalendar({
  month,
  year,
  days,
  selectedDay,
  onSelectDay,
  mode,
  allowFutureSelection = false,
}: Props) {
  const { t } = useTranslation();
  const listRef = useRef<FlatList<PlannerCalendarDay>>(null);
  const selectedIndex = useMemo(() => days.findIndex((item) => item.day === selectedDay), [days, selectedDay]);
  const initialScrollIndex = Math.max(0, selectedIndex - 2);

  useEffect(() => {
    if (selectedIndex < 0 || days.length === 0) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: selectedIndex,
        animated: false,
        viewPosition: 0.45,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [days.length, selectedIndex]);

  return (
    <FlatList
      ref={listRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      data={days}
      initialScrollIndex={initialScrollIndex}
      getItemLayout={(_, index) => ({
        length: CELL_STEP,
        offset: CELL_STEP * index,
        index,
      })}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({
          offset: Math.max(0, info.averageItemLength * initialScrollIndex),
          animated: false,
        });
      }}
      keyExtractor={(item) => String(item.day)}
      style={styles.list}
      contentContainerStyle={styles.strip}
      renderItem={({ item }) => {
        const locked = item.is_future && !allowFutureSelection;
        const selected = item.day === selectedDay;
        const isMealMode = mode === "meal";
        const center =
          locked
            ? null
            : item.is_today
              ? String(item.day)
              : item.is_past
                ? "✓"
                : String(item.day);

        return (
          <Pressable disabled={locked} onPress={() => onSelectDay(item.day)} style={styles.cell}>
            <View
              style={[
                styles.circle,
                locked
                  ? styles.circleLocked
                  : item.is_today
                    ? isMealMode ? styles.circleTodayMeal : styles.circleToday
                    : item.is_past
                      ? isMealMode ? styles.circlePastMeal : styles.circlePast
                      : styles.circleFuture,
                selected && !item.is_today && (isMealMode ? styles.circleSelectedMeal : styles.circleSelected),
              ]}
            >
              {locked ? (
                <Ionicons name="lock-closed-outline" size={13} color={MUTED} />
              ) : (
                <Text
                  style={[
                    styles.circleText,
                    item.is_today && styles.circleTextToday,
                    item.is_past && !item.is_today && (isMealMode ? styles.circleTextPastMeal : styles.circleTextPast),
                  ]}
                  numberOfLines={1}
                >
                  {center}
                </Text>
              )}
            </View>
            <Text style={[styles.dayNum, item.is_today && (isMealMode ? styles.dayNumTodayMeal : styles.dayNumToday), item.is_past && (isMealMode ? styles.dayNumPastMeal : styles.dayNumPast)]}>
              {item.day}
            </Text>
            <Text style={[styles.wd, item.is_today && (isMealMode ? styles.wdTodayMeal : styles.wdToday)]}>
              {item.is_today ? t("streak.days.today") : weekdayLabel(month, year, item.day)}
            </Text>
            {mode === "workout" && item.is_rest_day ? <Text style={styles.restMarker}>{t("coach.components.restMarker")}</Text> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER, marginHorizontal: -16, marginBottom: 12 },
  strip: { gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  cell: { alignItems: "center", gap: 3, width: 40 },
  circle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  circlePast: { backgroundColor: ORANGE_LIGHT },
  circlePastMeal: { backgroundColor: BLUE_LIGHT },
  circleToday: { backgroundColor: ORANGE },
  circleTodayMeal: { backgroundColor: BLUE },
  circleFuture: { backgroundColor: TRACK },
  circleLocked: { backgroundColor: TRACK },
  circleSelected: { borderWidth: 1, borderColor: ORANGE },
  circleSelectedMeal: { borderWidth: 1, borderColor: BLUE },
  circleText: { color: MUTED, fontSize: 11, fontWeight: "800", textAlign: "center" },
  circleTextPast: { color: ORANGE, fontSize: 14 },
  circleTextPastMeal: { color: BLUE, fontSize: 14 },
  circleTextToday: { color: WHITE, fontSize: 11 },
  dayNum: { color: MUTED, fontSize: 9, fontWeight: "700" },
  dayNumPast: { color: ORANGE, fontWeight: "800" },
  dayNumPastMeal: { color: BLUE, fontWeight: "800" },
  dayNumToday: { color: ORANGE, fontWeight: "800" },
  dayNumTodayMeal: { color: BLUE, fontWeight: "800" },
  wd: { color: MUTED, fontSize: 9 },
  wdToday: { color: ORANGE, fontWeight: "800" },
  wdTodayMeal: { color: BLUE, fontWeight: "800" },
  restMarker: { color: AMBER_TEXT, fontSize: 8, fontWeight: "800", marginTop: -1 },
});
