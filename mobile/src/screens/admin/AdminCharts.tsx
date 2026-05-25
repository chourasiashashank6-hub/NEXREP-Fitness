import { useMemo } from "react";
import { Dimensions, Platform, StyleSheet, Text, View } from "react-native";
import { COLORS } from "./adminTheme";

const CHART_HEIGHT = 140;
const CHART_WIDTH = Dimensions.get("window").width - 64;

type Point = { x: number; y: number };

function WebSparkline({
  data,
  color,
  emptyLabel,
}: {
  data: Point[];
  color: string;
  emptyLabel: string;
}) {
  if (data.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }
  const maxY = Math.max(...data.map((d) => d.y), 1);
  return (
    <View style={styles.webBars}>
      {data.map((d, i) => (
        <View key={i} style={styles.webBarCol}>
          <View
            style={[
              styles.webBar,
              { height: `${Math.max(4, (d.y / maxY) * 100)}%`, backgroundColor: color },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function NativeGrowthChart({ data }: { data: Point[] }) {
  const { Area, CartesianChart, Line } = require("victory-native") as typeof import("victory-native");
  if (data.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <CartesianChart data={data} xKey="x" yKeys={["y"]}>
        {({ points }: { points: { y: { x: number; y: number }[] } }) => (
          <>
            <Area points={points.y} color="rgba(29,158,117,0.15)" y0={0} />
            <Line points={points.y} color={COLORS.teal} strokeWidth={2} />
          </>
        )}
      </CartesianChart>
    </View>
  );
}

function NativeRevenueChart({ data }: { data: Point[] }) {
  const { Bar, CartesianChart } = require("victory-native") as typeof import("victory-native");
  if (data.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <CartesianChart data={data} xKey="x" yKeys={["y"]}>
        {({
          points,
          chartBounds,
        }: {
          points: { y: { x: number; y: number }[] };
          chartBounds: { top: number; bottom: number; left: number; right: number };
        }) => (
          <Bar
            points={points.y}
            chartBounds={chartBounds}
            color={COLORS.teal}
            roundedCorners={{ topLeft: 4, topRight: 4 }}
          />
        )}
      </CartesianChart>
    </View>
  );
}

function NativeTokensChart({ data }: { data: Point[] }) {
  const { Area, CartesianChart, Line } = require("victory-native") as typeof import("victory-native");
  if (data.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <CartesianChart data={data} xKey="x" yKeys={["y"]}>
        {({ points }: { points: { y: { x: number; y: number }[] } }) => (
          <>
            <Area points={points.y} color="rgba(127,119,221,0.12)" y0={0} />
            <Line points={points.y} color={COLORS.purple} strokeWidth={2} />
          </>
        )}
      </CartesianChart>
    </View>
  );
}

export function AdminGrowthChart({
  growthData,
}: {
  growthData: Array<{ date: string; new_users: number }>;
}) {
  const points = useMemo(
    () => growthData.map((d, i) => ({ x: i, y: d.new_users })),
    [growthData]
  );

  if (growthData.length === 0) {
    return (
      <Text style={styles.empty}>No signups yet</Text>
    );
  }

  if (Platform.OS === "web") {
    return <WebSparkline data={points} color={COLORS.teal} emptyLabel="No signups yet" />;
  }
  return <NativeGrowthChart data={points} />;
}

export function AdminRevenueChart({
  revenueData,
}: {
  revenueData: Array<{ month: string; revenue_inr: number }>;
}) {
  const points = useMemo(
    () => revenueData.map((r, i) => ({ x: i, y: r.revenue_inr })),
    [revenueData]
  );

  if (revenueData.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>No revenue data yet</Text>
        <Text style={styles.emptyHint}>Will populate when Razorpay is active</Text>
      </View>
    );
  }

  if (Platform.OS === "web") {
    return <WebSparkline data={points} color={COLORS.teal} emptyLabel="No revenue data yet" />;
  }
  return <NativeRevenueChart data={points} />;
}

export function AdminDailyTokensChart({
  dailyData,
}: {
  dailyData: Array<{ date: string; tokens: number }>;
}) {
  const points = useMemo(
    () => dailyData.map((d, i) => ({ x: i, y: d.tokens })),
    [dailyData]
  );

  if (dailyData.length === 0) {
    return <Text style={styles.empty}>No data for this period</Text>;
  }

  if (Platform.OS === "web") {
    return <WebSparkline data={points} color={COLORS.purple} emptyLabel="No data for this period" />;
  }
  return <NativeTokensChart data={points} />;
}

const styles = StyleSheet.create({
  wrap: { height: CHART_HEIGHT, width: CHART_WIDTH },
  empty: { color: COLORS.textHint, fontSize: 12, textAlign: "center", paddingVertical: 20 },
  emptyWrap: { paddingVertical: 20, alignItems: "center" },
  emptyHint: { color: "#3d4450", fontSize: 11, marginTop: 4 },
  webBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: CHART_HEIGHT - 20,
    gap: 4,
    paddingHorizontal: 4,
  },
  webBarCol: { flex: 1, height: "100%", justifyContent: "flex-end" },
  webBar: { width: "100%", borderRadius: 4, minHeight: 4 },
});
