import { useCallback, useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";

import {
  PlanOverviewCard,
  SubscriptionHistorySection,
} from "../components/subscription/SubscriptionOverviewUI";
import type { ProfileStackParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";
import { useSubscriptionStore } from "../store/subscriptionStore";
import { logicalRow, textAlignStart } from "../utils/rtl";

const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const SCREEN_BG = "#FFFFFF";

export function SubscriptionScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, "Subscription">>();
  const userId = useAuthStore((s) => s.sessionUserId);
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const fetchPayments = useSubscriptionStore((s) => s.fetchPayments);

  useEffect(() => {
    if (!userId) return;
    void fetchSubscription(userId);
    void fetchPayments(userId);
  }, [userId, fetchSubscription, fetchPayments]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("ProfileMain");
  }, [navigation]);

  const handleManagePlan = useCallback(() => {
    if (!userId) return;
    navigation.navigate("ManageSubscription", { userId });
  }, [navigation, userId]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={t("subscription.overview.goBack")}
        >
          <Ionicons name="chevron-back" size={22} color={TEXT} />
          <Text style={styles.backBtnText}>{t("subscription.overview.back")}</Text>
        </Pressable>

        <Text style={styles.pageEyebrow}>{t("subscription.overview.eyebrow")}</Text>
        <Text style={styles.pageTitle}>{t("subscription.overview.title")}</Text>

        <PlanOverviewCard
          onManagePress={handleManagePlan}
          manageDisabled={!userId}
          showFreeTier
          showSectionLabel={false}
        />

        <SubscriptionHistorySection showSectionLabel={false} />

        <Text style={styles.footerNote}>{t("subscription.overview.footerNote")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SCREEN_BG },
  scroll: { flex: 1, backgroundColor: SCREEN_BG },
  content: { padding: 16, paddingBottom: 36, maxWidth: 860, width: "100%", alignSelf: "center" },
  backBtn: {
    flexDirection: logicalRow,
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    marginBottom: 12,
    paddingVertical: 6,
    paddingEnd: 8,
  },
  backBtnPressed: { opacity: 0.65 },
  backBtnText: { fontSize: 16, fontWeight: "700", color: TEXT },
  pageEyebrow: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textAlign: textAlignStart },
  pageTitle: { color: TEXT, fontSize: 24, fontWeight: "900", marginTop: 4, marginBottom: 14, textAlign: textAlignStart },
  footerNote: { color: MUTED, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 2 },
});
