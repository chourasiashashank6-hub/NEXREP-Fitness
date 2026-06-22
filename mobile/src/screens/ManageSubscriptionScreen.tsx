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
import { useTranslation } from "react-i18next";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "../components/ScreenContainer";
import { exportInvoicesApi } from "../api/subscriptions";
import { PLANS } from "../constants/plans";
import { TIER_COLORS } from "../constants/tierColors";
import type { ProfileStackParamList } from "../navigation/types";
import { useSubscriptionStore } from "../store/subscriptionStore";
import { daysUntil, formatDate } from "../utils/dateFormat";

const GREEN = "#0F6E56";
const ORANGE = "#D85A30";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

export function ManageSubscriptionScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<RouteProp<ProfileStackParamList, "ManageSubscription">>();
  const userId = route.params.userId;
  const subscription = useSubscriptionStore((s) => s.subscription);
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const cancelPlan = useSubscriptionStore((s) => s.cancelPlan);
  const [downloading, setDownloading] = useState(false);
  const tierColors = TIER_COLORS[subscription?.tier ?? "FREE"];

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
      t("subscription.manage.cancelTitle", { tier: subscription.tier }),
      t("subscription.manage.cancelBody", { accessEnd }),
      [
        { text: t("subscription.manage.keepPlan"), style: "cancel" },
        {
          text: t("subscription.manage.cancelPlan"),
          style: "destructive",
          onPress: async () => {
            const msg = await cancelPlan(userId, subscription.id);
            if (msg) {
              Alert.alert(t("subscription.manage.planCancelled"), t("subscription.manage.accessContinues", { accessEnd }));
              navigation.goBack();
            } else {
              Alert.alert(t("common.error"), t("subscription.manage.cancelFailed"));
            }
          },
        },
      ],
    );
  }, [subscription, userId, cancelPlan, navigation, t]);

  const handleDownloadInvoices = async () => {
    setDownloading(true);
    try {
      const { invoices } = await exportInvoicesApi(userId);
      if (!invoices.length) {
        Alert.alert(t("subscription.manage.noInvoices"), t("subscription.manage.noReceipts"));
        return;
      }
      for (const inv of invoices) {
        if (inv.url) await Linking.openURL(inv.url);
      }
      Alert.alert(t("subscription.manage.invoices"), t("subscription.manage.openedReceipts", { count: invoices.length }));
    } catch {
      Alert.alert(t("common.error"), t("subscription.manage.couldNotLoadInvoices"));
    } finally {
      setDownloading(false);
    }
  };

  if (!subscription || subscription.tier === "FREE") {
    return (
      <ScreenContainer bg={SCREEN_BG} contentStyle={styles.screenContent}>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.headerBackBtn, pressed && styles.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("subscription.manage.title")}</Text>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("subscription.manage.noActivePaidPlan")}</Text>
          <Text style={styles.emptySub}>{t("subscription.manage.choosePlan")}</Text>
        </View>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: tierColors.buttonBg }]}
          onPress={() => navigation.navigate("PlanPicker")}
        >
          <Text style={[styles.primaryBtnText, { color: tierColors.buttonText }]}>{t("subscription.manage.viewPlans")}</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  const proPlan = PLANS.find((p) => p.id === "pro");
  const elitePlan = PLANS.find((p) => p.id === "elite");
  const isYearly = subscription.billingCycle === "yearly";

  return (
    <ScreenContainer bg={SCREEN_BG} contentStyle={styles.screenContent}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleBack}
            style={({ pressed }) => [styles.headerBackBtn, pressed && styles.backBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={18} color={TEXT} />
          </Pressable>
          <Text style={styles.headerTitle}>{t("subscription.manage.title")}</Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: tierColors.cardBg,
              borderColor: tierColors.cardBorder,
              borderWidth: 1.5,
            },
          ]}
        >
          <Text style={[styles.cardTitle, styles.currentPlanTitle, { color: tierColors.titleColor }]}>{t("subscription.manage.currentPlan")}</Text>
          <DetailRow label={t("subscription.manage.tier")} value={`${subscription.tier}`} labelColor={tierColors.mutedText} valueColor={tierColors.titleColor} />
          <DetailRow
            label={t("subscription.manage.price")}
            value={t("subscription.manage.pricePerCycle", { price: subscription.priceINR.toLocaleString("en-IN"), cycle: isYearly ? t("subscription.manage.year") : t("subscription.manage.month") })}
            labelColor={tierColors.mutedText}
          />
          <DetailRow label={t("subscription.manage.billing")} value={subscription.billingCycle} labelColor={tierColors.mutedText} />
          <DetailRow
            label={t("subscription.manage.nextBilling")}
            value={t("subscription.manage.billingDate", { date: formatDate(subscription.currentPeriodEnd), days: daysUntil(subscription.currentPeriodEnd) })}
            labelColor={tierColors.mutedText}
          />
          {subscription.razorpaySubscriptionId ? (
            <DetailRow label={t("subscription.manage.razorpaySubId")} value={subscription.razorpaySubscriptionId} mono />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("subscription.manage.billingCycle")}</Text>
          <Text style={styles.cardSub}>{t("subscription.manage.billingCycleHelp")}</Text>
          <View style={styles.compareRow}>
            <CycleCompare
              label={t("subscription.manage.monthly")}
              proPrice={proPlan?.monthlyPrice ?? 999}
              elitePrice={elitePlan?.monthlyPrice ?? 1999}
              active={!isYearly}
              activeColor={tierColors.titleColor}
              activeBorderColor={tierColors.cardBorder}
            />
            <CycleCompare
              label={t("subscription.manage.yearly")}
              proPrice={(proPlan?.yearlyPrice ?? 832) * 12}
              elitePrice={(elitePlan?.yearlyPrice ?? 1665) * 12}
              active={isYearly}
              activeColor={tierColors.titleColor}
              activeBorderColor={tierColors.cardBorder}
            />
          </View>
          <Text style={styles.infoCaption}>{t("subscription.manage.switchHelp")}</Text>
          <Pressable
            style={[styles.outlineBtn, { backgroundColor: tierColors.buttonBg }]}
            onPress={() => navigation.navigate("PlanPicker")}
          >
            <Text style={[styles.primaryBtnText, { color: tierColors.buttonText }]}>{t("subscription.manage.viewPlans")}</Text>
          </Pressable>
        </View>

        <Pressable style={styles.downloadBtn} onPress={() => void handleDownloadInvoices()} disabled={downloading}>
          {downloading ? (
            <ActivityIndicator color={GREEN} />
          ) : (
            <Text style={styles.outlineBtnText}>{t("subscription.manage.downloadInvoices")}</Text>
          )}
        </Pressable>

        {subscription.status === "active" ? (
          <Pressable style={styles.cancelTextBtn} onPress={handleCancel}>
            <Text style={styles.cancelBtnText}>{t("subscription.manage.cancelSubscription")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function DetailRow({
  label,
  value,
  mono,
  labelColor,
  valueColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  labelColor?: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, labelColor ? { color: labelColor } : null]}>{label}</Text>
      <Text style={[styles.detailValue, valueColor ? { color: valueColor } : null, mono && styles.mono]} numberOfLines={mono ? 1 : undefined}>
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
  activeColor,
  activeBorderColor,
}: {
  label: string;
  proPrice: number;
  elitePrice: number;
  active: boolean;
  activeColor: string;
  activeBorderColor: string;
}) {
  return (
    <View style={[styles.cycleBox, active && styles.cycleBoxActive, active && { borderColor: activeBorderColor }]}>
      <Text style={[styles.cycleLabel, active && { color: activeColor }]}>{label}</Text>
      <Text style={styles.cyclePrice}>PRO ₹{proPrice.toLocaleString("en-IN")}</Text>
      <Text style={styles.cyclePrice}>ELITE ₹{elitePrice.toLocaleString("en-IN")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { backgroundColor: SCREEN_BG, paddingBottom: 28 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  headerBackBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnPressed: { opacity: 0.65 },
  headerTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  emptyCard: { backgroundColor: BG, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: BORDER },
  emptyTitle: { color: TEXT, fontSize: 16, fontWeight: "900" },
  emptySub: { color: MUTED, fontSize: 11, marginTop: 5, lineHeight: 16 },
  card: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { color: TEXT, fontSize: 15, fontWeight: "900", marginBottom: 10 },
  currentPlanTitle: { fontSize: 13 },
  cardSub: { color: MUTED, fontSize: 11, marginBottom: 12, lineHeight: 16 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12 },
  detailLabel: { color: MUTED, fontSize: 12 },
  detailValue: { color: TEXT, fontSize: 12, fontWeight: "900", flex: 1, textAlign: "right" },
  mono: { fontSize: 10 },
  compareRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  cycleBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
    backgroundColor: WHITE,
  },
  cycleBoxActive: { borderWidth: 1.5, backgroundColor: WHITE },
  cycleLabel: { color: MUTED, fontSize: 12, fontWeight: "700", marginBottom: 4 },
  cyclePrice: { color: TEXT, fontSize: 11, fontWeight: "700" },
  infoCaption: { color: MUTED, fontSize: 10, lineHeight: 15, marginBottom: 10 },
  outlineBtn: {
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  outlineBtnText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  primaryBtnText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  cancelTextBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  downloadBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: { color: ORANGE, fontSize: 13, fontWeight: "900" },
});
