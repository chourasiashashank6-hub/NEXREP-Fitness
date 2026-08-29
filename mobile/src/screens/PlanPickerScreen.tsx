import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { useFonts, BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from "@expo-google-fonts/dm-sans";
import { StatusBar } from "expo-status-bar";

import { PlanCard } from "../components/PlanCard";
import {
  PlanOverviewCard,
  SubscriptionHistorySection,
} from "../components/subscription/SubscriptionOverviewUI";
import { getPrice, getServerPlanAmountInr, PLANS, COUPONS_UI_ENABLED, type PlanId } from "../constants/plans";
import { runCouponApply } from "../components/CouponInput";
import type { ProfileStackParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";
import { useSubscriptionStore } from "../store/subscriptionStore";

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

const DEFAULT_TERMS_URL = "https://nexrep.app/terms";
const DEFAULT_PRIVACY_URL = "https://nexrep.app/privacy";

export type PlanPickerScreenProps = {
  onSelectPlan?: (planId: PlanId, price: number, isYearly: boolean) => void;
  onPressTerms?: () => void;
  onPressPrivacy?: () => void;
  termsUrl?: string;
  privacyUrl?: string;
};

export function PlanPickerScreen({
  onSelectPlan,
  onPressTerms,
  onPressPrivacy,
  termsUrl = DEFAULT_TERMS_URL,
  privacyUrl = DEFAULT_PRIVACY_URL,
}: PlanPickerScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, "PlanPicker">>();
  const userId = useAuthStore((s) => s.sessionUserId);
  const authPlanId = useAuthStore((s) => s.plan_id) ?? "free";
  const subscriptionTier = useSubscriptionStore((s) => s.subscription?.tier);
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const fetchPayments = useSubscriptionStore((s) => s.fetchPayments);

  const [fontsLoaded] = useFonts({ BebasNeue_400Regular, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold });
  const [isYearly, setIsYearly] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponError, setCouponError] = useState("");

  const currentTier = String(subscriptionTier ?? authPlanId ?? "FREE").toUpperCase();

  useEffect(() => {
    if (!userId) return;
    void fetchSubscription(userId);
    void fetchPayments(userId);
  }, [userId, fetchSubscription, fetchPayments]);

  const openTerms = useCallback(async () => {
    if (onPressTerms) {
      onPressTerms();
      return;
    }
    await Linking.openURL(termsUrl);
  }, [onPressTerms, termsUrl]);

  const openPrivacy = useCallback(async () => {
    if (onPressPrivacy) {
      onPressPrivacy();
      return;
    }
    await Linking.openURL(privacyUrl);
  }, [onPressPrivacy, privacyUrl]);

  const handleApplyCoupon = useCallback(() => {
    const result = runCouponApply(couponCode);
    if (result.ok) {
      setCouponApplied(true);
      setCouponError("");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      setCouponError(result.error);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [couponCode]);

  const handleClearCoupon = useCallback(() => {
    setCouponCode("");
    setCouponApplied(false);
    setCouponError("");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("ProfileMain");
  }, [navigation]);

  const handleSelectPlan = useCallback(
    (planId: PlanId) => {
      const plan = PLANS.find((p) => p.id === planId);
      if (!plan) return;
      const price = getServerPlanAmountInr(planId, isYearly ? "yearly" : "monthly");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSelectPlan?.(planId, price, isYearly);
      navigation.navigate("Payment", { planId, displayPrice: price, isYearly });
    },
    [isYearly, navigation, onSelectPlan],
  );

  const proPlan = useMemo(() => PLANS.find((p) => p.id === "pro")!, []);
  const elitePlan = useMemo(() => PLANS.find((p) => p.id === "elite")!, []);
  const proPrice = getPrice(proPlan, isYearly, false);
  const elitePrice = getPrice(elitePlan, isYearly, false);
  const proOriginal = null;
  const eliteOriginal = null;

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="dark" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleBack}
            style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t("subscription.planPicker.goBack")}
          >
            <Ionicons name="chevron-back" size={18} color={TEXT} />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>{t("subscription.planPicker.title")}</Text>
            <Text style={styles.headerSubtitle}>{t("subscription.planPicker.currentPlan", { tier: currentTier })}</Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>{t("subscription.planPicker.heroTitle")}</Text>
          <Text style={styles.heroSubtitle}>{t("subscription.planPicker.heroSubtitle")}</Text>
        </View>

        <PlanOverviewCard compact />

        <View style={styles.toggleWrap}>
          <Pressable style={[styles.toggleSide, !isYearly && styles.toggleSideActive]} onPress={() => setIsYearly(false)}>
            <Text style={[styles.toggleText, !isYearly && styles.toggleTextActive]}>{t("subscription.planPicker.monthly")}</Text>
          </Pressable>
          <Pressable style={[styles.toggleSide, isYearly && styles.toggleSideActive]} onPress={() => setIsYearly(true)}>
            <Text style={[styles.toggleText, isYearly && styles.toggleTextActive]}>{t("subscription.planPicker.yearly")}</Text>
          </Pressable>
        </View>

        {COUPONS_UI_ENABLED ? (
        <View style={styles.couponBox}>
          <Text style={styles.couponLabel}>{t("subscription.planPicker.earlyOffer")}</Text>
          <View style={styles.couponRow}>
            <TextInput
              value={couponCode}
              onChangeText={(t) => {
                setCouponCode(t);
                if (couponError) setCouponError("");
              }}
              placeholder={t("subscription.planPicker.codePlaceholder")}
              placeholderTextColor={MUTED}
              editable={!couponApplied}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.couponInput, couponApplied && styles.couponInputApplied]}
            />
            <Pressable style={[styles.applyBtn, couponApplied && styles.applyBtnDisabled]} onPress={handleApplyCoupon} disabled={couponApplied}>
              <Text style={styles.applyBtnText}>{t("subscription.planPicker.apply")}</Text>
            </Pressable>
          </View>
          {couponApplied ? (
            <Pressable onPress={handleClearCoupon} hitSlop={8}>
              <Text style={styles.couponSuccess}>{t("subscription.planPicker.couponApplied")}</Text>
            </Pressable>
          ) : couponError ? (
            <Text style={styles.couponError}>{couponError}</Text>
          ) : null}
        </View>
        ) : null}

        <Text style={styles.sectionLabel}>{t("subscription.planPicker.chooseYourPlan")}</Text>
        <View style={styles.planRow}>
          <PlanCard
            plan={proPlan}
            displayPrice={proPrice}
            originalPrice={proOriginal}
            isYearly={isYearly}
            featured={false}
            onSelect={() => handleSelectPlan("pro")}
            isCurrentPlan={proPlan.id === currentTier.toLowerCase()}
          />
          <PlanCard
            plan={elitePlan}
            displayPrice={elitePrice}
            originalPrice={eliteOriginal}
            isYearly={isYearly}
            featured={true}
            onSelect={() => handleSelectPlan("elite")}
            isCurrentPlan={elitePlan.id === currentTier.toLowerCase()}
          />
        </View>

        <SubscriptionHistorySection />

        <View style={styles.trustRow}>
          <TrustTile icon="shield-checkmark" label={t("subscription.planPicker.securePayment")} />
          <TrustTile icon="calendar-outline" label={t("subscription.planPicker.trial")} />
          <TrustTile icon="people" label={t("subscription.planPicker.athletes")} />
        </View>

        <Text style={styles.legal}>
          {t("subscription.planPicker.legalPrefix")}
          <Text onPress={openTerms} style={styles.link}>{t("subscription.planPicker.terms")}</Text>
          {t("subscription.planPicker.legalMiddle")}<Text onPress={openPrivacy} style={styles.link}>{t("subscription.planPicker.privacy")}</Text>{t("subscription.planPicker.legalSuffix")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function TrustTile({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.trustTile}>
      <Ionicons name={icon} size={16} color={GREEN} />
      <Text style={styles.trustLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SCREEN_BG },
  scroll: { flex: 1, backgroundColor: SCREEN_BG },
  content: { padding: 16, paddingBottom: 36, maxWidth: 860, width: "100%", alignSelf: "center" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: SCREEN_BG },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  backBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  backBtnPressed: { opacity: 0.65 },
  headerTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  headerSubtitle: { color: MUTED, fontSize: 10, marginTop: 2, fontWeight: "700" },
  heroCard: { backgroundColor: GREEN, borderRadius: 16, padding: 16, marginBottom: 14 },
  heroTitle: { color: WHITE, fontSize: 17, fontWeight: "900" },
  heroSubtitle: { color: GREEN_LIGHT, fontSize: 11, lineHeight: 16, marginTop: 5 },
  toggleWrap: { flexDirection: "row", backgroundColor: BG, borderRadius: 14, padding: 4, marginBottom: 14 },
  toggleSide: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 11 },
  toggleSideActive: { backgroundColor: GREEN },
  toggleText: { color: MUTED, fontSize: 12, fontWeight: "900" },
  toggleTextActive: { color: WHITE },
  couponBox: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 12, marginBottom: 14 },
  couponLabel: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 8 },
  couponRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  couponInput: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, color: TEXT, fontSize: 13, backgroundColor: WHITE },
  couponInputApplied: { opacity: 0.55 },
  applyBtn: { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  applyBtnDisabled: { opacity: 0.5 },
  applyBtnText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  couponSuccess: { color: GREEN, fontSize: 11, fontWeight: "800", marginTop: 8 },
  couponError: { color: ORANGE, fontSize: 11, fontWeight: "800", marginTop: 8 },
  sectionLabel: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.9, marginBottom: 10 },
  planRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 14 },
  trustRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  trustTile: { flex: 1, backgroundColor: BG, borderRadius: 12, paddingVertical: 10, alignItems: "center", gap: 5 },
  trustLabel: { color: MUTED, fontSize: 8, fontWeight: "800", textAlign: "center" },
  legal: { color: MUTED, fontSize: 9, lineHeight: 14, textAlign: "center" },
  link: { color: GREEN, textDecorationLine: "underline", fontWeight: "900" },
});
