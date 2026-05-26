import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { HeroHeader } from "../components/HeroHeader";
import { ScreenContainer } from "../components/ScreenContainer";
import { useAppTheme } from "../theme";
import { exportInvoicesApi } from "../api/subscriptions";
import { PLANS } from "../constants/plans";
import type { ProfileStackParamList } from "../navigation/types";
import { useSubscriptionStore } from "../store/subscriptionStore";
import { daysUntil, formatDate } from "../utils/dateFormat";

export function ManageSubscriptionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<RouteProp<ProfileStackParamList, "ManageSubscription">>();
  const { colors } = useAppTheme();
  const userId = route.params.userId;
  const subscription = useSubscriptionStore((s) => s.subscription);
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const cancelPlan = useSubscriptionStore((s) => s.cancelPlan);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (userId) void fetchSubscription(userId);
  }, [userId, fetchSubscription]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("ProfileMain");
  }, [navigation]);

  const handleCancel = useCallback(() => {
    if (!subscription) return;
    const accessEnd = formatDate(subscription.currentPeriodEnd);
    Alert.alert(
      `Cancel ${subscription.tier} Plan?`,
      `You'll keep access until ${accessEnd}. After that, your account reverts to FREE.`,
      [
        { text: "Keep my plan", style: "cancel" },
        {
          text: "Cancel plan",
          style: "destructive",
          onPress: async () => {
            const msg = await cancelPlan(userId, subscription.id);
            if (msg) {
              Alert.alert("Plan cancelled", `Access continues until ${accessEnd}.`);
              navigation.goBack();
            } else {
              Alert.alert("Error", "Failed to cancel. Please try again.");
            }
          },
        },
      ],
    );
  }, [subscription, userId, cancelPlan, navigation]);

  const handleDownloadInvoices = async () => {
    setDownloading(true);
    try {
      const { invoices } = await exportInvoicesApi(userId);
      if (!invoices.length) {
        Alert.alert("No invoices", "No payment receipts found yet.");
        return;
      }
      for (const inv of invoices) {
        if (inv.url) await Linking.openURL(inv.url);
      }
      Alert.alert("Invoices", `Opened ${invoices.length} receipt(s) in your browser.`);
    } catch {
      Alert.alert("Error", "Could not load invoices.");
    } finally {
      setDownloading(false);
    }
  };

  if (!subscription || subscription.tier === "FREE") {
    return (
      <ScreenContainer>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={[styles.backBtnText, { color: colors.text }]}>Back</Text>
        </Pressable>
        <HeroHeader title="Manage subscription" subtitle="No active paid plan" />
        <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate("Subscription")}>
          <Text style={styles.primaryBtnText}>View plans</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  const proPlan = PLANS.find((p) => p.id === "pro");
  const elitePlan = PLANS.find((p) => p.id === "elite");
  const isYearly = subscription.billingCycle === "yearly";

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={[styles.backBtnText, { color: colors.text }]}>Back</Text>
        </Pressable>
        <HeroHeader title="Manage subscription" subtitle={`${subscription.tier} · ${subscription.status}`} />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current plan</Text>
          <DetailRow label="Tier" value={`${subscription.tier}`} />
          <DetailRow
            label="Price"
            value={`₹${subscription.priceINR.toLocaleString("en-IN")}/${isYearly ? "year" : "month"}`}
          />
          <DetailRow label="Billing" value={subscription.billingCycle} />
          <DetailRow
            label="Next billing"
            value={`${formatDate(subscription.currentPeriodEnd)} (${daysUntil(subscription.currentPeriodEnd)} days)`}
          />
          {subscription.razorpaySubscriptionId ? (
            <DetailRow label="Razorpay sub ID" value={subscription.razorpaySubscriptionId} mono />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Billing cycle</Text>
          <Text style={styles.cardSub}>Switch plan on the pricing screen to change billing.</Text>
          <View style={styles.compareRow}>
            <CycleCompare
              label="Monthly"
              proPrice={proPlan?.monthlyPrice ?? 999}
              elitePrice={elitePlan?.monthlyPrice ?? 1999}
              active={!isYearly}
            />
            <CycleCompare
              label="Yearly"
              proPrice={(proPlan?.yearlyPrice ?? 832) * 12}
              elitePrice={(elitePlan?.yearlyPrice ?? 1665) * 12}
              active={isYearly}
            />
          </View>
          <Pressable style={styles.outlineBtn} onPress={() => navigation.navigate("Subscription")}>
            <Text style={styles.outlineBtnText}>Change plan or billing</Text>
          </Pressable>
        </View>

        <Pressable style={styles.outlineBtn} onPress={() => void handleDownloadInvoices()} disabled={downloading}>
          {downloading ? (
            <ActivityIndicator color="#2ECC9A" />
          ) : (
            <Text style={styles.outlineBtnText}>Download all invoices</Text>
          )}
        </Pressable>

        {subscription.status === "active" ? (
          <Pressable style={styles.cancelBtn} onPress={handleCancel}>
            <Text style={styles.cancelBtnText}>Cancel subscription</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.mono]} numberOfLines={mono ? 1 : undefined}>
        {value}
      </Text>
    </View>
  );
}

function CycleCompare({
  label,
  proPrice,
  elitePrice,
  active,
}: {
  label: string;
  proPrice: number;
  elitePrice: number;
  active: boolean;
}) {
  return (
    <View style={[styles.cycleBox, active && styles.cycleBoxActive]}>
      <Text style={[styles.cycleLabel, active && styles.cycleLabelActive]}>{label}</Text>
      <Text style={styles.cyclePrice}>PRO ₹{proPrice.toLocaleString("en-IN")}</Text>
      <Text style={styles.cyclePrice}>ELITE ₹{elitePrice.toLocaleString("en-IN")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    marginBottom: 12,
    paddingVertical: 6,
    paddingRight: 8,
  },
  backBtnPressed: { opacity: 0.65 },
  backBtnText: { fontSize: 16, fontWeight: "600" },
  card: {
    backgroundColor: "#111c17",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 10 },
  cardSub: { color: "rgba(226,232,228,0.45)", fontSize: 12, marginBottom: 12 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8, gap: 12 },
  detailLabel: { color: "rgba(226,232,228,0.45)", fontSize: 12 },
  detailValue: { color: "#e2e8e4", fontSize: 12, fontWeight: "600", flex: 1, textAlign: "right" },
  mono: { fontSize: 10 },
  compareRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  cycleBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 10,
  },
  cycleBoxActive: { borderColor: "rgba(46,204,154,0.5)", backgroundColor: "rgba(46,204,154,0.08)" },
  cycleLabel: { color: "rgba(226,232,228,0.5)", fontSize: 12, fontWeight: "600", marginBottom: 4 },
  cycleLabelActive: { color: "#2ECC9A" },
  cyclePrice: { color: "rgba(226,232,228,0.7)", fontSize: 11 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: "rgba(46,204,154,0.35)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  outlineBtnText: { color: "#2ECC9A", fontSize: 13, fontWeight: "600" },
  primaryBtn: {
    backgroundColor: "#2ECC9A",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  primaryBtnText: { color: "#0d1117", fontSize: 14, fontWeight: "700" },
  cancelBtn: {
    borderWidth: 1,
    borderColor: "rgba(226,75,74,0.4)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: { color: "#e24b4a", fontSize: 13, fontWeight: "600" },
});
