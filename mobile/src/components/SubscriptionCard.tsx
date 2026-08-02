import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "../store/subscriptionStore";
import type { PlanStatus, Subscription } from "../types/subscription";
import { daysUntil, formatDate } from "../utils/dateFormat";
import type { ProfileStackParamList } from "../navigation/types";
import { logicalRow, textAlignStart } from "../utils/rtl";

const STATUS_COLORS: Record<PlanStatus, string> = {
  active: "#2ECC9A",
  trial: "#FFC107",
  cancelled: "rgba(226,232,228,0.4)",
  past_due: "#e24b4a",
  expired: "rgba(226,232,228,0.4)",
};

function StatusBadge({ status }: { status: PlanStatus }) {
  const { t } = useTranslation();
  const statusLabels: Record<PlanStatus, string> = {
    active: t("subscription.status.active"),
    trial: t("subscription.status.trial"),
    cancelled: t("subscription.status.cancelled"),
    past_due: t("subscription.status.paymentFailed"),
    expired: t("subscription.status.expired"),
  };
  return (
    <View style={[styles.badge, { borderColor: STATUS_COLORS[status] }]}>
      <Text style={[styles.badgeText, { color: STATUS_COLORS[status] }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
        {statusLabels[status]}
      </Text>
    </View>
  );
}

function FreeUserBanner({ onUpgrade }: { onUpgrade: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.subCard}>
      <View style={styles.subCardTop}>
        <View style={styles.subCopy}>
          <Text style={styles.subTier}>{t("subscription.card.freePlan")}</Text>
          <Text style={styles.subBilling}>{t("subscription.card.freeBilling")}</Text>
        </View>
      </View>
      <Pressable style={styles.upgradeBtn} onPress={onUpgrade}>
        <Text style={styles.upgradeBtnText}>{t("subscription.card.upgradePro")}</Text>
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
      <Text style={[styles.actionBtnText, warning && styles.actionBtnTextWarning]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
        {label}
      </Text>
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
  const { t } = useTranslation();
  const cancelPlan = useSubscriptionStore((s) => s.cancelPlan);
  const accessEnd = formatDate(subscription.currentPeriodEnd);

  const handleCancel = () => {
    Alert.alert(
      t("subscription.card.cancelTitle", { tier: subscription.tier }),
      t("subscription.card.cancelBody", { tier: subscription.tier, accessEnd }),
      [
        { text: t("subscription.card.keepPlan"), style: "cancel" },
        {
          text: t("subscription.card.cancelPlan"),
          style: "destructive",
          onPress: async () => {
            const msg = await cancelPlan(userId, subscription.id);
            if (msg) {
              Alert.alert(t("subscription.card.planCancelled"), t("subscription.card.accessContinues", { accessEnd }));
            } else {
              Alert.alert(t("common.error"), t("subscription.card.cancelFailed"));
            }
          },
        },
      ],
    );
  };

  return <ActionButton label={t("subscription.card.cancelPlanButton")} onPress={handleCancel} />;
}

export default function SubscriptionCard({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const subscription = useSubscriptionStore((s) => s.subscription);

  const goPricing = () => navigation.navigate("Subscription");

  if (!subscription || subscription.tier === "FREE") {
    return <FreeUserBanner onUpgrade={goPricing} />;
  }

  const cycleLabel = subscription.billingCycle === "monthly" ? t("subscription.card.monthlyShort") : t("subscription.card.yearlyShort");
  const daysLeft = daysUntil(subscription.currentPeriodEnd);

  let renewalText: string | null = null;
  if (subscription.status === "active") {
    renewalText = t("subscription.card.nextBilling", { days: daysLeft, date: formatDate(subscription.currentPeriodEnd) });
  } else if (subscription.status === "cancelled") {
    renewalText = t("subscription.card.accessUntil", { date: formatDate(subscription.currentPeriodEnd) });
  } else if (subscription.status === "trial" && subscription.trialEndsAt) {
    const trialDays = daysUntil(subscription.trialEndsAt);
    renewalText = t("subscription.card.trialEnds", { days: trialDays, date: formatDate(subscription.currentPeriodEnd), price: subscription.priceINR });
  } else if (subscription.status === "past_due") {
    renewalText = t("subscription.card.lastAttempt", { price: subscription.priceINR.toLocaleString("en-IN") });
  }

  return (
    <View style={styles.subCard}>
      <View style={styles.subCardTop}>
        <View style={styles.subCopy}>
          <Text style={styles.subTier}>{t("subscription.card.planTitle", { tier: subscription.tier })}</Text>
          <Text style={styles.subBilling}>
            {t("subscription.card.billingLine", { price: subscription.priceINR.toLocaleString("en-IN"), cycle: cycleLabel, billingCycle: subscription.billingCycle })}
          </Text>
        </View>
        <StatusBadge status={subscription.status} />
      </View>

      {renewalText ? <Text style={styles.subRenewal}>{renewalText}</Text> : null}

      <View style={styles.subActions}>
        {subscription.status === "active" && (
          <>
            <ActionButton
              label={t("subscription.card.manage")}
              onPress={() => navigation.navigate("ManageSubscription", { userId })}
              accent
            />
            <CancelButton subscription={subscription} userId={userId} />
          </>
        )}
        {subscription.status === "cancelled" && (
          <ActionButton label={t("subscription.card.reactivate")} onPress={goPricing} accent />
        )}
        {subscription.status === "past_due" && (
          <ActionButton label={t("subscription.card.updatePayment")} onPress={goPricing} accent warning />
        )}
        {subscription.status === "trial" && (
          <ActionButton label={t("subscription.card.addPaymentMethod")} onPress={goPricing} accent />
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
  subCardTop: { flexDirection: logicalRow, justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  subCopy: { flex: 1, minWidth: 0 },
  subTier: { fontSize: 16, fontWeight: "700", color: "#fff", textAlign: textAlignStart },
  subBilling: { fontSize: 12, color: "rgba(226,232,228,0.5)", marginTop: 2, textAlign: textAlignStart },
  subRenewal: { fontSize: 13, color: "rgba(226,232,228,0.6)", marginBottom: 12 },
  subActions: { flexDirection: logicalRow, flexWrap: "wrap", gap: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: "48%",
    flexShrink: 1,
  },
  badgeText: { fontSize: 11, lineHeight: 13, fontWeight: "600", textAlign: "center" },
  actionBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 0,
    maxWidth: "100%",
  },
  actionBtnAccent: { borderColor: "rgba(46,204,154,0.4)", backgroundColor: "rgba(46,204,154,0.1)" },
  actionBtnWarning: { borderColor: "rgba(226,75,74,0.4)", backgroundColor: "rgba(226,75,74,0.1)" },
  actionBtnText: { color: "#e2e8e4", fontSize: 12, lineHeight: 15, fontWeight: "600", textAlign: "center" },
  actionBtnTextWarning: { color: "#e24b4a" },
  upgradeBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(46,204,154,0.5)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
    maxWidth: "100%",
  },
  upgradeBtnText: { color: "#2ECC9A", fontSize: 12, fontWeight: "600", textAlign: "center" },
});
