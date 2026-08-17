import { useCallback, useRef, useState } from "react";
import Constants from "expo-constants";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { submitFeedback } from "../api/feedback";
import { getProfile } from "../api/user";
import { BottomSheetPicker } from "../components/BottomSheetPicker";
import DevSubscriptionToggle from "../components/DevSubscriptionToggle";
import { ScreenContainer } from "../components/ScreenContainer";
import { TIER_COLORS } from "../constants/tierColors";
import { useLanguageStore } from "../i18n/languageStore";
import { signOutSession } from "../services/authService";
import { useAuthStore } from "../store/authStore";
import { useSubscriptionStore } from "../store/subscriptionStore";
import type { PlanTier } from "../types/subscription";
import { logicalRow, textAlignStart } from "../utils/rtl";
import { navigationRef } from "../navigation/navigationRef";
import { useFeatureAccess } from "../hooks/useFeatureAccess";

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
];

const GREEN = "#0F6E56";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { hasFeatureAccess } = useFeatureAccess();
  const canManageFasting = hasFeatureAccess("fasting_aware_meals");
  const language = useLanguageStore((s) => s.explicitLanguage || s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const token = useAuthStore((s) => s.token);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [userId, setUserId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSubject, setFeedbackSubject] = useState("");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const fetchPayments = useSubscriptionStore((s) => s.fetchPayments);
  const subscriptionTier: PlanTier = useSubscriptionStore((s) => s.subscription?.tier ?? "FREE");
  const subscriptionColors = TIER_COLORS[subscriptionTier];

  const handleVersionTap = () => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (tapCount.current >= 3) {
      tapCount.current = 0;
      navigation.navigate("AdminStack");
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, 800);
  };

  const loadUser = useCallback(async () => {
    if (!token) return;
    try {
      const profile = await getProfile();
      setUserId(String(profile?.id ?? ""));
      setUserEmail(String(profile?.email ?? ""));
    } catch {
      // keep prior values
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadUser();
    }, [loadUser]),
  );

  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void fetchSubscription(userId);
        void fetchPayments(userId);
      }
    }, [userId, fetchSubscription, fetchPayments]),
  );

  const onSubmitFeedback = async () => {
    const subject = feedbackSubject.trim();
    const body = feedbackBody.trim();
    if (!subject) {
      Alert.alert(t("profile.alerts.validation"), t("profile.alerts.subjectRequired"));
      return;
    }
    if (!body) {
      Alert.alert(t("profile.alerts.validation"), t("profile.alerts.bodyRequired"));
      return;
    }
    try {
      setSendingFeedback(true);
      await submitFeedback({ subject, body });
      setFeedbackSent(true);
    } catch (error) {
      const message =
        error && typeof error === "object" && "response" in error
          ? String((error as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : "";
      Alert.alert(t("profile.alerts.error"), message || t("profile.alerts.feedbackFailed"));
    } finally {
      setSendingFeedback(false);
    }
  };

  return (
    <ScreenContainer bg={SCREEN_BG} contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={styles.headerTextBlock}>
          <Text style={styles.title}>{t("settings.screenTitle")}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {userId ? (
          <Pressable
            style={[
              styles.subscriptionsButton,
              {
                backgroundColor: subscriptionColors.cardBg,
                borderColor: subscriptionColors.cardBorder,
              },
            ]}
            onPress={() => navigation.navigate("PlanPicker")}
          >
            <View style={[styles.subscriptionsIconTile, { backgroundColor: subscriptionColors.badgeBg }]}>
              <Text style={{ fontSize: 18 }}>⭐</Text>
            </View>
            <View style={styles.subscriptionsCopy}>
              <View style={styles.subscriptionsTitleRow}>
                <Text
                  style={[styles.subscriptionsTitle, { color: subscriptionColors.titleColor }]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                >
                  {t("profile.subscriptions")}
                </Text>
                <View style={[styles.subscriptionsPlanBadge, { backgroundColor: subscriptionColors.badgeBg }]}>
                  <Text
                    style={[styles.subscriptionsPlanBadgeText, { color: subscriptionColors.badgeText }]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {subscriptionTier}
                  </Text>
                </View>
              </View>
              <Text style={[styles.subscriptionsSubtitle, { color: subscriptionColors.mutedText }]} numberOfLines={3}>
                {t("profile.subscriptionsSubtitle")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={subscriptionColors.cardBorder} />
          </Pressable>
        ) : null}

        <View style={styles.footerCard}>
          {__DEV__ ? (
            <Pressable style={styles.footerRow} onPress={() => navigation.navigate("AdminStack")}>
              <View style={styles.footerIconTile}>
                <Text style={styles.footerEmoji}>🔧</Text>
              </View>
              <Text style={styles.footerLabel}>{t("profile.goToAdmin")}</Text>
              <Text style={styles.footerChevron}>›</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.footerRow} onPress={() => navigation.navigate("MySupplementStack")}>
            <View style={styles.footerIconTile}>
              <Text style={styles.footerEmoji}>💊</Text>
            </View>
            <Text style={styles.footerLabel}>{t("social.stacks.open")}</Text>
            <Text style={styles.footerChevron}>›</Text>
          </Pressable>
          <Pressable style={styles.footerRow} onPress={() => navigationRef.navigate("AITrainerCalibration" as never)}>
            <View style={styles.footerIconTile}>
              <Text style={styles.footerEmoji}>🧍</Text>
            </View>
            <Text style={styles.footerLabel}>
              {t("aiTrainer.calibrate_profile", { defaultValue: "AI trainer calibration" })}
            </Text>
            <Text style={styles.footerChevron}>›</Text>
          </Pressable>
          <Pressable
            style={styles.footerRow}
            onPress={() => {
              setFeedbackSent(false);
              setFeedbackOpen(true);
            }}
          >
            <View style={styles.footerIconTile}>
              <Text style={styles.footerEmoji}>💬</Text>
            </View>
            <Text style={styles.footerLabel}>{t("profile.feedback")}</Text>
            <Text style={styles.footerChevron}>›</Text>
          </Pressable>
          <Pressable style={styles.footerRow} onPress={() => navigation.navigate("NotificationPreferences")}>
            <View style={styles.footerIconTile}>
              <Text style={styles.footerEmoji}>🔔</Text>
            </View>
            <Text style={styles.footerLabel}>{t("profile.notificationPreferences")}</Text>
            <Text style={styles.footerChevron}>›</Text>
          </Pressable>
          {canManageFasting ? (
            <Pressable style={styles.footerRow} onPress={() => navigation.navigate("FastingPreferences")}>
              <View style={styles.footerIconTile}>
                <Text style={styles.footerEmoji}>🪔</Text>
              </View>
              <Text style={styles.footerLabel}>{t("profile.fastingPreferences")}</Text>
              <Text style={styles.footerChevron}>›</Text>
            </Pressable>
          ) : null}
          <View style={styles.footerPickerRow}>
            <View style={styles.footerIconTile}>
              <Text style={styles.footerEmoji}>🌐</Text>
            </View>
            <View style={styles.footerPickerContent}>
              <Text style={styles.footerLabel}>{t("profile.language")}</Text>
              <BottomSheetPicker
                label={t("profile.language")}
                value={language}
                options={LANGUAGE_OPTIONS}
                onChange={(value) => {
                  if (typeof value === "string") void setLanguage(value);
                }}
                placeholder={t("profile.languagePlaceholder")}
              />
            </View>
          </View>
          <TouchableOpacity
            onPress={handleVersionTap}
            activeOpacity={1}
            hitSlop={{ top: 20, bottom: 20, left: 40, right: 40 }}
            style={styles.versionWrap}
          >
            <Text style={styles.versionText}>{t("profile.version", { version: APP_VERSION })}</Text>
          </TouchableOpacity>
          <Pressable style={[styles.footerRow, styles.footerRowLast]} onPress={() => void signOutSession()}>
            <View style={styles.logoutIconTile}>
              <Text style={styles.footerEmoji}>🚪</Text>
            </View>
            <Text style={styles.logoutText}>{t("profile.logout")}</Text>
            <Text style={styles.logoutChevron}>›</Text>
          </Pressable>
        </View>

        <DevSubscriptionToggle email={userEmail} userId={userId} />
      </ScrollView>

      <Modal visible={feedbackOpen} transparent animationType="slide" onRequestClose={() => setFeedbackOpen(false)}>
        <View style={styles.modalBackdropBottom}>
          <View style={styles.feedbackSheet}>
            {feedbackSent ? (
              <View style={styles.feedbackSentWrap}>
                <View style={[styles.feedbackTickCircle, { backgroundColor: "rgba(85,181,106,0.16)" }]}>
                  <Text style={styles.feedbackTick}>✓</Text>
                </View>
                <Text style={[styles.feedbackTitle, { textAlign: "center", marginBottom: 6 }]}>{t("profile.feedbackSent")}</Text>
                <Text style={[styles.feedbackSub, { textAlign: "center" }]}>{t("profile.feedbackSentBody")}</Text>
                <View style={styles.feedbackActions}>
                  <Pressable
                    style={styles.feedbackActionBtn}
                    onPress={() => {
                      setFeedbackOpen(false);
                      setFeedbackSent(false);
                      setFeedbackSubject("");
                      setFeedbackBody("");
                    }}
                  >
                    <Text style={styles.feedbackCancelText}>{t("profile.close")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.feedbackTitle}>{t("profile.sendFeedback")}</Text>
                <Text style={styles.feedbackSub}>{t("profile.feedbackSub")}</Text>
                <View style={styles.feedbackField}>
                  <Text style={styles.editLabel}>{t("profile.subject")}</Text>
                  <TextInput
                    value={feedbackSubject}
                    onChangeText={setFeedbackSubject}
                    placeholder={t("profile.subjectPlaceholder")}
                    placeholderTextColor={MUTED}
                    style={styles.feedbackInput}
                  />
                </View>
                <View style={styles.feedbackField}>
                  <Text style={styles.editLabel}>{t("profile.body")}</Text>
                  <TextInput
                    value={feedbackBody}
                    onChangeText={setFeedbackBody}
                    placeholder={t("profile.bodyPlaceholder")}
                    placeholderTextColor={MUTED}
                    multiline
                    textAlignVertical="top"
                    style={styles.feedbackBodyInput}
                  />
                </View>
                <View style={styles.feedbackActions}>
                  <Pressable style={styles.feedbackActionBtn} onPress={() => setFeedbackOpen(false)} disabled={sendingFeedback}>
                    <Text style={styles.feedbackCancelText}>{t("common.cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.feedbackActionBtn, styles.feedbackSendBtn]}
                    onPress={() => void onSubmitFeedback()}
                    disabled={sendingFeedback}
                  >
                    <Text style={styles.feedbackSendText}>{sendingFeedback ? t("profile.sending") : t("profile.send")}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { flexDirection: "row", alignItems: "center", paddingTop: 8, paddingBottom: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  backBtnText: { color: TEXT, fontSize: 18, fontWeight: "900" },
  headerTextBlock: { flex: 1 },
  title: { color: TEXT, fontSize: 22, fontWeight: "900" },
  scrollContent: { paddingBottom: 24 },
  subscriptionsButton: {
    borderRadius: 16,
    padding: 15,
    flexDirection: logicalRow,
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    marginBottom: 14,
  },
  subscriptionsCopy: { flex: 1, minWidth: 0 },
  subscriptionsIconTile: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  subscriptionsTitleRow: { flexDirection: logicalRow, alignItems: "center", gap: 7, flexWrap: "wrap" },
  subscriptionsTitle: { flexShrink: 1, minWidth: 0, fontSize: 14, lineHeight: 17, fontWeight: "800", textAlign: textAlignStart },
  subscriptionsPlanBadge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, maxWidth: "100%" },
  subscriptionsPlanBadgeText: { fontSize: 9, lineHeight: 11, fontWeight: "800", textAlign: "center" },
  subscriptionsSubtitle: { fontSize: 10, lineHeight: 14, marginTop: 2, textAlign: textAlignStart },
  footerCard: { backgroundColor: BG, borderRadius: 16, padding: 8, gap: 2, marginBottom: 14 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  footerPickerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  footerPickerContent: { flex: 1, gap: 8 },
  footerRowLast: { borderBottomWidth: 0, backgroundColor: ORANGE_LIGHT, borderRadius: 12, marginTop: 2 },
  footerIconTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutIconTile: { width: 34, height: 34, borderRadius: 10, backgroundColor: ORANGE_LIGHT, alignItems: "center", justifyContent: "center" },
  footerEmoji: { fontSize: 16 },
  footerLabel: { flex: 1, color: TEXT, fontSize: 13, fontWeight: "800" },
  footerChevron: { color: GREEN, fontSize: 20 },
  logoutText: { flex: 1, color: ORANGE, fontSize: 13, fontWeight: "900" },
  logoutChevron: { color: ORANGE, fontSize: 20 },
  versionWrap: { alignItems: "center", paddingVertical: 8 },
  versionText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  modalBackdropBottom: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" },
  feedbackSheet: { backgroundColor: WHITE, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  feedbackTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 4 },
  feedbackSub: { color: MUTED, fontSize: 11, marginBottom: 10 },
  feedbackField: { marginBottom: 10 },
  editLabel: { color: MUTED, fontSize: 10, marginBottom: 5, fontWeight: "800" },
  feedbackInput: {
    color: TEXT,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: WHITE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  feedbackBodyInput: {
    color: TEXT,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: WHITE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 13,
    minHeight: 110,
  },
  feedbackActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  feedbackActionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  feedbackSendBtn: { backgroundColor: GREEN, borderColor: GREEN },
  feedbackCancelText: { color: TEXT, fontSize: 13, fontWeight: "800" },
  feedbackSendText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  feedbackSentWrap: { alignItems: "center", paddingVertical: 6 },
  feedbackTickCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  feedbackTick: { color: GREEN, fontSize: 42, fontWeight: "900", lineHeight: 44 },
});
