import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import type { AppTheme } from "../theme/colors";
import { VALID_COUPON } from "../constants/plans";

export type CouponApplyResult = { ok: true } | { ok: false; error: string };

/** Validates trimmed / uppercased coupon against `VALID_COUPON`. */
export function runCouponApply(code: string): CouponApplyResult {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) {
    return { ok: false, error: i18n.t("components.couponInput.emptyCode") };
  }
  if (trimmed !== VALID_COUPON) {
    return { ok: false, error: i18n.t("components.couponInput.invalidCode") };
  }
  return { ok: true };
}

export type CouponInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  applied: boolean;
  error: string;
  onApply: () => void;
  onClear: () => void;
  theme: AppTheme;
};

/** Tab bar & highlights — matches main app chrome. */
const ACCENT_MINT = "#00e5a0";

export function CouponInput({ value, onChangeText, applied, error, onApply, onClear, theme }: CouponInputProps) {
  const { t } = useTranslation();
  const { colors, radius } = theme;

  return (
    <View style={[styles.box, { borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[styles.label, { color: colors.muted }]}>{t("components.couponInput.label")}</Text>
      <View style={styles.row}>
        <View style={styles.inputWrap}>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={t("components.couponInput.placeholder")}
            placeholderTextColor={colors.muted}
            editable={!applied}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBg,
                color: colors.text,
                borderColor: colors.border,
                borderRadius: radius.md - 2,
                opacity: applied ? 0.55 : 1,
                paddingRight: applied ? 44 : 12,
              },
            ]}
          />
          {applied ? (
            <Pressable
              onPress={onClear}
              style={({ pressed }) => [
                styles.clearBtn,
                {
                  backgroundColor: colors.cardAlt,
                  borderColor: colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("components.couponInput.remove")}
            >
              <Text style={[styles.clearBtnText, { color: colors.text }]}>×</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onApply}
          disabled={applied}
          style={({ pressed }) => [
            styles.applyBtn,
            {
              backgroundColor: applied ? colors.tabInactive : ACCENT_MINT,
              borderRadius: radius.md - 2,
              opacity: pressed && !applied ? 0.88 : 1,
            },
          ]}
        >
          <Text style={styles.applyText}>{t("components.couponInput.apply")}</Text>
        </Pressable>
      </View>
      {applied ? (
        <Text style={[styles.successMsg, { color: ACCENT_MINT }]}>{t("components.couponInput.success")}</Text>
      ) : error ? (
        <Text style={[styles.errorMsg, { color: colors.errorInline }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 14,
    marginBottom: 20,
  },
  label: {
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
    textTransform: "uppercase",
    marginBottom: 10,
    letterSpacing: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inputWrap: {
    flex: 1,
    position: "relative",
    justifyContent: "center",
  },
  input: {
    borderWidth: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    minHeight: 44,
  },
  applyBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 44,
  },
  clearBtn: {
    position: "absolute",
    right: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    lineHeight: 18,
  },
  applyText: {
    color: "#0b1220",
    fontFamily: "DMSans_600SemiBold",
    fontSize: 13,
  },
  successMsg: {
    marginTop: 10,
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
  },
  errorMsg: {
    marginTop: 10,
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
  },
});
