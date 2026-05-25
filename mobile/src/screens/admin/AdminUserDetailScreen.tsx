import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  adminScreenScroll,
  CardBox,
  ErrorText,
  FeatureBar,
  LoadingBlock,
  MetricCard,
  SectionLabel,
  StatRow,
  UserAvatar,
} from "../../components/admin/AdminShared";
import { adminApi } from "../../api/adminApi";
import type { AdminStackParamList } from "../../navigation/AdminNavigator";
import {
  FEATURE_COLOR_MAP,
  FEATURE_LABEL_MAP,
  buildFeatureCostFromHistory,
} from "./adminFeatureUtils";
import { COLORS } from "./adminTheme";

export default function AdminUserDetailScreen() {
  const route = useRoute<RouteProp<AdminStackParamList, "AdminUserDetail">>();
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const userId = route.params.userId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [userHistory, setUserHistory] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, ai] = await Promise.all([adminApi.userDetail(userId), adminApi.aiUserHistory(userId, 30)]);
      setDetail(d);
      setUserHistory(ai);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (!detail?.user) return;
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitleWrap}>
          <UserAvatar name={detail.user.name ?? detail.user.email} size={34} />
          <View>
            <Text style={styles.headerName}>{detail.user.name}</Text>
            <Text style={styles.headerEmail}>{detail.user.email}</Text>
          </View>
        </View>
      ),
    });
  }, [detail, navigation]);

  const featureEntries = useMemo(
    () => buildFeatureCostFromHistory(userHistory?.history ?? []),
    [userHistory]
  );
  const maxCost = featureEntries[0]?.[1] ?? 1;

  if (!detail?.user && !loading) {
    return null;
  }

  return (
    <ScrollView style={adminScreenScroll.style} contentContainerStyle={adminScreenScroll.contentContainerStyle}>
      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorText message={error} /> : null}

      {detail?.user ? (
        <>
          <SectionLabel>Profile</SectionLabel>
          <CardBox>
            <StatRow
              label="Plan"
              value={detail.user.plan_id?.toUpperCase() ?? "FREE"}
              valueColor={COLORS.tealLight}
            />
            <StatRow
              label="Joined"
              value={
                detail.user.created_at
                  ? new Date(detail.user.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"
              }
            />
            <StatRow
              label="Last active"
              value={
                detail.user.last_active_at
                  ? new Date(detail.user.last_active_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"
              }
              valueColor={detail.user.last_active_at ? COLORS.tealLight : COLORS.textHint}
            />
            <StatRow
              label="Age · Weight"
              value={`${detail.user.age ?? "—"} · ${detail.user.weight ?? "—"} kg`}
            />
            <View style={styles.statRowLast}>
              <StatRow label="Goal" value={detail.user.goal_tag ?? "—"} />
            </View>
          </CardBox>

          <SectionLabel>AI usage (all time)</SectionLabel>
          <View style={styles.metricRow}>
            <MetricCard
              label="Total tokens"
              value={(detail.ai_usage_total?.total_tokens ?? 0).toLocaleString("en-IN")}
              accentColor={COLORS.purple}
            />
            <MetricCard
              label="Total cost"
              value={`₹${(detail.ai_usage_total?.total_cost_inr ?? 0).toFixed(2)}`}
              sub={`${userHistory?.history?.length ?? 0} log entries`}
              accentColor={COLORS.amber}
            />
          </View>

          <SectionLabel>Usage by feature (30d)</SectionLabel>
          <CardBox>
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
              <Text style={styles.emptyHint}>No AI usage recorded yet</Text>
            )}
          </CardBox>

          <SectionLabel>Subscription history</SectionLabel>
          {(detail.subscriptions ?? []).length === 0 ? (
            <Text style={styles.emptyHint}>No subscriptions yet</Text>
          ) : (
            (detail.subscriptions ?? []).map((s: any, i: number) => (
              <View key={i} style={styles.subCard}>
                <View>
                  <Text style={styles.subTitle}>
                    {s.plan_id?.toUpperCase()} · {s.billing_cycle}
                  </Text>
                  <Text style={styles.subMeta}>
                    {s.status} ·{" "}
                    {s.started_at
                      ? new Date(s.started_at).toLocaleDateString("en-IN")
                      : "—"}
                  </Text>
                </View>
                <Text style={styles.subPrice}>
                  ₹{Math.round(s.price_inr ?? 0).toLocaleString("en-IN")}
                </Text>
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerTitleWrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerName: { color: "#ffffff", fontSize: 16, fontWeight: "500" },
  headerEmail: { color: COLORS.textHint, fontSize: 11 },
  metricRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  statRowLast: { borderBottomWidth: 0 },
  emptyHint: { color: COLORS.textHint, fontSize: 12, textAlign: "center", paddingVertical: 12 },
  subCard: {
    backgroundColor: COLORS.cardAlt,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subTitle: { color: COLORS.text, fontSize: 13, fontWeight: "500" },
  subMeta: { color: COLORS.textHint, fontSize: 11, marginTop: 2 },
  subPrice: { color: COLORS.tealLight, fontSize: 15, fontWeight: "500" },
});
