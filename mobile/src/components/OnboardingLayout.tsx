import { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { UnsavedOnboardingModal } from "./UnsavedOnboardingModal";
import { useOnboardingCancel } from "../hooks/useOnboardingCancel";
import { useOnboardingContext } from "../hooks/OnboardingContext";
import { logicalRow, textAlignStart } from "../utils/rtl";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

export const OnboardingLayout = ({
  step,
  title,
  subtitle,
  onBack,
  onNext,
  nextLabel,
  hideBack,
  extraFooter,
  nextLoading,
  nextDisabled,
  onSaveExit,
  saveLoading,
  saveDisabled,
  children,
}: PropsWithChildren<{
  step: number;
  title: string;
  subtitle: string;
  onBack?: () => void;
  onNext: () => void | Promise<void>;
  nextLabel?: string;
  hideBack?: boolean;
  extraFooter?: ReactNode;
  nextLoading?: boolean;
  nextDisabled?: boolean;
  onSaveExit?: () => void | Promise<void>;
  saveLoading?: boolean;
  saveDisabled?: boolean;
}>) => {
  const { t } = useTranslation();
  const { isHydrating } = useOnboardingContext();
  const { requestCancel, discardAndExit, keepEditing, modalVisible, changes } = useOnboardingCancel();

  const handleNext = () => {
    Keyboard.dismiss();
    const result = onNext();
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch((err: unknown) => {
        console.warn("[OnboardingLayout] onNext rejected", err);
      });
    }
  };

  const handleSaveExit = () => {
    if (!onSaveExit) return;
    Keyboard.dismiss();
    const result = onSaveExit();
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch((err: unknown) => {
        console.warn("[OnboardingLayout] onSaveExit rejected", err);
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topPad}>
          <View style={styles.progressRow}>
            {Array.from({ length: 6 }, (_, idx) => {
              const i = idx + 1;
              const bg = i <= step ? GREEN : TRACK;
              return <View key={i} style={[styles.segment, { backgroundColor: bg }]} />;
            })}
          </View>
          <Text style={styles.kicker}>{t("onboarding.layout.screenCounter", { step })}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {isHydrating ? (
            <View style={styles.hydratingWrap}>
              <ActivityIndicator color={GREEN} size="large" />
              <Text style={styles.hydratingText}>{t("onboarding.layout.loading")}</Text>
            </View>
          ) : (
            children
          )}
        </ScrollView>

        <View style={styles.footer}>
          {extraFooter}
          <View style={styles.navRow}>
            <View style={styles.leftCol}>
              <Pressable style={styles.cancelBtn} onPress={requestCancel} hitSlop={8}>
                <Text style={styles.cancelText}>{t("common.cancel")}</Text>
              </Pressable>
              {!hideBack && onBack ? (
                <Pressable style={styles.backBtn} onPress={onBack} hitSlop={8}>
                  <Text style={styles.backText}>{t("common.back")}</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.counter} pointerEvents="none">
              {t("onboarding.layout.stepCounter", { step })}
            </Text>

            <View style={styles.rightCol}>
              {onSaveExit ? (
                <Pressable
                  style={[styles.saveBtn, (saveDisabled || saveLoading) && styles.actionBtnDisabled]}
                  onPress={handleSaveExit}
                  disabled={saveDisabled || saveLoading}
                >
                  {saveLoading ? (
                    <ActivityIndicator size="small" color={GREEN} />
                  ) : (
                    <Text style={styles.saveText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                      {t("common.save")}
                    </Text>
                  )}
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.nextBtn, (nextDisabled || nextLoading) && styles.nextBtnDisabled]}
                onPress={handleNext}
                disabled={nextDisabled || nextLoading}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(nextDisabled || nextLoading) }}
              >
                {nextLoading ? (
                  <ActivityIndicator color={WHITE} />
                ) : (
                  <Text style={styles.nextText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
                    {step === 6
                      ? t("onboarding.layout.saveAndExit")
                      : t("onboarding.layout.nextArrow", { label: nextLabel ?? t("common.next") })}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <UnsavedOnboardingModal
        visible={modalVisible}
        changes={changes}
        onDiscard={discardAndExit}
        onKeepEditing={keepEditing}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SCREEN_BG },
  topPad: { paddingHorizontal: 16, paddingTop: 8 },
  progressRow: { flexDirection: logicalRow, gap: 3, marginBottom: 14 },
  segment: { flex: 1, height: 4, borderRadius: 99 },
  kicker: {
    fontSize: 13,
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontWeight: "700",
    textAlign: textAlignStart,
    marginBottom: 4,
  },
  title: { marginTop: 6, fontSize: 20, fontWeight: "800", color: TEXT, marginBottom: 5 },
  subtitle: { fontSize: 11, color: MUTED, lineHeight: 17, marginBottom: 14 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 18 },
  hydratingWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
  hydratingText: { color: MUTED, fontSize: 14, fontWeight: "700" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    padding: 12,
    backgroundColor: WHITE,
    zIndex: 20,
    elevation: 12,
  },
  navRow: { flexDirection: logicalRow, alignItems: "flex-end", justifyContent: "space-between", gap: 8, zIndex: 21 },
  leftCol: { flex: 1, minWidth: 0, gap: 4, alignItems: "flex-start" },
  rightCol: { flex: 1.35, minWidth: 0, flexDirection: logicalRow, gap: 8, justifyContent: "flex-end" },
  cancelBtn: { minHeight: 40, justifyContent: "center", paddingHorizontal: 2 },
  cancelText: { color: ORANGE, fontSize: 15, fontWeight: "800" },
  backBtn: { minHeight: 32, justifyContent: "center", paddingHorizontal: 2 },
  backText: { color: MUTED, fontSize: 13, fontWeight: "700" },
  saveBtn: {
    minWidth: 68,
    minHeight: 48,
    maxWidth: "46%",
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN_LIGHT,
    flex: 1,
  },
  saveText: { color: GREEN, fontWeight: "800", fontSize: 14, textAlign: "center" },
  actionBtnDisabled: { opacity: 0.7 },
  nextBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
    flex: 1.2,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  nextBtnDisabled: { opacity: 0.65 },
  nextText: { color: WHITE, fontSize: 15, fontWeight: "800", textAlign: "center" },
  counter: { color: MUTED, fontSize: 14, minWidth: 34, flexShrink: 0, textAlign: "center", fontWeight: "700", paddingBottom: 14 },
});
