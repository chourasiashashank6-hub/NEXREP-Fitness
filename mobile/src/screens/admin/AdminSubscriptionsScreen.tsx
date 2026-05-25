import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
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
      setError(e instanceof Error ? e.message : "Failed to load subscriptions");
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
        <AlertBanner text="Razorpay integration pending — activate when bank account is ready" type="warning" />

        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorText message={error} /> : null}

        <View style={styles.metricRow}>
          <MetricCard
            label="Active Pro"
            value={String(sumCount("pro", "active"))}
            sub="₹999/mo each"
            accentColor={COLORS.teal}
          />
          <MetricCard
            label="Active Elite"
            value={String(sumCount("elite", "active"))}
            sub="₹1,999/mo each"
            accentColor={COLORS.purple}
          />
        </View>
        <View style={[styles.metricRow, { marginBottom: 20 }]}>
          <MetricCard
            label="Trial"
            value={String(sumCount(undefined, "trial"))}
            sub="7-day trial"
            accentColor={COLORS.amber}
          />
          <MetricCard
            label="Cancelled"
            value={String(sumCount(undefined, "cancelled"))}
            accentColor={COLORS.coral}
          />
        </View>

        <SectionLabel>Plan distribution</SectionLabel>
        <CardBox>
          {[
            { label: "Free", color: "#3d4450", count: freeCount },
            { label: "Pro", color: COLORS.teal, count: proCount },
            { label: "Elite", color: COLORS.purple, count: eliteCount },
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

        <SectionLabel>Revenue by month</SectionLabel>
        <CardBox>
          <AdminRevenueChart revenueData={revenueData} />
        </CardBox>

        <Text style={styles.filterLabel}>Plan</Text>
        <View style={styles.chips}>
          {["All", "Free", "Pro", "Elite"].map((p) => (
            <FilterChip
              key={p}
              label={p}
              active={planFilter === (p === "All" ? null : p.toLowerCase())}
              onPress={() => setPlanFilter(p === "All" ? null : p.toLowerCase())}
            />
          ))}
        </View>

        <Text style={styles.filterLabel}>Status</Text>
        <View style={[styles.chips, { marginBottom: 16 }]}>
          {["All", "Active", "Trial", "Cancelled", "Expired"].map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={statusFilter === (s === "All" ? null : s.toLowerCase())}
              onPress={() => setStatusFilter(s === "All" ? null : s.toLowerCase())}
            />
          ))}
        </View>
      </View>
    ),
    [loading, error, summary, revenueData, planFilter, statusFilter, freeCount, proCount, eliteCount, totalUsers]
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
              {item.plan_id} · {item.billing_cycle} · {item.status}
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
