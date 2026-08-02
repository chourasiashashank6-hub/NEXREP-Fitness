import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  adminScreenScroll,
  AlertBanner,
  CardBox,
  ErrorText,
  FilterChip,
  LoadingBlock,
  MetricCard,
  SectionLabel,
} from "../../components/admin/AdminShared";
import { adminApi } from "../../api/adminApi";
import { AdminRevenueChart } from "./AdminCharts";
import { COLORS } from "./adminTheme";

export default function AdminSubscriptionsScreen() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<any[]>([]);
  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r, h] = await Promise.all([
        adminApi.subscriptionSummary(),
        adminApi.revenueMonthly(12),
        adminApi.subscriptionHistory({
          plan_id: planFilter || undefined,
          status: statusFilter || undefined,
          limit: 50,
        }),
      ]);
      setSummary(s);
      setRevenueData(r);
      setItems(h.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.subscriptions.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [planFilter, statusFilter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    void load();
  }, [load]);

  const sumCount = (planId?: string, status?: string) =>
    summary
      .filter((r) => (planId ? r.plan_id === planId : true) && (status ? r.status === status : true))
      .reduce((a: number, r: { count: number }) => a + (r.count ?? 0), 0);

  const freeCount = sumCount("free");
  const proCount = sumCount("pro");
  const eliteCount = sumCount("elite");
  const totalUsers = freeCount + proCount + eliteCount;

  const listHeader = useMemo(
    () => (
      <View>
        <AlertBanner text={t("admin.subscriptions.razorpayPending")} type="warning" />

        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorText message={error} /> : null}

        <View style={styles.metricRow}>
          <MetricCard
            label={t("admin.subscriptions.activePro")}
            value={String(sumCount("pro", "active"))}
            sub={t("admin.subscriptions.proPriceEach")}
            accentColor={COLORS.teal}
          />
          <MetricCard
            label={t("admin.subscriptions.activeElite")}
            value={String(sumCount("elite", "active"))}
            sub={t("admin.subscriptions.elitePriceEach")}
            accentColor={COLORS.purple}
          />
        </View>
        <View style={[styles.metricRow, { marginBottom: 20 }]}>
          <MetricCard
            label={t("admin.subscriptions.trial")}
            value={String(sumCount(undefined, "trial"))}
            sub={t("admin.subscriptions.trialSub")}
            accentColor={COLORS.amber}
          />
          <MetricCard
            label={t("admin.subscriptions.cancelled")}
            value={String(sumCount(undefined, "cancelled"))}
            accentColor={COLORS.coral}
          />
        </View>

        <SectionLabel>{t("admin.subscriptions.planDistribution")}</SectionLabel>
        <CardBox>
          {[
            { label: t("admin.common.free"), color: "#3d4450", count: freeCount },
            { label: t("admin.common.pro"), color: COLORS.teal, count: proCount },
            { label: t("admin.common.elite"), color: COLORS.purple, count: eliteCount },
          ].map(({ label, color, count }) => (
            <View key={label} style={styles.distRow}>
              <Text style={styles.distLabel}>{label}</Text>
              <View style={styles.distTrack}>
                <View
                  style={{
                    height: 8,
                    borderRadius: 20,
                    backgroundColor: color,
                    width: `${totalUsers > 0 ? (count / totalUsers) * 100 : 0}%`,
                  }}
                />
              </View>
              <Text style={styles.distCount}>{count}</Text>
            </View>
          ))}
        </CardBox>

        <SectionLabel>{t("admin.subscriptions.revenueByMonth")}</SectionLabel>
        <CardBox>
          <AdminRevenueChart revenueData={revenueData} />
        </CardBox>

        <Text style={styles.filterLabel}>{t("admin.subscriptions.plan")}</Text>
        <View style={styles.chips}>
          {[
            { label: t("admin.common.all"), value: null },
            { label: t("admin.common.free"), value: "free" },
            { label: t("admin.common.pro"), value: "pro" },
            { label: t("admin.common.elite"), value: "elite" },
          ].map((p) => (
            <FilterChip
              key={p.label}
              label={p.label}
              active={planFilter === p.value}
              onPress={() => setPlanFilter(p.value)}
            />
          ))}
        </View>

        <Text style={styles.filterLabel}>{t("admin.subscriptions.status")}</Text>
        <View style={[styles.chips, { marginBottom: 16 }]}>
          {[
            { label: t("admin.common.all"), value: null },
            { label: t("admin.common.active"), value: "active" },
            { label: t("admin.common.trial"), value: "trial" },
            { label: t("admin.common.cancelled"), value: "cancelled" },
            { label: t("admin.common.expired"), value: "expired" },
          ].map((s) => (
            <FilterChip
              key={s.label}
              label={s.label}
              active={statusFilter === s.value}
              onPress={() => setStatusFilter(s.value)}
            />
          ))}
        </View>
      </View>
    ),
    [loading, error, summary, revenueData, planFilter, statusFilter, freeCount, proCount, eliteCount, totalUsers, t]
  );

  return (
    <View style={styles.root}>
      <FlatList
        style={adminScreenScroll.style}
        contentContainerStyle={adminScreenScroll.contentContainerStyle}
        data={items}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <View style={styles.rowCard}>
            <Text style={styles.rowTitle}>{item.user_email}</Text>
            <Text style={styles.rowMeta}>
              {t("admin.subscriptions.rowMeta", { plan: item.plan_id, billingCycle: item.billing_cycle, status: item.status })}
            </Text>
            <Text style={styles.rowMeta}>
              ₹{Math.round(item.price_inr ?? 0).toLocaleString("en-IN")} ·{" "}
              {item.started_at
                ? new Date(item.started_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
              {item.expires_at
                ? ` → ${new Date(item.expires_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}`
                : ""}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  metricRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  distLabel: { color: COLORS.textMuted, fontSize: 11, width: 36 },
  distTrack: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 20,
    height: 8,
    overflow: "hidden",
  },
  distCount: { color: COLORS.textSub, fontSize: 11, fontWeight: "500", width: 16, textAlign: "right" },
  filterLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 8, marginBottom: 6 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 8 },
  rowCard: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    padding: 10,
    marginBottom: 8,
  },
  rowTitle: { color: COLORS.text, fontSize: 13, fontWeight: "600" },
  rowMeta: { color: COLORS.textHint, fontSize: 11, marginTop: 4 },
});
