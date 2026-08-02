import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { Plan } from "../constants/plans";
import { TIER_COLORS } from "../constants/tierColors";
import type { AppTheme } from "../theme/colors";
import { logicalRow, textAlignStart } from "../utils/rtl";

const ORANGE = "#D85A30";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";

export type PlanCardProps = {
  plan: Plan;
  displayPrice: number;
  originalPrice: number | null;
  isYearly: boolean;
  featured: boolean;
  onSelect: () => void;
  theme?: AppTheme;
  isCurrentPlan?: boolean;
};

export function PlanCard({ plan, displayPrice, originalPrice, isYearly, featured, onSelect, theme, isCurrentPlan = false }: PlanCardProps) {
  const { t } = useTranslation();
  const scale = useRef(new Animated.Value(1)).current;
  const tierColors = TIER_COLORS[plan.id.toUpperCase() as keyof typeof TIER_COLORS];

  useEffect(() => {
    scale.setValue(0.94);
    Animated.spring(scale, {
      toValue: 1,
      friction: 8,
      tension: 160,
      useNativeDriver: true,
    }).start();
  }, [displayPrice, scale]);

  const period = isYearly ? t("components.planCard.yearlyPeriod") : t("components.planCard.monthlyPeriod");

  return (
    <View style={[styles.wrapper, featured && styles.wrapperFeatured]}>
      {featured ? (
        <View style={[styles.popularBadge, { backgroundColor: ORANGE }]}>
          <Text style={styles.popularText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
            {t("components.planCard.mostPopular")}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={isCurrentPlan ? undefined : onSelect}
        disabled={isCurrentPlan}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: tierColors.cardBg,
            borderColor: tierColors.cardBorder,
            borderWidth: 1.5,
            borderRadius: 16,
            opacity: pressed && !isCurrentPlan ? 0.94 : 1,
          },
        ]}
      >
        {isCurrentPlan ? (
          <View style={styles.currentCornerBadge}>
            <Text style={[styles.currentCornerText, { color: tierColors.titleColor }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
              {t("components.planCard.currentPlan")}
            </Text>
          </View>
        ) : null}
        <View style={[styles.planBadge, { backgroundColor: tierColors.badgeBg }]}>
          <Text style={[styles.planBadgeText, { color: tierColors.badgeText }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {plan.name}
          </Text>
        </View>
        <Text style={[styles.desc, { color: tierColors.mutedText }]} numberOfLines={2}>
          {plan.desc}
        </Text>
        <View style={styles.priceBlock}>
          {originalPrice != null ? (
            <Text style={styles.originalPrice}>₹{originalPrice}</Text>
          ) : null}
          <Animated.View style={[styles.priceWrap, { transform: [{ scale }] }]}>
            <Text
              style={styles.price}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
            >
              ₹{displayPrice}
            </Text>
          </Animated.View>
          <Text style={styles.period}>{period}</Text>
        </View>
        {isCurrentPlan ? (
          <View style={[styles.currentPlanLabel, { borderColor: tierColors.cardBorder }]}>
            <Text style={[styles.currentPlanText, { color: tierColors.titleColor }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
              {t("components.planCard.activePlan")}
            </Text>
          </View>
        ) : (
          <View style={[styles.cta, { backgroundColor: tierColors.buttonBg }]}>
            <Text style={[styles.ctaText, { color: tierColors.buttonText }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
              {t("components.planCard.switchTo", { planName: plan.name })}
            </Text>
          </View>
        )}
        <View style={styles.features}>
          {plan.features.map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <Ionicons
                name={f.included ? "checkmark-circle" : "close-circle-outline"}
                size={15}
                color={f.included ? tierColors.checkColor : "#CCCCCC"}
              />
              <Text
                style={[
                  styles.featureText,
                  { color: f.included ? "#555555" : "#CCCCCC" },
                  !f.included && styles.featureMuted,
                ]}
                numberOfLines={2}
              >
                {f.label}
              </Text>
            </View>
          ))}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    paddingTop: 4,
  },
  wrapperFeatured: {
    marginTop: 8,
  },
  popularBadge: {
    position: "absolute",
    top: -12,
    alignSelf: "center",
    zIndex: 2,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    maxWidth: "90%",
  },
  popularText: {
    color: WHITE,
    fontFamily: "DMSans_600SemiBold",
    fontSize: 10,
    letterSpacing: 1,
    textAlign: "center",
  },
  card: {
    padding: 12,
    position: "relative",
  },
  planBadge: {
    alignSelf: "flex-start",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
    maxWidth: "100%",
  },
  planBadgeText: { fontFamily: "DMSans_600SemiBold", fontSize: 11, letterSpacing: 0.8, textAlign: "center" },
  currentCornerBadge: { position: "absolute", top: 12, end: 12, zIndex: 2, maxWidth: "44%" },
  currentCornerText: { fontSize: 9, lineHeight: 11, fontWeight: "900", textAlign: "center" },
  desc: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    minHeight: 34,
    lineHeight: 16,
    paddingEnd: 78,
    minWidth: 0,
    textAlign: textAlignStart,
  },
  priceBlock: {
    marginTop: 10,
    marginBottom: 8,
  },
  originalPrice: {
    fontFamily: "DMSans_500Medium",
    fontSize: 14,
    textDecorationLine: "line-through",
    marginBottom: 2,
    color: MUTED,
  },
  priceWrap: {
    alignSelf: "stretch",
  },
  price: {
    fontFamily: "BebasNeue_400Regular",
    fontSize: 20,
    letterSpacing: -0.5,
    lineHeight: 26,
    color: TEXT,
    fontWeight: "900",
  },
  period: {
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
    marginTop: 2,
    color: MUTED,
  },
  cta: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 10,
    borderRadius: 10,
  },
  ctaText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 12,
    letterSpacing: 0.4,
    textAlign: "center",
  },
  currentPlanLabel: {
    borderWidth: 1.5,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 10,
    borderRadius: 10,
  },
  currentPlanText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 12,
    letterSpacing: 0.4,
    textAlign: "center",
  },
  features: {
    gap: 7,
  },
  featureRow: {
    flexDirection: logicalRow,
    alignItems: "flex-start",
    gap: 6,
  },
  featureText: {
    fontFamily: "DMSans_400Regular",
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  featureMuted: {
    opacity: 1,
  },
});
