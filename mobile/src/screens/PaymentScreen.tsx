import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { getFirebaseAuth } from "../config/firebase";
import { devActivatePlan } from "../api/payments";
import {
  CHECKOUT_COUPONS,
  getPlanById,
  planToCheckout,
  type CheckoutPlan,
} from "../constants/plans";
import type { ProfileStackParamList } from "../navigation/types";
import {
  buildRazorpayWebViewHtml,
  completePayment,
  createOrderForCheckout,
  runRazorpayCheckout,
  type RazorpayCheckoutResult,
} from "../services/razorpayCheckout";
import { getProfile } from "../api/user";
import axios from "axios";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const GOLD = "#FFD700";
const GOLD_LIGHT = "#FFFBEA";
const AMBER_TEXT = "#C08000";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

type PaymentMethod = "razorpay" | "gpay" | "upi";

type Props = NativeStackScreenProps<ProfileStackParamList, "Payment">;

function getNextMonthResetLabel(): string {
  const next = new Date();
  next.setMonth(next.getMonth() + 1, 1);
  return next.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function featureIcon(feature: string): keyof typeof Ionicons.glyphMap {
  const f = feature.toLowerCase();
  if (f.includes("analytics") || f.includes("chart") || f.includes("composition")) return "bar-chart-outline";
  if (f.includes("ai") || f.includes("rep")) return "flash-outline";
  if (f.includes("plan") || f.includes("logging")) return "list-outline";
  if (f.includes("nutrition") || f.includes("meal")) return "nutrition-outline";
  if (f.includes("trainer") || f.includes("support")) return "people-outline";
  if (f.includes("wearable") || f.includes("sync")) return "watch-outline";
  if (f.includes("challenge") || f.includes("exclusive")) return "trophy-outline";
  return "barbell-outline";
}

function TrustItem({
  icon,
  label,
  iconColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  iconColor: string;
}) {
  return (
    <View style={styles.trustItem}>
      <Ionicons name={icon} size={16} color={iconColor} />
      <Text style={styles.trustLabel}>{label}</Text>
    </View>
  );
}

export function PaymentScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { planId, isYearly, displayPrice } = route.params;
  const plan: CheckoutPlan = useMemo(() => planToCheckout(getPlanById(planId)), [planId]);
  const billingCycle = isYearly ? "yearly" : "monthly";

  const [couponCode, setCouponCode] = useState("");
  const [discount, setDiscount] = useState(0);
  const [couponError, setCouponError] = useState("");
  const [selectedPm, setSelectedPm] = useState<PaymentMethod>("razorpay");
  const [paying, setPaying] = useState(false);
  const [prefill, setPrefill] = useState({ email: "", contact: "", name: "" });
  const [webViewHtml, setWebViewHtml] = useState<string | null>(null);

  const resetMonthLabel = getNextMonthResetLabel();

  const basePrice = displayPrice;
  const discountAmt = Math.round(basePrice * discount);
  const afterDisc = basePrice - discountAmt;
  const gst = Math.round(afterDisc * 0.18);
  const totalDue = afterDisc + gst;
  const yearlySavings = Math.round(plan.priceMonthly * 12 * 0.2);
  const featurePreview = plan.features.slice(0, 3);
  const remainingFeatureCount = Math.max(0, plan.features.length - featurePreview.length);

  useEffect(() => {
    void (async () => {
      try {
        const profile = await getProfile();
        setPrefill({
          email: String(profile?.email ?? getFirebaseAuth().currentUser?.email ?? ""),
          name: String(profile?.name ?? getFirebaseAuth().currentUser?.displayName ?? ""),
          contact: String(profile?.phone ?? ""),
        });
      } catch {
        setPrefill({
          email: getFirebaseAuth().currentUser?.email ?? "",
          name: getFirebaseAuth().currentUser?.displayName ?? "",
          contact: "",
        });
      }
    })();
  }, []);

  const handleApplyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    if (CHECKOUT_COUPONS[code]) {
      setDiscount(CHECKOUT_COUPONS[code]);
      setCouponError("");
    } else {
      setDiscount(0);
      setCouponError(t("payment.checkout.invalidPromo"));
    }
  };

  const finishPayment = useCallback(
    async (checkout: RazorpayCheckoutResult) => {
      await completePayment(checkout, plan.planId, billingCycle);
      navigation.replace("PaymentSuccess", {
        planName: plan.name,
        paymentId: checkout.razorpay_payment_id,
      });
    },
    [billingCycle, navigation, plan.name, plan.planId],
  );

  const handlePay = async () => {
    setPaying(true);
    try {
      const checkoutParams = {
        planId: plan.planId,
        billingCycle,
        amountInr: totalDue,
        planLabel: plan.name,
        paymentMethod: selectedPm,
        prefill,
      };

      if (Platform.OS === "web") {
        const checkout = await runRazorpayCheckout(checkoutParams);
        await finishPayment(checkout);
        return;
      }

      const order = await createOrderForCheckout(checkoutParams);
      setWebViewHtml(buildRazorpayWebViewHtml(order, checkoutParams));
    } catch (e: unknown) {
      if (axios.isAxiosError(e) && e.response?.status === 503 && __DEV__) {
        Alert.alert(
          t("payment.checkout.razorpayNotConfigured"),
          t("payment.checkout.activateDev"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("payment.checkout.activateDevAction"),
              onPress: () => {
                void (async () => {
                  try {
                    const res = await devActivatePlan({
                      plan_id: plan.planId,
                      billing_cycle: billingCycle,
                      amount_inr: totalDue,
                    });
                    navigation.replace("PaymentSuccess", {
                      planName: plan.name,
                      paymentId: String(res.payment_id ?? "dev"),
                    });
                  } catch (err) {
                    Alert.alert(t("common.error"), err instanceof Error ? err.message : t("payment.checkout.activationFailed"));
                  }
                })();
              },
            },
          ],
        );
        return;
      }
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: number }).code : undefined;
      if (code === 2) return;
      Alert.alert(t("payment.checkout.paymentFailed"), e instanceof Error ? e.message : t("payment.checkout.genericFailure"));
    } finally {
      setPaying(false);
    }
  };

  const onWebViewMessage = (raw: string) => {
    try {
      const data = JSON.parse(raw) as {
        ok: boolean;
        code?: number;
        message?: string;
        razorpay_payment_id?: string;
        razorpay_order_id?: string;
        razorpay_signature?: string;
      };
      setWebViewHtml(null);
      if (!data.ok) {
        if (data.code !== 2) {
          Alert.alert(t("payment.checkout.paymentFailed"), data.message ?? t("payment.checkout.notCompleted"));
        }
        return;
      }
      if (!data.razorpay_payment_id || !data.razorpay_order_id || !data.razorpay_signature) {
        Alert.alert(t("payment.checkout.paymentFailed"), t("payment.checkout.incompleteResponse"));
        return;
      }
      void finishPayment({
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_order_id: data.razorpay_order_id,
        razorpay_signature: data.razorpay_signature,
      }).catch((err) => {
        Alert.alert(t("common.error"), err instanceof Error ? err.message : t("payment.checkout.verifyFailed"));
      });
    } catch {
      setWebViewHtml(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel={t("payment.checkout.goBack")}>
            <Ionicons name="arrow-back" size={18} color={TEXT} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>{t("payment.checkout.title")}</Text>
            <Text style={styles.headerSub}>{t("payment.checkout.planSubtitle", { planName: plan.name })}</Text>
          </View>
          <View style={styles.secureTag}>
            <Ionicons name="lock-closed" size={12} color={GREEN} />
            <Text style={styles.secureText}>{t("payment.checkout.secure")}</Text>
          </View>
        </View>

        <View style={styles.planBanner}>
          <View style={styles.planRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>{t("payment.checkout.planBadge", { planName: plan.name })}</Text>
              </View>
              <Text style={styles.planDesc} numberOfLines={1}>{plan.desc}</Text>
            </View>
            <View style={styles.priceBlock}>
              <Text style={styles.priceAmount}>
                ₹{isYearly ? getPlanById(planId).yearlyPrice : plan.priceMonthly}
              </Text>
              <Text style={styles.pricePeriod}>{isYearly ? t("payment.checkout.perMonthYearly") : t("payment.checkout.perMonth")}</Text>
            </View>
          </View>
          {!isYearly ? (
            <View style={styles.savingsPill}>
              <Ionicons name="flash" size={13} color={GREEN} />
              <Text style={styles.savingsText}>{t("payment.checkout.yearlySavings", { amount: yearlySavings })}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.featureCard}>
          {featurePreview.map((feat, i) => (
            <View key={feat} style={[styles.featRow, i < featurePreview.length - 1 && styles.featBorder]}>
              <View style={styles.featIconBox}>
                <Ionicons name={featureIcon(feat)} size={16} color={GREEN} />
              </View>
              <Text style={styles.featText}>{feat}</Text>
              <Ionicons name="checkmark-circle" size={14} color={GREEN} />
            </View>
          ))}
          {remainingFeatureCount > 0 ? (
            <Text style={styles.featureMoreText}>{t("payment.checkout.moreBenefits", { count: remainingFeatureCount })}</Text>
          ) : null}
        </View>

        <View style={styles.couponRow}>
          <TextInput
            style={styles.couponInput}
            placeholder={t("payment.checkout.promoPlaceholder")}
            placeholderTextColor={MUTED}
            value={couponCode}
            onChangeText={setCouponCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={styles.couponBtn}
            onPress={handleApplyCoupon}
          >
            <Text style={styles.couponBtnText}>{t("payment.checkout.apply")}</Text>
          </TouchableOpacity>
        </View>
        {couponError ? <Text style={styles.couponError}>{couponError}</Text> : null}
        {discount > 0 ? (
          <Text style={styles.couponSuccess}>{t("payment.checkout.couponApplied", { percent: Math.round(discount * 100) })}</Text>
        ) : null}

        <Text style={styles.sectionTitle}>{t("payment.checkout.paymentMethod")}</Text>
        <View style={styles.pmGrid}>
          {(
            [
              { id: "razorpay" as const, label: t("payment.checkout.razorpay"), icon: "card-outline" as const },
              { id: "gpay" as const, label: t("payment.checkout.googlePay"), icon: "logo-google" as const },
              { id: "upi" as const, label: t("payment.checkout.upi"), icon: "phone-portrait-outline" as const },
            ] as const
          ).map((pm) => (
            <Pressable
              key={pm.id}
              style={[
                styles.pmTile,
                selectedPm === pm.id && styles.pmTileActive,
              ]}
              onPress={() => setSelectedPm(pm.id)}
            >
              <Ionicons name={pm.icon} size={20} color={selectedPm === pm.id ? GREEN : MUTED} />
              <Text style={[styles.pmLabel, selectedPm === pm.id && styles.pmLabelActive]}>{pm.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {t("payment.checkout.planSummary", { planName: plan.name, billingCycle })}
            </Text>
            <Text style={styles.summaryValue}>₹{basePrice}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t("payment.checkout.discount")}</Text>
            <Text style={[styles.summaryValue, discountAmt > 0 && styles.discountValue]}>
              {discountAmt > 0 ? `-₹${discountAmt}` : "—"}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t("payment.checkout.gst")}</Text>
            <Text style={styles.summaryValue}>₹{gst}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>{t("payment.checkout.totalDue")}</Text>
            <Text style={styles.totalValue}>₹{totalDue}</Text>
          </View>
          <Text style={styles.finePrint}>{t("payment.checkout.finePrint", { billingCycle })}</Text>
        </View>

        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={() => void handlePay()}
          disabled={paying}
        >
          {paying ? (
            <ActivityIndicator color={WHITE} />
          ) : (
            <>
              <Ionicons name="lock-closed" size={18} color={WHITE} />
              <Text style={styles.ctaBtnText}>
                {t("payment.checkout.payCta", { amount: totalDue, planName: plan.name })}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.trustRow}>
          <TrustItem icon="shield-checkmark-outline" label={t("payment.checkout.secureCheckout")} iconColor={GREEN} />
          <TrustItem icon="refresh-outline" label={t("payment.checkout.cancelAnytime")} iconColor={GREEN} />
          <TrustItem icon="time-outline" label={t("payment.checkout.trial")} iconColor={GREEN} />
        </View>
        <Text style={styles.trialNote}>{t("payment.checkout.trialNote")}</Text>
      </ScrollView>

      <Modal visible={Boolean(webViewHtml)} animationType="slide" onRequestClose={() => setWebViewHtml(null)}>
        <SafeAreaView style={styles.webModal}>
          <View style={styles.webModalHeader}>
            <Text style={styles.webModalTitle}>{t("payment.checkout.securePayment")}</Text>
            <Pressable onPress={() => setWebViewHtml(null)}>
              <Ionicons name="close" size={24} color={TEXT} />
            </Pressable>
          </View>
          {webViewHtml ? (
            <WebView
              source={{ html: webViewHtml }}
              onMessage={(e) => onWebViewMessage(e.nativeEvent.data)}
              style={{ flex: 1, backgroundColor: SCREEN_BG }}
              javaScriptEnabled
              domStorageEnabled
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SCREEN_BG },
  scroll: { padding: 16, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 10,
  },
  backBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  headerTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  headerSub: { color: MUTED, fontSize: 10, marginTop: 2, fontWeight: "700" },
  secureTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: GREEN_LIGHT,
  },
  secureText: { color: GREEN, fontSize: 11, fontWeight: "800" },
  planBanner: {
    borderRadius: 14,
    backgroundColor: GREEN_LIGHT,
    padding: 16,
    marginBottom: 14,
    overflow: "hidden",
  },
  planRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  planBadge: {
    alignSelf: "flex-start",
    backgroundColor: GREEN,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  planBadgeText: { color: WHITE, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  planHeadline: { color: TEXT, fontSize: 18, fontWeight: "700" },
  planDesc: { color: TEXT, opacity: 0.62, fontSize: 12, marginTop: 4 },
  priceBlock: { alignItems: "flex-end" },
  priceAmount: { color: TEXT, fontSize: 15, fontWeight: "900" },
  pricePeriod: { color: MUTED, fontSize: 10, textAlign: "right" },
  savingsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    alignSelf: "flex-start",
    borderRadius: 99,
    paddingVertical: 2,
  },
  savingsText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  savingsAmount: { color: GREEN, fontSize: 11, fontWeight: "700" },
  featureCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    marginBottom: 14,
    overflow: "hidden",
  },
  featRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  featBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  featureMoreText: { color: MUTED, fontSize: 12, paddingHorizontal: 14, paddingBottom: 12, fontWeight: "700" },
  featIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: GREEN_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  featText: { flex: 1, color: TEXT, fontSize: 13, fontWeight: "700" },
  couponRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  couponInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
    paddingHorizontal: 12,
    color: TEXT,
    fontSize: 14,
  },
  couponBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: GREEN,
    justifyContent: "center",
  },
  couponBtnText: { color: WHITE, fontWeight: "900", fontSize: 13 },
  couponError: { color: ORANGE, fontSize: 12, marginBottom: 8 },
  couponSuccess: { color: GREEN, fontSize: 12, marginBottom: 12 },
  sectionTitle: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  pmGrid: { flexDirection: "row", gap: 8, marginBottom: 14 },
  pmTile: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  pmTileActive: {
    borderColor: GREEN,
    borderWidth: 1.5,
    backgroundColor: GREEN_LIGHT,
  },
  pmLabel: { color: MUTED, fontSize: 11, fontWeight: "800" },
  pmLabelActive: { color: GREEN },
  summaryCard: {
    borderRadius: 12,
    backgroundColor: BG,
    padding: 14,
    marginBottom: 16,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  summaryLabel: { color: MUTED, fontSize: 13 },
  summaryValue: { color: TEXT, fontSize: 13, fontWeight: "800" },
  discountValue: { color: GREEN },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 8 },
  totalLabel: { color: TEXT, fontSize: 15, fontWeight: "900" },
  totalValue: { color: GREEN, fontSize: 20, fontWeight: "900" },
  finePrint: { color: MUTED, fontSize: 10, marginTop: 8, lineHeight: 14 },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 14,
  },
  ctaBtnText: { color: WHITE, fontSize: 16, fontWeight: "900" },
  trustRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  trustItem: { flex: 1, alignItems: "center", gap: 4, backgroundColor: BG, borderRadius: 12, paddingVertical: 8 },
  trustLabel: { color: MUTED, fontSize: 9, textAlign: "center", fontWeight: "800" },
  trialNote: { color: MUTED, fontSize: 11, textAlign: "center" },
  webModal: { flex: 1, backgroundColor: SCREEN_BG },
  webModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  webModalTitle: { color: TEXT, fontSize: 16, fontWeight: "900" },
});
