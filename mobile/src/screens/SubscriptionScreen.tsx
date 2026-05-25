import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useFonts, BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from "@expo-google-fonts/dm-sans";
import { StatusBar } from "expo-status-bar";

import { CouponInput, runCouponApply } from "../components/CouponInput";
import { PlanCard } from "../components/PlanCard";
import { getOriginalPrice, getPrice, PLANS, type PlanId } from "../constants/plans";
import type { ProfileStackParamList } from "../navigation/types";
import type { AppTheme } from "../theme/colors";
import { useAppTheme } from "../theme";

/** Matches bottom-tab active tint & highlights across the app */
const ACCENT_MINT = "#00e5a0";
const ACCENT_BLUE = "#00aaff";
const BG_MAIN = "#080c12";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT_MUTED = "rgba(255,255,255,0.35)";

const DEFAULT_TERMS_URL = "https://nexrep.app/terms";
const DEFAULT_PRIVACY_URL = "https://nexrep.app/privacy";

export type SubscriptionScreenProps = {
  onSelectPlan?: (planId: PlanId, price: number, isYearly: boolean) => void;
  onPressTerms?: () => void;
  onPressPrivacy?: () => void;
  termsUrl?: string;
  privacyUrl?: string;
};

export function SubscriptionScreen({
  onSelectPlan,
  onPressTerms,
  onPressPrivacy,
  termsUrl = DEFAULT_TERMS_URL,
  privacyUrl = DEFAULT_PRIVACY_URL,
}: SubscriptionScreenProps) {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, "Subscription">>();
  const theme = useAppTheme();
  const { colors, spacing } = theme;

  const [fontsLoaded] = useFonts({ BebasNeue_400Regular, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold });

  const [isYearly, setIsYearly] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponError, setCouponError] = useState("");

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
      const price = getPrice(plan, isYearly, couponApplied);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSelectPlan?.(planId, price, isYearly);
      navigation.navigate("Payment", { planId, displayPrice: price, isYearly });
    },
    [couponApplied, isYearly, navigation, onSelectPlan],
  );

  const proPlan = useMemo(() => PLANS.find((p) => p.id === "pro")!, []);
  const elitePlan = useMemo(() => PLANS.find((p) => p.id === "elite")!, []);

  const proPrice = getPrice(proPlan, isYearly, couponApplied);
  const elitePrice = getPrice(elitePlan, isYearly, couponApplied);
  const proOriginal = couponApplied ? getOriginalPrice(proPlan, isYearly) : null;
  const eliteOriginal = couponApplied ? getOriginalPrice(elitePlan, isYearly) : null;

  if (!fontsLoaded) {
    return (
      <View style={[styles.loading, { backgroundColor: BG_MAIN }]}>
        <ActivityIndicator size="large" color={ACCENT_MINT} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: BG_MAIN }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingBottom: 36,
          paddingTop: 8,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={[styles.backBtnText, { color: colors.text }]}>Back</Text>
        </Pressable>

        <HeaderSection theme={theme} />

        <BillingToggle theme={theme} isYearly={isYearly} onToggle={setIsYearly} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          <CouponInput
            value={couponCode}
            onChangeText={(t) => {
              setCouponCode(t);
              if (couponError) setCouponError("");
            }}
            applied={couponApplied}
            error={couponError}
            onApply={handleApplyCoupon}
            onClear={handleClearCoupon}
            theme={theme}
          />
        </KeyboardAvoidingView>

        <Text style={[styles.sectionLabel, { color: TEXT_MUTED }]}>Choose your plan</Text>
        <View style={styles.planRow}>
          <PlanCard
            plan={proPlan}
            displayPrice={proPrice}
            originalPrice={proOriginal}
            isYearly={isYearly}
            featured={false}
            onSelect={() => handleSelectPlan("pro")}
            theme={theme}
          />
          <PlanCard
            plan={elitePlan}
            displayPrice={elitePrice}
            originalPrice={eliteOriginal}
            isYearly={isYearly}
            featured={true}
            onSelect={() => handleSelectPlan("elite")}
            theme={theme}
          />
        </View>

        <TrustBadges theme={theme} />
        <ReviewCard theme={theme} />
        <FooterLinks theme={theme} onTerms={openTerms} onPrivacy={openPrivacy} />
      </ScrollView>
    </SafeAreaView>
  );
}

