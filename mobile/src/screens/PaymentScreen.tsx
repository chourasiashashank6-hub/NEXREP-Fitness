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
import { LinearGradient } from "expo-linear-gradient";
import { auth } from "../services/authService";
import { devActivatePlan } from "../api/payments";
import {
  CHECKOUT_COUPONS,
  getPlanById,
  planToCheckout,
  type CheckoutPlan,
} from "../constants/plans";
import type { ProfileStackParamList } from "../navigation/types";
import { useAppTheme } from "../theme";
import { planTierTheme } from "../theme/planTierTheme";
import type { PlanTier } from "../types/subscription";
import {
  buildRazorpayWebViewHtml,
  completePayment,
  createOrderForCheckout,
  runRazorpayCheckout,
  type RazorpayCheckoutResult,
} from "../services/razorpayCheckout";
import { getProfile } from "../api/user";
import axios from "axios";

const theme = {
  bg: "#0a0f0d",
  surface: "rgba(255,255,255,0.03)",
  surfaceBorder: "rgba(255,255,255,0.07)",
  accent: "#2ECC9A",
  accentFaint: "rgba(46,204,154,0.1)",
  accentBorder: "rgba(46,204,154,0.25)",
  textPrimary: "#e8f0eb",
  textMuted: "rgba(232,240,235,0.5)",
  textDim: "rgba(232,240,235,0.25)",
  error: "#e24b4a",
};

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
  const { planId, isYearly, displayPrice } = route.params;
  const { colors: themeColors } = useAppTheme();
  const plan: CheckoutPlan = useMemo(() => planToCheckout(getPlanById(planId)), [planId]);
  const billingCycle = isYearly ? "yearly" : "monthly";
  const tier: PlanTier = plan.name;
  const tierTheme = useMemo(() => planTierTheme(tier, themeColors), [tier, themeColors]);

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

  useEffect(() => {
    void (async () => {
      try {
        const profile = await getProfile();
        setPrefill({
          email: String(profile?.email ?? auth.currentUser?.email ?? ""),
          name: String(profile?.name ?? auth.currentUser?.displayName ?? ""),
          contact: String(profile?.phone ?? ""),
        });
      } catch {
        setPrefill({
          email: auth.currentUser?.email ?? "",
          name: auth.currentUser?.displayName ?? "",
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
      setCouponError("Invalid promo code");
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
          "Razorpay not configured",
          "Activate plan in development mode?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Activate (dev)",
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
                    Alert.alert("Error", err instanceof Error ? err.message : "Activation failed");
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
      Alert.alert("Payment failed", e instanceof Error ? e.message : "Something went wrong. Please try again.");
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
          Alert.alert("Payment failed", data.message ?? "Payment was not completed");
        }
        return;
      }
      if (!data.razorpay_payment_id || !data.razorpay_order_id || !data.razorpay_signature) {
        Alert.alert("Payment failed", "Incomplete payment response");
        return;
      }
      void finishPayment({
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_order_id: data.razorpay_order_id,
        razorpay_signature: data.razorpay_signature,
      }).catch((err) => {
        Alert.alert("Error", err instanceof Error ? err.message : "Could not verify payment");
      });
    } catch {
      setWebViewHtml(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={18} color={theme.accent} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Checkout</Text>
            <Text style={styles.headerSub}>NexRep {plan.name}</Text>
          </View>
          <View style={styles.secureTag}>
            <Ionicons name="lock-closed" size={12} color="rgba(46,204,154,0.7)" />
            <Text style={styles.secureText}>Secure</Text>
          </View>
        </View>

        <View style={[styles.planBanner, { backgroundColor: tierTheme.heroBg, borderColor: tierTheme.heroBorder }]}>
          <LinearGradient
            colors={[tierTheme.accentSoft, "transparent"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.planRow}>
            <View style={{ flex: 1 }}>
              <View style={[styles.planBadge, { backgroundColor: tierTheme.accentSoft }]}>
                <Text style={[styles.planBadgeText, { color: tierTheme.accent }]}>{plan.name} PLAN</Text>
              </View>
              <Text style={styles.planHeadline}>{plan.headline}</Text>
              <Text style={styles.planDesc}>{plan.desc}</Text>
            </View>
            <View style={styles.priceBlock}>
              <Text style={[styles.priceAmount, { color: tierTheme.accent }]}>
                ₹{isYearly ? getPlanById(planId).yearlyPrice : plan.priceMonthly}
              </Text>
              <Text style={styles.pricePeriod}>{isYearly ? "per month · billed yearly" : "per month"}</Text>
            </View>
          </View>
          {!isYearly ? (
            <View style={[styles.savingsPill, { borderColor: tierTheme.accent, backgroundColor: tierTheme.accentSoft }]}>
              <Ionicons name="flash" size={13} color={tierTheme.accent} />
              <Text style={[styles.savingsText, { color: tierTheme.accent }]}>Switch to yearly and save</Text>
              <Text style={[styles.savingsAmount, { color: tierTheme.accent }]}>₹{yearlySavings}/yr</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.featureCard}>
          {plan.features.map((feat, i) => (
            <View key={feat} style={[styles.featRow, i < plan.features.length - 1 && styles.featBorder]}>
              <View style={[styles.featIconBox, { backgroundColor: tierTheme.accentSoft }]}>
                <Ionicons name={featureIcon(feat)} size={16} color={tierTheme.accent} />
              </View>
              <Text style={styles.featText}>{feat}</Text>
              <Ionicons name="checkmark-circle" size={14} color={tierTheme.accent} />
            </View>
          ))}
        </View>

        <View style={styles.couponRow}>
          <TextInput
            style={styles.couponInput}
            placeholder="Enter promo code"
            placeholderTextColor={theme.textDim}
            value={couponCode}
            onChangeText={setCouponCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[styles.couponBtn, { backgroundColor: tierTheme.btnPrimaryBg, borderColor: tierTheme.btnPrimaryBorder }]}
            onPress={handleApplyCoupon}
          >
            <Text style={[styles.couponBtnText, { color: tierTheme.btnPrimaryText }]}>Apply</Text>
          </TouchableOpacity>
        </View>
        {couponError ? <Text style={styles.couponError}>{couponError}</Text> : null}
        {discount > 0 ? (
          <Text style={styles.couponSuccess}>Coupon applied! {Math.round(discount * 100)}% off</Text>
        ) : null}

        <Text style={styles.sectionTitle}>Payment method</Text>
        <View style={styles.pmGrid}>
          {(
            [
              { id: "razorpay" as const, label: "Razorpay", icon: "card-outline" as const },
              { id: "gpay" as const, label: "Google Pay", icon: "logo-google" as const },
              { id: "upi" as const, label: "UPI", icon: "phone-portrait-outline" as const },
            ] as const
          ).map((pm) => (
            <Pressable
              key={pm.id}
              style={[
                styles.pmTile,
                selectedPm === pm.id && styles.pmTileActive,
                selectedPm === pm.id && { borderColor: tierTheme.accent, backgroundColor: tierTheme.accentSoft },
              ]}
              onPress={() => setSelectedPm(pm.id)}
            >
              <Ionicons name={pm.icon} size={20} color={selectedPm === pm.id ? tierTheme.accent : theme.textMuted} />
              <Text style={[styles.pmLabel, selectedPm === pm.id && { color: tierTheme.accent }]}>{pm.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {plan.name} Plan ({billingCycle})
            </Text>
            <Text style={styles.summaryValue}>₹{basePrice}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Discount</Text>
            <Text style={[styles.summaryValue, discountAmt > 0 && styles.discountValue]}>
              {discountAmt > 0 ? `-₹${discountAmt}` : "—"}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>GST (18%)</Text>
            <Text style={styles.summaryValue}>₹{gst}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total due today</Text>
            <Text style={[styles.totalValue, { color: tierTheme.accent }]}>₹{totalDue}</Text>
          </View>
          <Text style={styles.finePrint}>* GST included. Billed {billingCycle}. Cancel anytime.</Text>
        </View>

        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: tierTheme.btnPrimaryBg }]}
          onPress={() => void handlePay()}
          disabled={paying}
        >
          {paying ? (
            <ActivityIndicator color={tierTheme.btnPrimaryText} />
          ) : (
            <>
              <Ionicons name="lock-closed" size={18} color={tierTheme.btnPrimaryText} />
              <Text style={[styles.ctaBtnText, { color: tierTheme.btnPrimaryText }]}>
                Pay ₹{totalDue} · Start {plan.name}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.trustRow}>
          <TrustItem icon="shield-checkmark-outline" label="Secure checkout" iconColor={tierTheme.accent} />
          <TrustItem icon="refresh-outline" label="Cancel anytime" iconColor={tierTheme.accent} />
          <TrustItem icon="time-outline" label="7-day trial" iconColor={tierTheme.accent} />
        </View>
        <Text style={styles.trialNote}>7-day free trial · No charge until trial ends</Text>
      </ScrollView>

      <Modal visible={Boolean(webViewHtml)} animationType="slide" onRequestClose={() => setWebViewHtml(null)}>
        <SafeAreaView style={styles.webModal}>
          <View style={styles.webModalHeader}>
            <Text style={styles.webModalTitle}>Secure payment</Text>
            <Pressable onPress={() => setWebViewHtml(null)}>
              <Ionicons name="close" size={24} color={theme.textPrimary} />
            </Pressable>
          </View>
          {webViewHtml ? (
            <WebView
              source={{ html: webViewHtml }}
              onMessage={(e) => onWebViewMessage(e.nativeEvent.data)}
              style={{ flex: 1, backgroundColor: theme.bg }}
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
  safe: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 16, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentBorder,
    backgroundColor: theme.accentFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  headerTitle: { color: theme.textPrimary, fontSize: 20, fontWeight: "700" },
  headerSub: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  secureTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: theme.accentFaint,
  },
  secureText: { color: "rgba(46,204,154,0.7)", fontSize: 11, fontWeight: "600" },
  planBanner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.surfaceBorder,
    backgroundColor: theme.surface,
    padding: 16,
    marginBottom: 14,
    overflow: "hidden",
  },
  planRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  planBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.accentFaint,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  planBadgeText: { color: theme.accent, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  planHeadline: { color: theme.textPrimary, fontSize: 18, fontWeight: "700" },
  planDesc: { color: theme.textMuted, fontSize: 12, marginTop: 4 },
  priceBlock: { alignItems: "flex-end" },
  priceAmount: { color: theme.accent, fontSize: 28, fontWeight: "800" },
  pricePeriod: { color: theme.textMuted, fontSize: 11 },
  savingsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  savingsText: { color: theme.textMuted, fontSize: 11 },
  savingsAmount: { color: theme.accent, fontSize: 11, fontWeight: "700" },
  featureCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.surfaceBorder,
    backgroundColor: theme.surface,
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
  featBorder: { borderBottomWidth: 1, borderBottomColor: theme.surfaceBorder },
  featIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.accentFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  featText: { flex: 1, color: theme.textPrimary, fontSize: 13 },
  couponRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  couponInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.surfaceBorder,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    color: theme.textPrimary,
    fontSize: 14,
  },
  couponBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: theme.accentFaint,
    borderWidth: 1,
    borderColor: theme.accentBorder,
    justifyContent: "center",
  },
  couponBtnText: { color: theme.accent, fontWeight: "700", fontSize: 13 },
  couponError: { color: theme.error, fontSize: 12, marginBottom: 8 },
  couponSuccess: { color: theme.accent, fontSize: 12, marginBottom: 12 },
  sectionTitle: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: "600",
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
    borderColor: theme.surfaceBorder,
    backgroundColor: "transparent",
  },
  pmTileActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentFaint,
  },
  pmLabel: { color: theme.textMuted, fontSize: 11, fontWeight: "600" },
  pmLabelActive: { color: theme.accent },
  summaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.surfaceBorder,
    backgroundColor: theme.surface,
    padding: 14,
    marginBottom: 16,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  summaryLabel: { color: theme.textMuted, fontSize: 13 },
  summaryValue: { color: theme.textPrimary, fontSize: 13, fontWeight: "600" },
  discountValue: { color: theme.accent },
  divider: { height: 1, backgroundColor: theme.surfaceBorder, marginVertical: 8 },
  totalLabel: { color: theme.textPrimary, fontSize: 15, fontWeight: "700" },
  totalValue: { color: theme.accent, fontSize: 20, fontWeight: "800" },
  finePrint: { color: theme.textDim, fontSize: 10, marginTop: 8, lineHeight: 14 },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 14,
  },
  ctaBtnText: { color: "#0a0f0d", fontSize: 16, fontWeight: "800" },
  trustRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  trustItem: { flex: 1, alignItems: "center", gap: 4 },
  trustLabel: { color: theme.textMuted, fontSize: 10, textAlign: "center" },
  trialNote: { color: theme.textDim, fontSize: 11, textAlign: "center" },
  webModal: { flex: 1, backgroundColor: theme.bg },
  webModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.surfaceBorder,
  },
  webModalTitle: { color: theme.textPrimary, fontSize: 16, fontWeight: "600" },
});
