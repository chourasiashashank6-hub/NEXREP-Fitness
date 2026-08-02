import { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { logicalRow, textAlignStart } from "../utils/rtl";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GOLD = "#FFD700";
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
          <View style={styles.kickerRow}>
            <Text style={styles.kicker}>{t("onboarding.layout.screenCounter", { step })}</Text>
            {onSaveExit ? (
              <Pressable
                style={[styles.saveBtn, (saveDisabled || saveLoading) && styles.saveBtnDisabled]}
                onPress={handleSaveExit}
                disabled={saveDisabled || saveLoading}
              >
                {saveLoading ? (
                  <ActivityIndicator size="small" color={GREEN} />
                ) : (
                  <Text style={styles.saveText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
                    {t("common.save")}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>

        <View style={styles.footer}>
          {extraFooter}
          <View style={styles.navRow}>
            {hideBack ? (
              <View style={styles.spacer} />
            ) : (
              <Pressable style={styles.backBtn} onPress={onBack}>
                <Text style={styles.backText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {t("common.back")}
                </Text>
              </Pressable>
            )}
            <Text style={styles.counter} pointerEvents="none">{t("onboarding.layout.stepCounter", { step })}</Text>
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
                  {step === 6 ? t("onboarding.layout.saveAndExit") : t("onboarding.layout.nextArrow", { label: nextLabel ?? t("common.next") })}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SCREEN_BG },
  topPad: { paddingHorizontal: 16, paddingTop: 8 },
  progressRow: { flexDirection: logicalRow, gap: 3, marginBottom: 14 },
  kickerRow: { flexDirection: logicalRow, alignItems: "center", justifyContent: "space-between", gap: 10 },
  segment: { flex: 1, height: 4, borderRadius: 99 },
  kicker: { flex: 1, minWidth: 0, fontSize: 13, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: "700", textAlign: textAlignStart },
  saveBtn: {
    minWidth: 64,
    minHeight: 32,
    maxWidth: "42%",
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN_LIGHT,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveText: { color: GREEN, fontWeight: "800", fontSize: 13, textAlign: "center" },
  title: { marginTop: 10, fontSize: 20, fontWeight: "800", color: TEXT, marginBottom: 5 },
  subtitle: { fontSize: 11, color: MUTED, lineHeight: 17, marginBottom: 14 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 18 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    padding: 12,
    backgroundColor: WHITE,
    zIndex: 20,
    elevation: 12,
  },
  navRow: { flexDirection: logicalRow, alignItems: "center", justifyContent: "space-between", gap: 8, zIndex: 21 },
  backBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    flex: 1,
    minWidth: 0,
  },
  backText: { color: MUTED, fontSize: 15, fontWeight: "800", textAlign: "center" },
  nextBtn: { minHeight: 48, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", flex: 1, minWidth: 0, paddingHorizontal: 8 },
  nextBtnDisabled: { opacity: 0.65 },
  nextText: { color: WHITE, fontSize: 15, fontWeight: "800", textAlign: "center" },
  counter: { color: MUTED, fontSize: 14, minWidth: 34, flexShrink: 0, textAlign: "center", fontWeight: "700" },
  spacer: { flex: 1, minWidth: 0 },
});
