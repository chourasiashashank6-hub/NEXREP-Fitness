import { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import ProGateModal from "../../components/ProGateModal";
import { getRequiredPlan } from "../../constants/featureTiers";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../../theme/colors";

export type { CoachStackParamList } from "../../navigation/coachTypes";

type GateConfig = {
  feature: string;
  name: string;
  description: string;
  emoji: string;
  accentColor: string;
};

const GREEN_STRIP = GREEN_LIGHT;
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const MUTED = "#BBBBBB";
const SCREEN_BG = WHITE;

export default function CoachHomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { hasFeatureAccess } = useFeatureAccess();
  const [gate, setGate] = useState<GateConfig | null>(null);

  const openOrGate = useCallback(
    (navigateFn: () => void, config: GateConfig) => {
      if (hasFeatureAccess(config.feature)) {
        navigateFn();
      } else {
        setGate(config);
      }
    },
    [hasFeatureAccess],
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroCircle} />
          <Text style={styles.heroKicker}>{t("coach.home.heroKicker")}</Text>
          <Text style={styles.heroTitle}>
            {t("coach.home.heroTitle")} <Text style={styles.heroTitleAccent}>{t("coach.home.heroTitleAccent")}</Text>
          </Text>
          <Text style={styles.heroSub}>{t("coach.home.heroSubtitle")}</Text>
          <View style={styles.trustRow}>
            <View style={styles.trustPill}>
              <Text style={styles.trustPillText}>{t("coach.home.coachCount")}</Text>
            </View>
            <View style={styles.trustPill}>
              <Text style={styles.trustPillText}>{t("coach.home.proPlan")}</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>{t("coach.home.coaches")}</Text>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>{t("coach.home.proFeature")}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.coachCard}
            onPress={() =>
              openOrGate(() => navigation.navigate("AICalorieCoach"), {
                feature: "calorie_coach",
                name: t("coach.home.calorieCoach.name"),
                description: t("coach.home.calorieCoach.gateDescription"),
                emoji: "🥗",
                accentColor: "#1d9e75",
              })
            }
            activeOpacity={0.85}
          >
            <View style={styles.calorieStrip}>
              <View style={styles.stripIconGreen}>
                <Ionicons name="restaurant-outline" size={20} color={WHITE} />
              </View>
              <View style={styles.stripTextBlock}>
                <View style={styles.titleBadgeRow}>
                  <Text style={styles.calorieTitle}>{t("coach.home.calorieCoach.name")}</Text>
                  <View style={styles.proBadgeGreen}>
                    <Text style={styles.proBadgeText}>{t("coach.home.proBadge")}</Text>
                  </View>
                </View>
                <Text style={styles.calorieSub}>{t("coach.home.calorieCoach.subtitle")}</Text>
              </View>
            </View>
            <View style={styles.coachBody}>
              <View style={styles.statRow}>
                <StatTile label={t("coach.home.calorieCoach.daily")} sub={t("coach.home.calorieCoach.freshInsights")} color={GREEN} />
                <StatTile label={t("coach.home.calorieCoach.auto")} sub={t("coach.home.calorieCoach.fromYourLog")} color={GREEN} />
                <StatTile label={t("coach.home.calorieCoach.smart")} sub={t("coach.home.calorieCoach.personalised")} color={GREEN} last />
              </View>
              <View style={styles.bulletList}>
                <BulletRow text={t("coach.home.calorieCoach.bulletMacro")} color={GREEN} />
                <BulletRow text={t("coach.home.calorieCoach.bulletSwaps")} color={GREEN} />
                <BulletRow text={t("coach.home.calorieCoach.bulletProtein")} color={GREEN} />
              </View>
              <View
                style={[
                  styles.ctaButton,
                  hasFeatureAccess("calorie_coach") ? styles.ctaUnlockedGreen : styles.ctaLocked,
                  !hasFeatureAccess("calorie_coach") && styles.ctaLockedOpacity,
                ]}
              >
                <Text style={[styles.ctaText, !hasFeatureAccess("calorie_coach") && styles.ctaTextLocked]}>
                  {hasFeatureAccess("calorie_coach") ? t("coach.home.calorieCoach.open") : t("coach.home.calorieCoach.lockedOpen")}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.coachCard}
            onPress={() =>
              openOrGate(() => navigation.navigate("AIWorkoutCoach"), {
                feature: "workout_coach",
                name: t("coach.home.workoutCoach.name"),
                description: t("coach.home.workoutCoach.gateDescription"),
                emoji: "💪",
                accentColor: "#7f77dd",
              })
            }
            activeOpacity={0.85}
          >
            <View style={styles.workoutStrip}>
              <View style={styles.stripIconPurple}>
                <Ionicons name="barbell-outline" size={20} color={WHITE} />
              </View>
              <View style={styles.stripTextBlock}>
                <View style={styles.titleBadgeRow}>
                  <Text style={styles.workoutTitle}>{t("coach.home.workoutCoach.name")}</Text>
                  <View style={styles.proBadgePurple}>
                    <Text style={styles.proBadgeText}>{t("coach.home.proBadge")}</Text>
                  </View>
                </View>
                <Text style={styles.workoutSub}>{t("coach.home.workoutCoach.subtitle")}</Text>
              </View>
            </View>
            <View style={styles.coachBody}>
              <View style={styles.bulletList}>
                <BulletRow text={t("coach.home.workoutCoach.bulletFeedback")} color={PURPLE} />
                <BulletRow text={t("coach.home.workoutCoach.bulletRecovery")} color={PURPLE} />
                <BulletRow text={t("coach.home.workoutCoach.bulletOverload")} color={PURPLE} />
                <BulletRow text={t("coach.home.workoutCoach.bulletHistory")} color={PURPLE} />
              </View>
              <View
                style={[
                  styles.ctaButton,
                  hasFeatureAccess("workout_coach") ? styles.ctaUnlockedPurple : styles.ctaLocked,
                  !hasFeatureAccess("workout_coach") && styles.ctaLockedOpacity,
                ]}
              >
                <Text style={[styles.ctaText, !hasFeatureAccess("workout_coach") && styles.ctaTextLocked]}>
                  {hasFeatureAccess("workout_coach") ? t("coach.home.workoutCoach.open") : t("coach.home.workoutCoach.lockedOpen")}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {gate ? (
        <ProGateModal
          visible={gate !== null}
          onClose={() => setGate(null)}
          featureName={gate.name}
          featureDescription={gate.description}
          featureEmoji={gate.emoji}
          accentColor={gate.accentColor}
          requiredPlan={getRequiredPlan(gate.feature) === "elite" ? "elite" : "pro"}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  content: {
    backgroundColor: SCREEN_BG,
    paddingBottom: 24,
  },
  hero: {
    backgroundColor: GREEN,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 24,
    position: "relative",
    overflow: "hidden",
  },
  heroCircle: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.05)",
    top: -54,
    right: -48,
  },
  heroKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  heroTitle: {
    color: WHITE,
    fontSize: 22,
    fontWeight: "900",
  },
  heroTitleAccent: {
    color: "#A8F0C8",
  },
  heroSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
  },
  trustRow: {
    flexDirection: "row",
    gap: 7,
    flexWrap: "wrap",
    marginTop: 12,
  },
  trustPill: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  trustPillText: {
    color: WHITE,
    fontSize: 10,
    fontWeight: "800",
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  sectionBadge: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sectionBadgeText: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "900",
  },
  coachCard: {
    backgroundColor: WHITE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  calorieStrip: {
    backgroundColor: GREEN_STRIP,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  workoutStrip: {
    backgroundColor: PURPLE_LIGHT,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stripIconGreen: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  stripIconPurple: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: PURPLE,
    alignItems: "center",
    justifyContent: "center",
  },
  stripTextBlock: {
    flex: 1,
  },
  titleBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  calorieTitle: {
    color: GREEN,
    fontSize: 14,
    fontWeight: "900",
  },
  workoutTitle: {
    color: PURPLE,
    fontSize: 14,
    fontWeight: "900",
  },
  calorieSub: {
    color: "#4A8C77",
    fontSize: 10,
    marginTop: 3,
    fontWeight: "700",
  },
  workoutSub: {
    color: "#9B8ECC",
    fontSize: 10,
    marginTop: 3,
    fontWeight: "700",
  },
  proBadgeGreen: {
    backgroundColor: GREEN,
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  proBadgePurple: {
    backgroundColor: PURPLE,
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  proBadgeText: {
    color: WHITE,
    fontSize: 9,
    fontWeight: "900",
  },
  coachBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  statRow: {
    backgroundColor: BG,
    borderRadius: 10,
    flexDirection: "row",
    marginBottom: 14,
    overflow: "hidden",
  },
  statTile: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  statTileLast: {
    borderRightWidth: 0,
  },
  statTileLabel: {
    fontSize: 12,
    fontWeight: "900",
  },
  statTileSub: {
    color: MUTED,
    fontSize: 9,
    marginTop: 1,
    textAlign: "center",
  },
  bulletList: {
    gap: 4,
    marginBottom: 14,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    paddingVertical: 3,
  },
  bulletStar: {
    fontSize: 10,
    flexShrink: 0,
    marginTop: 1,
  },
  bulletText: {
    color: "#555555",
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
  },
  ctaButton: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaUnlockedGreen: {
    backgroundColor: GREEN,
  },
  ctaUnlockedPurple: {
    backgroundColor: PURPLE,
  },
  ctaLocked: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  ctaLockedOpacity: {
    opacity: 0.7,
  },
  ctaText: {
    color: WHITE,
    fontSize: 13,
    fontWeight: "900",
  },
  ctaTextLocked: {
    color: MUTED,
  },
});

const BulletRow = ({ text, color }: { text: string; color: string }) => (
  <View style={styles.bulletRow}>
    <Text style={[styles.bulletStar, { color }]}>✦</Text>
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

const StatTile = ({
  label,
  sub,
  color,
  last,
}: {
  label: string;
  sub: string;
  color: string;
  last?: boolean;
}) => (
  <View style={[styles.statTile, last && styles.statTileLast]}>
    <Text style={[styles.statTileLabel, { color }]}>{label}</Text>
    <Text style={styles.statTileSub}>{sub}</Text>
  </View>
);
