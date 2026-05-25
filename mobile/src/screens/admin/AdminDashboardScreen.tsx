import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  adminScreenScroll,
  CardBox,
  ErrorText,
  FeatureBar,
  LoadingBlock,
  MetricCard,
  NavButton,
  SectionLabel,
} from "../../components/admin/AdminShared";
import { adminApi } from "../../api/adminApi";
import { useAdminStore } from "../../store/adminStore";
import type { AdminStackParamList } from "../../navigation/AdminNavigator";
import { AdminGrowthChart } from "./AdminCharts";
import { FEATURE_COLOR_MAP, FEATURE_LABEL_MAP, buildFeatureCostEntries } from "./adminFeatureUtils";
import { COLORS } from "./adminTheme";

type Overview = {
  total_users: number;
  free_users: number;
  pro_users: number;
  elite_users: number;
  total_revenue_inr: number;
  mrr_inr: number;
  ai_cost_month_inr: number;
  new_users_today: number;
  dau: number;
  mau: number;
};

export default function AdminDashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const adminName = useAdminStore((s) => s.adminName);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [growthData, setGrowthData] = useState<Array<{ date: string; new_users: number }>>([]);
  const [aiSummary, setAiSummary] = useState<{ by_feature?: Array<{ feature: string; cost_inr: number }> } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, gr, ai] = await Promise.all([
        adminApi.overview(),
        adminApi.userGrowth(30),
        adminApi.aiSummary(30),
      ]);
      setOverview(ov);
      setGrowthData(gr);
      setAiSummary(ai);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const featureEntries = useMemo(
    () => buildFeatureCostEntries(aiSummary?.by_feature ?? []),
    [aiSummary]
  );
  const maxCost = featureEntries[0]?.[1] ?? 1;

  return (
    <ScrollView style={adminScreenScroll.style} contentContainerStyle={adminScreenScroll.contentContainerStyle}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Hi, {adminName ?? "Admin"}</Text>
          <Text style={styles.headerSub}>
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            useAdminStore.getState().logout();
          }}
          style={styles.logoutBtn}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorText message={error} /> : null}

      {overview ? (
        <>
          <View style={styles.metricRow}>
            <MetricCard
              label="Total users"
              value={String(overview.total_users ?? "—")}
              sub={`+${overview.new_users_today ?? 0} today`}
              accentColor={COLORS.teal}
            />
            <MetricCard
              label="Paid users"
              value={String((overview.pro_users ?? 0) + (overview.elite_users ?? 0))}
              sub={`${overview.total_users ? (((overview.pro_users + overview.elite_users) / overview.total_users) * 100).toFixed(0) : 0}% conversion`}
              accentColor={COLORS.purple}
            />
          </View>
          <View style={styles.metricRow}>
            <MetricCard
              label="MRR"
              value={`₹${Math.round(overview.mrr_inr ?? 0).toLocaleString("en-IN")}`}
              sub="Monthly recurring"
              accentColor={COLORS.blue}
            />
            <MetricCard
              label="AI cost (month)"
              value={`₹${(overview.ai_cost_month_inr ?? 0).toFixed(2)}`}
              sub="This month"
              accentColor={COLORS.amber}
            />
          </View>
          <View style={styles.metricRow}>
            <MetricCard
              label="Free users"
              value={String(overview.free_users ?? "—")}
              sub={`${overview.total_users ? ((overview.free_users / overview.total_users) * 100).toFixed(0) : 0}% of base`}
            />
            <MetricCard
              label="DAU / MAU"
              value={`${overview.dau ?? 0} / ${overview.mau ?? 0}`}
              sub={`${overview.mau ? ((overview.dau / overview.mau) * 100).toFixed(0) : 0}% stickiness`}
            />
          </View>
          <View style={[styles.metricRow, { marginBottom: 20 }]}>
            <MetricCard label="New today" value={String(overview.new_users_today ?? 0)} />
            <MetricCard
              label="Total revenue"
              value={`₹${Math.round(overview.total_revenue_inr ?? 0).toLocaleString("en-IN")}`}
            />
          </View>

          <CardBox>
            <Text style={styles.cardTitle}>User growth (30d)</Text>
            <AdminGrowthChart growthData={growthData} />
          </CardBox>

          <CardBox>
            <Text style={styles.cardTitle}>AI cost by feature (30d)</Text>
            {featureEntries.length > 0 ? (
              featureEntries.map(([feature, cost]) => (
                <FeatureBar
                  key={feature}
                  name={FEATURE_LABEL_MAP[feature] ?? feature}
                  value={cost}
                  maxValue={maxCost}
                  color={FEATURE_COLOR_MAP[feature] ?? "#888"}
                />
              ))
            ) : (
              <Text style={styles.emptyHint}>No AI usage this period</Text>
            )}
          </CardBox>

          <SectionLabel>Quick links</SectionLabel>
          <NavButton
            label="View all users"
            iconColor={COLORS.blue}
            onPress={() => navigation.navigate("AdminUsers")}
          />
          <NavButton
            label="AI usage detail"
            iconColor={COLORS.purple}
            onPress={() => navigation.navigate("AdminAiUsage")}
          />
          <NavButton
            label="Subscriptions"
            iconColor={COLORS.teal}
            onPress={() => navigation.navigate("AdminSubscriptions")}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 16,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: { color: "#ffffff", fontSize: 22, fontWeight: "500" },
  headerSub: { color: COLORS.textHint, fontSize: 12, marginTop: 2 },
  logoutBtn: {
    backgroundColor: "rgba(226,75,74,0.12)",
    borderWidth: 0.5,
    borderColor: "rgba(226,75,74,0.3)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  logoutText: { color: "#f07676", fontSize: 13, fontWeight: "500" },
  metricRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  cardTitle: { color: COLORS.textSub, fontSize: 13, fontWeight: "500", marginBottom: 4 },
  emptyHint: { color: COLORS.textHint, fontSize: 12, textAlign: "center", paddingVertical: 12 },
});
