import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Plan } from "../constants/plans";
import type { AppTheme } from "../theme/colors";

const SUCCESS_GREEN = "#00e5a0";

export type PlanCardProps = {
  plan: Plan;
  displayPrice: number;
  originalPrice: number | null;
  isYearly: boolean;
  featured: boolean;
  onSelect: () => void;
  theme: AppTheme;
};

export function PlanCard({ plan, displayPrice, originalPrice, isYearly, featured, onSelect, theme }: PlanCardProps) {
  const { colors, radius } = theme;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    scale.setValue(0.94);
    Animated.spring(scale, {
      toValue: 1,
      friction: 8,
      tension: 160,
      useNativeDriver: true,
    }).start();
  }, [displayPrice, scale]);

  const period = isYearly ? "/yr" : "/mo";

  return (
    <View style={[styles.wrapper, featured && styles.wrapperFeatured]}>
      {featured ? (
        <View style={[styles.popularBadge, { backgroundColor: colors.danger }]}>
          <Text style={styles.popularText}>Most Popular</Text>
        </View>
      ) : null}
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: featured ? colors.danger : colors.border,
            borderWidth: featured ? 1.5 : 0.5,
            borderRadius: radius.md,
            opacity: pressed ? 0.94 : 1,
          },
        ]}
      >
        <Text style={[styles.planName, { color: colors.text }]}>{plan.name}</Text>
        <Text style={[styles.desc, { color: colors.muted }]} numberOfLines={2}>
          {plan.desc}
        </Text>
        <View style={styles.priceBlock}>
          {originalPrice != null ? (
            <Text style={[styles.originalPrice, { color: colors.muted }]}>₹{originalPrice}</Text>
          ) : null}
          <Animated.View style={[styles.priceWrap, { transform: [{ scale }] }]}>
            <Text
              style={[styles.price, { color: colors.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
            >
              ₹{displayPrice}
            </Text>
          </Animated.View>
          <Text style={[styles.period, { color: colors.muted }]}>{period}</Text>
        </View>
        <View style={[styles.cta, { backgroundColor: "#00e5a0", borderRadius: radius.md - 2 }]}>
          <Text style={styles.ctaText}>Choose {plan.name}</Text>
          <Ionicons name="arrow-forward" size={16} color="#0b1220" />
        </View>
        <View style={styles.features}>
          {plan.features.map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <Ionicons
                name={f.included ? "checkmark-circle" : "close-circle-outline"}
                size={15}
                color={f.included ? SUCCESS_GREEN : colors.muted}
              />
              <Text
                style={[
                  styles.featureText,
                  { color: f.included ? colors.text : colors.muted },
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
  },
  popularText: {
    color: "#FFFFFF",
    fontFamily: "DMSans_600SemiBold",
    fontSize: 10,
    letterSpacing: 1,
  },
  card: {
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  planName: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 17,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  desc: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    marginTop: 6,
    minHeight: 34,
    lineHeight: 16,
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
  },
  priceWrap: {
    alignSelf: "stretch",
  },
  price: {
    fontFamily: "BebasNeue_400Regular",
    fontSize: 38,
    letterSpacing: -1.5,
    lineHeight: 44,
  },
  period: {
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
    marginTop: 2,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginBottom: 10,
  },
  ctaText: {
    color: "#0b1220",
    fontFamily: "DMSans_600SemiBold",
    fontSize: 12,
    letterSpacing: 0.4,
  },
  features: {
    gap: 7,
  },
  featureRow: {
    flexDirection: "row",
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
    opacity: 0.55,
  },
});
