import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { ScreenContainer } from "../../components/ScreenContainer";
import { CoachCadenceLockedPanel } from "../../components/Coach/CoachCadenceLockedPanel";
import { CoachYearlyHistoryPanel } from "../../components/Coach/CoachYearlyHistoryPanel";
import { CADENCE_FEATURE, useCoachRedesignEnabled } from "../../hooks/useCoachRedesign";
import { useCoachHistory } from "../../hooks/useCoachHistory";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { GREEN, BG, TEXT, BORDER, WHITE } from "../../theme/colors";

const GREEN_DARK = "#0A4A3A";
const MUTED = "#BBBBBB";
/** Shared yearly review shell — full content ships in a later phase. */
export default function YearlyReviewScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const { hasFeatureAccess } = useFeatureAccess();
  const { enabled: redesignEnabled } = useCoachRedesignEnabled();
  const { history } = useCoachHistory();
  const yearlyUnlocked = hasFeatureAccess(CADENCE_FEATURE.yearly);

  if (redesignEnabled && !yearlyUnlocked) {
    return (
      <ScreenContainer bg={WHITE} contentStyle={styles.screenContent}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={TEXT} />
          </Pressable>
          <Text style={styles.title}>{t("coach.redesign.yearly.title")}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <CoachCadenceLockedPanel cadence="yearly" accentColor={GREEN} />
      </ScreenContainer>
    );
  }

  if (redesignEnabled && yearlyUnlocked && !history.yearly_unlocked) {
    return (
      <ScreenContainer bg={WHITE} contentStyle={styles.screenContent}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={TEXT} />
          </Pressable>
          <Text style={styles.title}>{t("coach.redesign.yearly.title")}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <CoachYearlyHistoryPanel
          daysUntil={history.days_until_yearly}
          unlockAtDays={history.yearly_unlock_at_days}
          accentColor={GREEN}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer bg={WHITE} contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>
        <Text style={styles.title}>{t("coach.redesign.yearly.title")}</Text>
        <Pressable style={styles.shareBtn} disabled accessibilityState={{ disabled: true }}>
          <Ionicons name="share-outline" size={16} color={MUTED} />
          <Text style={styles.shareText}>{t("coach.redesign.yearly.share")}</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroKicker}>{t("coach.redesign.yearly.heroKicker")}</Text>
          <Text style={styles.heroTitle}>{t("coach.redesign.yearly.comingSoonTitle")}</Text>
          <Text style={styles.heroSub}>{t("coach.redesign.yearly.comingSoonBody")}</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, color: TEXT, fontSize: 16, fontWeight: "900" },
  headerSpacer: { width: 72 },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    opacity: 0.5,
  },
  shareText: { color: MUTED, fontSize: 11, fontWeight: "800" },
  hero: {
    backgroundColor: GREEN_DARK,
    borderRadius: 22,
    padding: 22,
    marginBottom: 12,
  },
  heroKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  heroTitle: {
    color: WHITE,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },
  heroSub: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    lineHeight: 18,
  },
});
