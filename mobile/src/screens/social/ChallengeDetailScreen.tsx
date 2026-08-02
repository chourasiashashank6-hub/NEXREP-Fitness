import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  acceptChallengeInvite,
  declineChallengeInvite,
  getChallengeStandings,
  leaveChallenge,
  type ChallengeStanding,
  type SquadChallenge,
} from "../../api/socialChallenges";
import { ScreenContainer } from "../../components/ScreenContainer";
import { UserAvatar } from "../../components/UserAvatar";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const PURPLE = "#534AB7";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const TERTIARY = "#9BA39D";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";

const countdownToEnd = (endDate?: string) => {
  if (!endDate) return "";
  const diff = Math.max(0, new Date(`${endDate}T23:59:59`).getTime() - Date.now());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
};

export default function ChallengeDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const challengeId = Number(route.params?.challengeId);
  const [challenge, setChallenge] = useState<SquadChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [, setNowTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChallenge(await getChallengeStandings(challengeId));
    } catch {
      Alert.alert(t("common.error"), t("social.challenges.alerts.loadFailed"));
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [challengeId, navigation, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const id = setInterval(() => setNowTick((current) => current + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const respond = async (action: "accept" | "decline") => {
    if (!challenge) return;
    setSaving(true);
    try {
      if (action === "accept") {
        setChallenge(await acceptChallengeInvite(challenge.id));
      } else {
        await declineChallengeInvite(challenge.id);
        navigation.goBack();
      }
    } catch {
      Alert.alert(t("common.error"), t("social.challenges.alerts.actionFailed"));
    } finally {
      setSaving(false);
    }
  };

  const leave = () => {
    if (!challenge) return;
    Alert.alert(t("social.challenges.detail.leaveTitle"), t("social.challenges.detail.leaveBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("social.challenges.detail.leave"),
        style: "destructive",
        onPress: async () => {
          setSaving(true);
          try {
            await leaveChallenge(challenge.id);
            navigation.goBack();
          } catch {
            Alert.alert(t("common.error"), t("social.challenges.alerts.actionFailed"));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
      </View>

      {loading || !challenge ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.status}>{t(`social.challenges.status.${challenge.status}`)}</Text>
            <Text style={styles.title}>{challenge.title}</Text>
            <Text style={styles.meta}>
              {t(`social.challenges.types.${challenge.type}`)} · {t("social.challenges.target", { count: challenge.target })}
            </Text>
            <Text style={styles.countdown}>
              {challenge.status === "active"
                ? t("social.challenges.endsIn", { time: countdownToEnd(challenge.end_date) || t("social.leaderboard.soon") })
                : challenge.winner
                  ? t("social.challenges.winner", { name: challenge.winner.name })
                  : t("social.challenges.completed")}
            </Text>
            {challenge.viewer_status === "invited" ? (
              <View style={styles.actions}>
                <Pressable style={styles.secondaryButton} disabled={saving} onPress={() => respond("decline")}>
                  <Text style={styles.secondaryText}>{t("social.challenges.decline")}</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} disabled={saving} onPress={() => respond("accept")}>
                  <Text style={styles.primaryText}>{t("social.challenges.accept")}</Text>
                </Pressable>
              </View>
            ) : challenge.viewer_status === "joined" && challenge.status === "active" && !challenge.viewer_is_creator ? (
              <Pressable style={styles.leaveButton} disabled={saving} onPress={leave}>
                <Text style={styles.leaveText}>{t("social.challenges.detail.leave")}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.sectionTitle}>{t("social.challenges.detail.standings")}</Text>
          {(challenge.standings ?? []).length === 0 ? <Text style={styles.emptyText}>{t("social.challenges.detail.noStandings")}</Text> : null}
          {(challenge.standings ?? []).map((standing) => (
            <StandingRow key={standing.user.user_id} standing={standing} target={challenge.target} />
          ))}
        </>
      )}
    </ScreenContainer>
  );
}

function StandingRow({ standing, target }: { standing: ChallengeStanding; target: number }) {
  const { t } = useTranslation();
  const percent = Math.max(0, Math.min(100, Math.round((standing.progress / Math.max(target, 1)) * 100)));
  return (
    <View style={styles.standingRow}>
      <Text style={styles.rank}>#{standing.rank}</Text>
      <UserAvatar
        name={standing.user.name}
        initials={standing.user.initials}
        profilePhotoUrl={standing.user.profile_photo_url}
        style={styles.avatar}
        textStyle={styles.avatarText}
      />
      <View style={styles.standingText}>
        <Text style={styles.name}>{standing.user.name}</Text>
        <Text style={styles.progressText}>{t("social.challenges.detail.progress", { progress: standing.progress, target })}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
      </View>
      <Text style={styles.statusText}>{t(`social.challenges.participantStatus.${standing.status}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", marginBottom: 12 },
  backButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  loader: { marginTop: 40 },
  heroCard: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 22, borderWidth: 1, marginBottom: 16, padding: 18 },
  status: { color: PURPLE, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },
  title: { color: TEXT, fontSize: 25, fontWeight: "900", marginBottom: 7 },
  meta: { color: MUTED, fontSize: 14, fontWeight: "800", marginBottom: 6 },
  countdown: { color: ORANGE, fontSize: 13, fontWeight: "900" },
  actions: { flexDirection: "row", gap: 8, marginTop: 16 },
  primaryButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  primaryText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  secondaryButton: { backgroundColor: "#F4EEE8", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryText: { color: ORANGE, fontSize: 13, fontWeight: "900" },
  leaveButton: { alignSelf: "flex-start", backgroundColor: "#F4EEE8", borderRadius: 999, marginTop: 16, paddingHorizontal: 14, paddingVertical: 10 },
  leaveText: { color: ORANGE, fontSize: 13, fontWeight: "900" },
  sectionTitle: { color: TEXT, fontSize: 17, fontWeight: "900", marginBottom: 10 },
  emptyText: { color: TERTIARY, fontSize: 13, fontWeight: "700" },
  standingRow: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 9, padding: 12 },
  rank: { color: PURPLE, fontSize: 13, fontWeight: "900", width: 34 },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 19, height: 38, justifyContent: "center", width: 38 },
  avatarText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  standingText: { flex: 1, minWidth: 0 },
  name: { color: TEXT, fontSize: 14, fontWeight: "900" },
  progressText: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 2 },
  progressTrack: { backgroundColor: "#EEF1ED", borderRadius: 999, height: 6, marginTop: 7, overflow: "hidden" },
  progressFill: { backgroundColor: GREEN, borderRadius: 999, height: 6 },
  statusText: { color: MUTED, fontSize: 11, fontWeight: "900" },
});