function HeaderSection({ theme }: { theme: AppTheme }) {
  const { colors, radius } = theme;

  return (
    <LinearGradient
      colors={["#0f1620", "#111D33"]}
      style={[
        styles.heroBanner,
        {
          borderRadius: radius.xl,
          borderColor: BORDER,
        },
      ]}
    >
      <View style={styles.logoRow}>
        <View style={[styles.logoMark, { backgroundColor: ACCENT_BLUE }]}>
          <Ionicons name="barbell" size={22} color="#FFFFFF" />
        </View>
        <Text
          style={[styles.logoText, { color: colors.text, fontFamily: "BebasNeue_400Regular", letterSpacing: 3 }]}
        >
          NEXREP
        </Text>
      </View>
      <View style={[styles.badgeRed, { backgroundColor: "rgba(0,229,160,0.14)" }]}>
        <Text style={styles.badgeRedText}>UNLOCK YOUR POTENTIAL</Text>
      </View>
      <Text style={[styles.headline, { color: colors.text }]}>
        Train Smarter. Go <Text style={{ color: ACCENT_MINT }}>PRO</Text>.
      </Text>
      <Text style={[styles.subtext, { color: TEXT_MUTED }]}>
        {`Join 50,000+ athletes who've already leveled up`}
      </Text>
    </LinearGradient>
  );
}

function BillingToggle({
  theme,
  isYearly,
  onToggle,
}: {
  theme: AppTheme;
  isYearly: boolean;
  onToggle: (v: boolean) => void;
}) {
  const { colors, radius } = theme;

  return (
    <View
      style={[
        styles.billingCard,
        {
          backgroundColor: colors.cardAlt,
          borderColor: BORDER,
          borderRadius: radius.md,
        },
      ]}
    >
      <View style={styles.billingTop}>
        <Text style={[styles.billingLabel, { color: colors.text }]}>Monthly</Text>
        <Switch
          value={isYearly}
          onValueChange={onToggle}
          trackColor={{ false: colors.tabInactive, true: ACCENT_MINT }}
          thumbColor="#f4f4f5"
          ios_backgroundColor={colors.tabInactive}
        />
        <Text style={[styles.billingLabel, { color: colors.text }]}>Yearly</Text>
        {isYearly ? (
          <>
            <View style={{ flex: 1, minWidth: 8 }} />
            <View style={[styles.savePill, { backgroundColor: "rgba(0,229,160,0.14)" }]}>
              <Text style={[styles.savePillText, { color: ACCENT_MINT }]}>Save 17%</Text>
            </View>
          </>
        ) : null}
      </View>
      <Text style={[styles.priceHint, { color: TEXT_MUTED }]}>
        {isYearly
          ? "Pro ₹832/mo · Elite ₹1665/mo (billed yearly)"
          : "Pro ₹999/mo · Elite ₹1999/mo"}
      </Text>
    </View>
  );
}

