import { useCallback, useRef, type ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { CoachCadenceLockedPanel } from "./CoachCadenceLockedPanel";
import { SwipeTabPager, type SwipeTabPagerHandle } from "../SwipeTabPager";
import type { CoachCadence } from "../../hooks/useCoachRedesign";

const CADENCE_ORDER: CoachCadence[] = ["daily", "weekly", "monthly", "yearly"];

type Props = {
  cadence: CoachCadence;
  accentColor: string;
  isCadenceLocked: (value: CoachCadence) => boolean;
  onCadenceChange: (value: CoachCadence) => void;
  onYearlyPress: () => void;
  renderSummary: (value: Exclude<CoachCadence, "yearly">) => ReactNode;
};

export function CoachCadencePager({
  cadence,
  accentColor,
  isCadenceLocked,
  onCadenceChange,
  onYearlyPress,
  renderSummary,
}: Props) {
  const pagerRef = useRef<SwipeTabPagerHandle>(null);
  const pageIndex = Math.max(0, CADENCE_ORDER.indexOf(cadence));

  const handlePageChange = useCallback(
    (index: number) => {
      const next = CADENCE_ORDER[index];
      if (next === "yearly") {
        if (isCadenceLocked("yearly")) {
          onCadenceChange("yearly");
        } else {
          onYearlyPress();
          pagerRef.current?.scrollToIndex(pageIndex, true);
        }
        return;
      }
      onCadenceChange(next);
    },
    [isCadenceLocked, onCadenceChange, onYearlyPress, pageIndex],
  );

  const renderPage = (value: CoachCadence) => {
    if (value === "yearly" || (value === "monthly" && isCadenceLocked("monthly"))) {
      return <CoachCadenceLockedPanel cadence={value === "yearly" ? "yearly" : "monthly"} accentColor={accentColor} />;
    }
    if (value === "daily" || value === "weekly" || value === "monthly") {
      return renderSummary(value);
    }
    return null;
  };

  return (
    <SwipeTabPager
      ref={pagerRef}
      pageIndex={pageIndex}
      onPageIndexChange={handlePageChange}
      lazyFromIndex={1}
      style={styles.pager}
    >
      {CADENCE_ORDER.map((value) => (
        <ScrollView
          key={value}
          style={styles.pageScroll}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.pageContent}
        >
          {renderPage(value)}
        </ScrollView>
      ))}
    </SwipeTabPager>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1, minHeight: 0 },
  pageScroll: { flex: 1 },
  pageContent: { paddingBottom: 24 },
});
