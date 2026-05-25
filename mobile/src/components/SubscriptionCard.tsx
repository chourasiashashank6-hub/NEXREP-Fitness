import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSubscriptionStore } from "../store/subscriptionStore";
import type { PlanStatus, Subscription } from "../types/subscription";
import { daysUntil, formatDate } from "../utils/dateFormat";
import type { ProfileStackParamList } from "../navigation/types";

const STATUS_COLORS: Record<PlanStatus, string> = {
  active: "#2ECC9A",
  trial: "#FFC107",
  cancelled: "rgba(226,232,228,0.4)",
  past_due: "#e24b4a",
  expired: "rgba(226,232,228,0.4)",
};

const STATUS_LABELS: Record<PlanStatus, string> = {
  active: "Active",
  trial: "Trial",
  cancelled: "Cancelled",
  past_due: "Payment failed",
  expired: "Expired",
};

function StatusBadge({ status }: { status: PlanStatus }) {
  return (
    <View style={[styles.badge, { borderColor: STATUS_COLORS[status] }]}>
      <Text style={[styles.badgeText, { color: STATUS_COLORS[status] }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

function FreeUserBanner({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <View style={styles.subCard}>
      <View style={styles.subCardTop}>
        <View>
          <Text style={styles.subTier}>FREE Plan</Text>
          <Text style={styles.subBilling}>Basic features · No billing</Text>
        </View>
      </View>
      <Pressable style={styles.upgradeBtn} onPress={onUpgrade}>
        <Text style={styles.upgradeBtnText}>Upgrade to PRO</Text>
      </Pressable>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  accent,
  warning,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.actionBtn,
        accent && styles.actionBtnAccent,
        warning && styles.actionBtnWarning,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.actionBtnText, warning && styles.actionBtnTextWarning]}>{label}</Text>
    </Pressable>
  );
}

function CancelButton({
  subscription,
  userId,
}: {
  subscription: Subscription;
  userId: string;
}) {
  const cancelPlan = useSubscriptionStore((s) => s.cancelPlan);
  const accessEnd = formatDate(subscription.currentPeriodEnd);

  const handleCancel = () => {
    Alert.alert(
      `Cancel ${subscription.tier} Plan?`,
      `You'll keep ${subscription.tier} access until ${accessEnd}. After that, your account reverts to FREE.`,
      [
        { text: "Keep my plan", style: "cancel" },
        {
          text: "Cancel plan",
          style: "destructive",
          onPress: async () => {
            const msg = await cancelPlan(userId, subscription.id);
            if (msg) {
              Alert.alert("Plan cancelled", `Access continues until ${accessEnd}.`);
            } else {
              Alert.alert("Error", "Failed to cancel. Please try again or contact support.");
            }
          },
        },
      ],
    );
  };

  return <ActionButton label="Cancel Plan" onPress={handleCancel} />;
}

export default function SubscriptionCard({ userId }: { userId: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const subscription = useSubscriptionStore((s) => s.subscription);

  const goPricing = () => navigation.navigate("Subscription");

  if (!subscription || subscription.tier === "FREE") {
    return <FreeUserBanner onUpgrade={goPricing} />;
  }

  const cycleLabel = subscription.billingCycle === "monthly" ? "mo" : "yr";
  const daysLeft = daysUntil(subscription.currentPeriodEnd);

  let renewalText: string | null = null;
  if (subscription.status === "active") {
    renewalText = `Next billing in ${daysLeft} days · ${formatDate(subscription.currentPeriodEnd)}`;
  } else if (subscription.status === "cancelled") {
    renewalText = `Access until ${formatDate(subscription.currentPeriodEnd)} · Reverts to FREE after`;
  } else if (subscription.status === "trial" && subscription.trialEndsAt) {
    const trialDays = daysUntil(subscription.trialEndsAt);
    renewalText = `Trial ends in ${trialDays} days · Next billing ${formatDate(subscription.currentPeriodEnd)} (₹${subscription.priceINR})`;
  } else if (subscription.status === "past_due") {
    renewalText = `Last attempt · ₹${subscription.priceINR.toLocaleString("en-IN")}`;
  }

  return (
    <View style={styles.subCard}>
      <View style={styles.subCardTop}>
        <View>
          <Text style={styles.subTier}>✦ {subscription.tier} Plan</Text>
          <Text style={styles.subBilling}>
            ₹{subscription.priceINR.toLocaleString("en-IN")}/{cycleLabel} · Billed {subscription.billingCycle}
          </Text>
        </View>
        <StatusBadge status={subscription.status} />
      </View>

      {renewalText ? <Text style={styles.subRenewal}>{renewalText}</Text> : null}

      <View style={styles.subActions}>
        {subscription.status === "active" && (
          <>
            <ActionButton
              label="Manage"
              onPress={() => navigation.navigate("ManageSubscription", { userId })}
              accent
            />
            <CancelButton subscription={subscription} userId={userId} />
          </>
        )}
        {subscription.status === "cancelled" && (
          <ActionButton label="Reactivate" onPress={goPricing} accent />
        )}
        {subscription.status === "past_due" && (
          <ActionButton label="Update payment" onPress={goPricing} accent warning />
        )}
        {subscription.status === "trial" && (
          <ActionButton label="Add payment method" onPress={goPricing} accent />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  subCard: {
    backgroundColor: "#111c17",
    borderWidth: 1,
    borderColor: "rgba(46,204,154,0.2)",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  subCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  subTier: { fontSize: 16, fontWeight: "700", color: "#fff" },
  subBilling: { fontSize: 12, color: "rgba(226,232,228,0.5)", marginTop: 2 },
  subRenewal: { fontSize: 13, color: "rgba(226,232,228,0.6)", marginBottom: 12 },
  subActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
  actionBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionBtnAccent: { borderColor: "rgba(46,204,154,0.4)", backgroundColor: "rgba(46,204,154,0.1)" },
  actionBtnWarning: { borderColor: "rgba(226,75,74,0.4)", backgroundColor: "rgba(226,75,74,0.1)" },
  actionBtnText: { color: "#e2e8e4", fontSize: 12, fontWeight: "600" },
  actionBtnTextWarning: { color: "#e24b4a" },
  upgradeBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(46,204,154,0.5)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  upgradeBtnText: { color: "#2ECC9A", fontSize: 12, fontWeight: "600" },
});
