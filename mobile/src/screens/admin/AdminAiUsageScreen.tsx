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
  SectionLabel,
  UserAvatar,
} from "../../components/admin/AdminShared";
import { adminApi } from "../../api/adminApi";
import type { AdminStackParamList } from "../../navigation/AdminNavigator";
import { AdminDailyTokensChart } from "./AdminCharts";
import { FEATURE_COLOR_MAP, FEATURE_LABEL_MAP, buildFeatureCostEntries } from "./adminFeatureUtils";
import { COLORS } from "./adminTheme";

export default function AdminAiUsageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [dailyData, setDailyData] = useState<any[]>([]);
  const [topUsers, setTopUsers] = useState<any[]>([]);
  const [costAlerts, setCostAlerts] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d, t, a] = await Promise.all([
        adminApi.aiSummary(period),
        adminApi.aiDaily(period),
        adminApi.aiTopUsers(period, 20),
        adminApi.costAlerts(500, 7),
      ]);
      setSummary(s);
      setDailyData(d);
      setTopUsers(t);
      setCostAlerts(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI usage");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const featureEntries = useMemo(
    () => buildFeatureCostEntries(summary?.by_feature ?? []),
    [summary]
  );
  const maxCost = featureEntries[0]?.[1] ?? 1;

  const totalCalls = useMemo(
    () =>
      (summary?.by_feature ?? []).reduce((acc: number, f: { calls: number }) => acc + (f.calls ?? 0), 0),
    [summary]
  );

  const fallbackCalls = useMemo(
    () =>
      (summary?.by_feature ?? []).reduce(
        (acc: number, f: { fallback_calls: number }) => acc + (f.fallback_calls ?? 0),
        0
      ),
    [summary]
  );

  return (
    <ScrollView style={adminScreenScroll.style} contentContainerStyle={adminScreenScroll.contentContainerStyle}>
      <View style={styles.periodRow}>
        {[7, 30, 90].map((d) => (
          <TouchableOpacity
            key={d}
            onPress={() => setPeriod(d)}
            style={[
              styles.periodChip,
              period === d && styles.periodChipActive,
            ]}
          >
            <Text style={[styles.periodText, period === d && styles.periodTextActive]}>{d}d</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorText message={error} /> : null}

      {summary ? (
        <>
          <View style={styles.metricRow}>
            <MetricCard
              label="Total tokens"
              value={(summary.total_tokens ?? 0).toLocaleString("en-IN")}
              accentColor={COLORS.purple}
            />
            <MetricCard
              label="Total cost"
              value={`₹${(summary.total_cost_inr ?? 0).toFixed(2)}`}
              accentColor={COLORS.amber}
            />
          </View>
          <View style={[styles.metricRow, { marginBottom: 20 }]}>
            <MetricCard label="Total calls" value={String(totalCalls)} accentColor={COLORS.teal} />
            <MetricCard
              label="Fallback calls"
              value={String(fallbackCalls)}
              sub={`${summary?.by_feature ? ((fallbackCalls / Math.max(totalCalls, 1)) * 100).toFixed(0) : 0}% rate`}
              accentColor={COLORS.coral}
            />
          </View>

          <SectionLabel>Cost by feature</SectionLabel>
          <CardBox>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.teal }]} />
                <Text style={styles.legendText}>Groq</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.blue }]} />
                <Text style={styles.legendText}>Gemini</Text>
              </View>
            </View>
            {featureEntries.map(([feature, cost]) => (
              <FeatureBar
                key={feature}
                name={FEATURE_LABEL_MAP[feature] ?? feature}
                value={cost}
                maxValue={maxCost}
                color={FEATURE_COLOR_MAP[feature] ?? "#888"}
              />
            ))}
          </CardBox>

          <SectionLabel>Daily tokens</SectionLabel>
          <CardBox>
            <AdminDailyTokensChart dailyData={dailyData} />
          </CardBox>

          <SectionLabel>Top users by cost</SectionLabel>
          {topUsers.map((u) => (
            <TouchableOpacity
              key={u.user_id}
              onPress={() => navigation.navigate("AdminUserDetail", { userId: u.user_id })}
              style={styles.userRow}
              activeOpacity={0.7}
            >
              <UserAvatar name={u.name ?? u.email} size={32} />
              <View style={styles.userBody}>
                <Text style={styles.userEmail}>{u.email}</Text>
                <Text style={styles.userMeta}>
                  {u.plan_id} · {(u.total_tokens ?? 0).toLocaleString("en-IN")} tokens · {u.calls} calls
                </Text>
              </View>
              <Text style={styles.userCost}>₹{(u.cost_inr ?? 0).toFixed(2)}</Text>
            </TouchableOpacity>
          ))}

          <SectionLabel>Cost alerts (7d, &gt;₹500)</SectionLabel>
          {costAlerts.length > 0 ? (
            costAlerts.map((a) => (
              <View key={a.user_id} style={styles.alertRow}>
                <Text style={styles.alertEmail}>{a.email}</Text>
                <Text style={styles.alertMeta}>
                  {a.plan_id} · ₹{(a.cost_inr ?? 0).toFixed(2)} · {(a.tokens ?? 0).toLocaleString("en-IN")}{" "}
                  tokens
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.alertOk}>
              <Text style={{ color: COLORS.teal, fontSize: 16 }}>✓</Text>
              <Text style={styles.alertOkText}>No high-usage alerts — all users within budget</Text>
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  periodRow: { flexDirection: "row", gap: 6, marginBottom: 16 },
  periodChip: {
    borderWidth: 0.5,
    borderColor: COLORS.borderMid,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 18,
  },
  periodChipActive: { backgroundColor: COLORS.teal, borderColor: COLORS.teal },
  periodText: { color: COLORS.textMuted, fontSize: 12 },
  periodTextActive: { color: "#ffffff", fontSize: 12 },
  metricRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  legendRow: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginBottom: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { color: COLORS.textMuted, fontSize: 11 },
  userRow: {
    backgroundColor: COLORS.cardAlt,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  userBody: { flex: 1, marginLeft: 10 },
  userEmail: { color: COLORS.text, fontSize: 13, fontWeight: "500" },
  userMeta: { color: COLORS.textHint, fontSize: 11, marginTop: 2 },
  userCost: { color: COLORS.tealLight, fontSize: 14, fontWeight: "500" },
  alertRow: {
    backgroundColor: "rgba(239,159,39,0.08)",
    borderWidth: 0.5,
    borderColor: "rgba(239,159,39,0.25)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  alertEmail: { color: "#f0c060", fontSize: 13, fontWeight: "500" },
  alertMeta: { color: "#c8aa6e", fontSize: 11, marginTop: 2 },
  alertOk: {
    backgroundColor: "rgba(29,158,117,0.08)",
    borderWidth: 0.5,
    borderColor: "rgba(29,158,117,0.2)",
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  alertOkText: { color: COLORS.tealLight, fontSize: 13 },
});
