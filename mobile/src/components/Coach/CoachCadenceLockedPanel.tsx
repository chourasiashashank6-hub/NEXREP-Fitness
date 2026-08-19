import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { CoachCadence } from "../../hooks/useCoachRedesign";
import type { CoachStackParamList } from "../../navigation/coachTypes";

const TEXT = "#1A1A18";
const MUTED = "#888888";
const BORDER = "#ECEAE5";
const BG = "#F7F6F3";
const ELITE = "#C08000";
const ELITE_LIGHT = "#FFF8E8";

type Props = {
  cadence: Extract<CoachCadence, "monthly" | "yearly">;
  accentColor: string;
};

export function CoachCadenceLockedPanel({ cadence, accentColor }: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();

  const openSubscription = () => {
    const parent = navigation.getParent?.();
    if (parent) {
      parent.navigate("Profile", { screen: "Subscription" });
      return;
    }
    navigation.navigate("Subscription" as never);
  };

  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: `${accentColor}18` }]}>
        <Ionicons name="lock-closed" size={22} color={accentColor} />
      </View>
      <Text style={styles.kicker}>{t("coach.redesign.locked.kicker")}</Text>
      <Text style={styles.title}>{t(`coach.redesign.locked.${cadence}.title`)}</Text>
      <Text style={styles.body}>{t(`coach.redesign.locked.${cadence}.body`)}</Text>
      <View style={styles.eliteBadge}>
        <Text style={styles.eliteBadgeText}>{t("coach.redesign.locked.eliteBadge")}</Text>
      </View>
      <Pressable style={[styles.cta, { backgroundColor: accentColor }]} onPress={openSubscription}>
        <Text style={styles.ctaText}>{t("coach.redesign.locked.upgradeCta")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
    marginBottom: 12,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  kicker: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 14,
  },
  eliteBadge: {
    backgroundColor: ELITE_LIGHT,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 14,
  },
  eliteBadgeText: {
    color: ELITE,
    fontSize: 10,
    fontWeight: "900",
  },
  cta: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 24,
    alignSelf: "stretch",
    alignItems: "center",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
});