function TrustBadges({ theme }: { theme: AppTheme }) {
  const { colors, radius } = theme;
  const items = [
    { icon: "shield-checkmark" as const, label: "Secure Payment" },
    { icon: "calendar-outline" as const, label: "7-Day Trial" },
    { icon: "people" as const, label: "50K+ Athletes" },
  ];

  return (
    <View style={[styles.trustRow, { marginBottom: 18 }]}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[
            styles.trustPill,
            {
              backgroundColor: colors.card,
              borderColor: BORDER,
              borderRadius: radius.md - 2,
            },
          ]}
        >
          <Ionicons name={item.icon} size={18} color={ACCENT_MINT} />
          <Text style={[styles.trustLabel, { color: TEXT_MUTED }]} numberOfLines={2}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ReviewCard({ theme }: { theme: AppTheme }) {
  const { colors, radius } = theme;

  return (
    <View
      style={[
        styles.reviewCard,
        {
          backgroundColor: colors.cardAlt,
          borderColor: BORDER,
          borderRadius: radius.md,
        },
      ]}
    >
      <LinearGradient
        colors={["rgba(0,229,160,0.08)", "transparent"]}
        style={[styles.reviewGlow, { borderRadius: radius.md }]}
        pointerEvents="none"
      />
      <View style={styles.reviewTop}>
        <LinearGradient colors={["#1B3A6F", ACCENT_BLUE]} style={styles.avatar}>
          <Text style={styles.avatarText}>RK</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={[styles.reviewName, { color: colors.text }]}>Rahul K.</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Ionicons key={i} name="star" size={14} color="#F5A524" />
            ))}
          </View>
        </View>
      </View>
      <Text style={[styles.quote, { color: colors.text }]}>
        &ldquo;NexRep PRO completely changed how I track lifts. The AI rep counter is ridiculously accurate.&rdquo;
      </Text>
    </View>
  );
}

function FooterLinks({
  theme,
  onTerms,
  onPrivacy,
}: {
  theme: AppTheme;
  onTerms: () => void;
  onPrivacy: () => void;
}) {
  const { colors } = theme;

  return (
    <View style={styles.footer}>
      <Text style={[styles.legal, { color: TEXT_MUTED }]}>
        Subscriptions renew automatically unless cancelled. By continuing you agree to our{" "}
        <Text onPress={onTerms} style={[styles.link, { color: ACCENT_MINT }]}>
          Terms
        </Text>{" "}
        and{" "}
        <Text onPress={onPrivacy} style={[styles.link, { color: ACCENT_MINT }]}>
          Privacy Policy
        </Text>
        .
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    marginBottom: 12,
    paddingVertical: 6,
    paddingRight: 12,
    paddingLeft: 2,
  },
  backBtnPressed: {
    opacity: 0.65,
  },
  backBtnText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 15,
  },
  heroBanner: {
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontFamily: "BebasNeue_400Regular",
    fontSize: 34,
    letterSpacing: 3,
  },
  badgeRed: {
    alignSelf: "flex-start",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 14,
  },
  badgeRedText: {
    color: ACCENT_MINT,
    fontFamily: "DMSans_600SemiBold",
    fontSize: 10,
    letterSpacing: 1.2,
  },
  headline: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 23,
    letterSpacing: 0.4,
    marginBottom: 8,
    lineHeight: 30,
  },
  subtext: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    lineHeight: 21,
  },
  billingCard: {
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 18,
  },
  billingTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  billingLabel: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 13,
  },
  savePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  savePillText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  priceHint: {
    fontFamily: "DMSans_400Regular",
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  planRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 22,
    alignItems: "flex-start",
  },
  trustRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  trustPill: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    borderWidth: 0.5,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  trustLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 10,
    textAlign: "center",
    lineHeight: 13,
  },
  reviewCard: {
    borderWidth: 0.5,
    padding: 16,
    marginBottom: 18,
    overflow: "hidden",
    position: "relative",
  },
  reviewGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  reviewTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    zIndex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontFamily: "DMSans_600SemiBold",
    fontSize: 15,
    letterSpacing: 0.5,
  },
  reviewName: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 15,
  },
  starsRow: {
    flexDirection: "row",
    gap: 2,
    marginTop: 4,
  },
  quote: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    lineHeight: 20,
    fontStyle: "italic",
    opacity: 0.95,
    zIndex: 1,
  },
  footer: {
    paddingTop: 6,
  },
  legal: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
  },
  link: {
    fontFamily: "DMSans_600SemiBold",
    textDecorationLine: "underline",
  },
});
