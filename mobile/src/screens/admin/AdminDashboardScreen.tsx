import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      setError(e instanceof Error ? e.message : t("admin.dashboard.loadFailed"));
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
          <Text style={styles.headerTitle}>{t("admin.dashboard.greeting", { name: adminName ?? t("admin.dashboard.fallbackName") })}</Text>
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
          <Text style={styles.logoutText}>{t("admin.dashboard.logout")}</Text>
        </TouchableOpacity>
      </View>

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorText message={error} /> : null}

      {overview ? (
        <>
          <View style={styles.metricRow}>
            <MetricCard
              label={t("admin.dashboard.totalUsers")}
              value={String(overview.total_users ?? "—")}
              sub={t("admin.dashboard.newTodaySub", { count: overview.new_users_today ?? 0 })}
              accentColor={COLORS.teal}
            />
            <MetricCard
              label={t("admin.dashboard.paidUsers")}
              value={String((overview.pro_users ?? 0) + (overview.elite_users ?? 0))}
              sub={t("admin.dashboard.conversionSub", { percent: overview.total_users ? (((overview.pro_users + overview.elite_users) / overview.total_users) * 100).toFixed(0) : 0 })}
              accentColor={COLORS.purple}
            />
          </View>
          <View style={styles.metricRow}>
            <MetricCard
              label={t("admin.dashboard.mrr")}
              value={`₹${Math.round(overview.mrr_inr ?? 0).toLocaleString("en-IN")}`}
              sub={t("admin.dashboard.monthlyRecurring")}
              accentColor={COLORS.blue}
            />
            <MetricCard
              label={t("admin.dashboard.aiCostMonth")}
              value={`₹${(overview.ai_cost_month_inr ?? 0).toFixed(2)}`}
              sub={t("admin.dashboard.thisMonth")}
              accentColor={COLORS.amber}
            />
          </View>
          <View style={styles.metricRow}>
            <MetricCard
              label={t("admin.dashboard.freeUsers")}
              value={String(overview.free_users ?? "—")}
              sub={t("admin.dashboard.ofBaseSub", { percent: overview.total_users ? ((overview.free_users / overview.total_users) * 100).toFixed(0) : 0 })}
            />
            <MetricCard
              label={t("admin.dashboard.dauMau")}
              value={`${overview.dau ?? 0} / ${overview.mau ?? 0}`}
              sub={t("admin.dashboard.stickinessSub", { percent: overview.mau ? ((overview.dau / overview.mau) * 100).toFixed(0) : 0 })}
            />
          </View>
          <View style={[styles.metricRow, { marginBottom: 20 }]}>
            <MetricCard label={t("admin.dashboard.newToday")} value={String(overview.new_users_today ?? 0)} />
            <MetricCard
              label={t("admin.dashboard.totalRevenue")}
              value={`₹${Math.round(overview.total_revenue_inr ?? 0).toLocaleString("en-IN")}`}
            />
          </View>

          <CardBox>
            <Text style={styles.cardTitle}>{t("admin.dashboard.userGrowth")}</Text>
            <AdminGrowthChart growthData={growthData} />
          </CardBox>

          <CardBox>
            <Text style={styles.cardTitle}>{t("admin.dashboard.aiCostByFeature")}</Text>
            {featureEntries.length > 0 ? (
              featureEntries.map(([feature, cost]) => (
                <FeatureBar
                  key={feature}
                  name={t(FEATURE_LABEL_MAP[feature] ?? feature, { defaultValue: feature })}
                  value={cost}
                  maxValue={maxCost}
                  color={FEATURE_COLOR_MAP[feature] ?? "#888"}
                />
              ))
            ) : (
              <Text style={styles.emptyHint}>{t("admin.dashboard.noAiUsage")}</Text>
            )}
          </CardBox>

          <SectionLabel>{t("admin.dashboard.quickLinks")}</SectionLabel>
          <NavButton
            label={t("admin.dashboard.viewAllUsers")}
            iconColor={COLORS.blue}
            onPress={() => navigation.navigate("AdminUsers")}
          />
          <NavButton
            label={t("admin.dashboard.aiUsageDetail")}
            iconColor={COLORS.purple}
            onPress={() => navigation.navigate("AdminAiUsage")}
          />
          <NavButton
            label={t("admin.dashboard.subscriptions")}
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
