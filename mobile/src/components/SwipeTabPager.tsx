import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export type SwipeTabPagerHandle = {
  scrollToIndex: (index: number, animated?: boolean) => void;
};

type Props = {
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
  children: ReactNode[];
  /** Pages at or above this index mount only after first visit (default: never lazy). */
  lazyFromIndex?: number;
  onPageVisible?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
};

const SCROLL_SETTLE_MS = 80;

export const SwipeTabPager = forwardRef<SwipeTabPagerHandle, Props>(function SwipeTabPager(
  { pageIndex, onPageIndexChange, children, lazyFromIndex, onPageVisible, style },
  ref,
) {
  const scrollRef = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [visitedPages, setVisitedPages] = useState<Set<number>>(() => new Set([pageIndex]));
  const lastReportedIndex = useRef(pageIndex);
  const onPageIndexChangeRef = useRef(onPageIndexChange);
  const onPageVisibleRef = useRef(onPageVisible);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageCount = children.length;
  const clampedIndex = Math.max(0, Math.min(pageCount - 1, pageIndex));

  useEffect(() => {
    onPageIndexChangeRef.current = onPageIndexChange;
  }, [onPageIndexChange]);

  useEffect(() => {
    onPageVisibleRef.current = onPageVisible;
  }, [onPageVisible]);

  const scrollToIndex = useCallback(
    (index: number, animated = true) => {
      if (width <= 0) return;
      const target = Math.max(0, Math.min(pageCount - 1, index));
      scrollRef.current?.scrollTo({ x: target * width, animated });
    },
    [pageCount, width],
  );

  useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex]);

  const markPageVisited = useCallback((index: number) => {
    setVisitedPages((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      onPageVisibleRef.current?.(index);
      return next;
    });
  }, []);

  const reportPageFromOffset = useCallback(
    (offsetX: number) => {
      if (width <= 0) return;
      const nextIndex = Math.round(offsetX / width);
      const clamped = Math.max(0, Math.min(pageCount - 1, nextIndex));
      markPageVisited(clamped);
      if (clamped === lastReportedIndex.current) return;
      lastReportedIndex.current = clamped;
      onPageIndexChangeRef.current(clamped);
    },
    [markPageVisited, pageCount, width],
  );

  const scheduleSettleReport = useCallback(
    (offsetX: number, delayMs = SCROLL_SETTLE_MS) => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        reportPageFromOffset(offsetX);
      }, delayMs);
    },
    [reportPageFromOffset],
  );

  useEffect(() => {
    lastReportedIndex.current = clampedIndex;
  }, [clampedIndex]);

  useEffect(() => {
    scrollToIndex(clampedIndex, false);
  }, [clampedIndex, scrollToIndex, width]);

  useEffect(() => {
    markPageVisited(clampedIndex);
  }, [clampedIndex, markPageVisited]);

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0 && nextWidth !== width) {
      setWidth(nextWidth);
    }
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scheduleSettleReport(event.nativeEvent.contentOffset.x);
  };

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    reportPageFromOffset(event.nativeEvent.contentOffset.x);
  };

  const onScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scheduleSettleReport(event.nativeEvent.contentOffset.x, 120);
  };

  const shouldRenderPage = (index: number) => {
    if (lazyFromIndex == null || index < lazyFromIndex) return true;
    return visitedPages.has(index);
  };

  return (
    <View style={[styles.root, style]} onLayout={onLayout}>
      {width > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onMomentumScrollEnd={onMomentumScrollEnd}
          onScrollEndDrag={onScrollEndDrag}
          style={styles.scroll}
          contentContainerStyle={{ width: width * pageCount }}
        >
          {children.map((child, index) => (
            <View key={index} style={[styles.page, { width }]}>
              {shouldRenderPage(index) ? child : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  page: { flex: 1, minHeight: 0 },
});
