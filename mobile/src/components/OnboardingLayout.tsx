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
import { ONBOARDING_COLORS } from "../constants/onboarding";

export const OnboardingLayout = ({
  step,
  title,
  subtitle,
  onBack,
  onNext,
  nextLabel = "Next",
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
              const bg = i < step ? ONBOARDING_COLORS.success : i === step ? ONBOARDING_COLORS.primary : ONBOARDING_COLORS.border;
              return <View key={i} style={[styles.segment, { backgroundColor: bg }]} />;
            })}
          </View>
          <View style={styles.kickerRow}>
            <Text style={styles.kicker}>{`SCREEN ${step} OF 6`}</Text>
            {onSaveExit ? (
              <Pressable
                style={[styles.saveBtn, (saveDisabled || saveLoading) && styles.saveBtnDisabled]}
                onPress={handleSaveExit}
                disabled={saveDisabled || saveLoading}
              >
                {saveLoading ? <ActivityIndicator size="small" color={ONBOARDING_COLORS.bg} /> : <Text style={styles.saveText}>Save</Text>}
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
            {hideBack ? <View style={styles.spacer} /> : <Pressable style={styles.backBtn} onPress={onBack}><Text style={styles.backText}>Back</Text></Pressable>}
            <Text style={styles.counter} pointerEvents="none">{`${step} / 6`}</Text>
            <Pressable
              style={[styles.nextBtn, (nextDisabled || nextLoading) && styles.nextBtnDisabled]}
              onPress={handleNext}
              disabled={nextDisabled || nextLoading}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(nextDisabled || nextLoading) }}
            >
              {nextLoading ? (
                <ActivityIndicator color={ONBOARDING_COLORS.bg} />
              ) : (
                <Text style={styles.nextText}>{nextLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ONBOARDING_COLORS.bg },
  topPad: { paddingHorizontal: 16, paddingTop: 8 },
  progressRow: { flexDirection: "row", gap: 6, marginBottom: 14 },
  kickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  kicker: { fontSize: 12, color: ONBOARDING_COLORS.textTertiary, letterSpacing: 1.2, textTransform: "uppercase" },
  saveBtn: {
    minWidth: 72,
    height: 32,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveText: { color: ONBOARDING_COLORS.bg, fontWeight: "700", fontSize: 13 },
  title: { marginTop: 6, fontSize: 28, fontWeight: "700", color: ONBOARDING_COLORS.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 15, color: ONBOARDING_COLORS.textSecondary, lineHeight: 22, marginBottom: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 14 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: ONBOARDING_COLORS.border,
    padding: 12,
    backgroundColor: ONBOARDING_COLORS.bg,
    zIndex: 20,
    elevation: 12,
  },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, zIndex: 21 },
  backBtn: {
    height: 52,
    borderRadius: 10,
    borderColor: ONBOARDING_COLORS.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    flex: 1,
  },
  backText: { color: ONBOARDING_COLORS.textPrimary, fontSize: 15 },
  nextBtn: { height: 52, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", flex: 1 },
  nextBtnDisabled: { opacity: 0.65 },
  nextText: { color: ONBOARDING_COLORS.bg, fontSize: 15, fontWeight: "600" },
  counter: { color: ONBOARDING_COLORS.textTertiary, fontSize: 14, minWidth: 40, textAlign: "center" },
  spacer: { flex: 1 },
});
