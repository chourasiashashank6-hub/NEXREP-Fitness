import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  acceptChallengeInvite,
  declineChallengeInvite,
  getChallengeHistory,
  getLeaderboard,
  listChallenges,
  updateLeaderboardSettings,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type SquadChallenge,
} from "../../api/socialChallenges";

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
const GOLD = "#D8A720";
const SILVER = "#B8BCC4";
const BRONZE = "#B7783C";

const countdownTo = (value?: string) => {
  if (!value) return "";
  const diff = Math.max(0, new Date(value).getTime() - Date.now());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
};

const challengeMeta = (challenge: SquadChallenge, t: (key: string, options?: Record<string, unknown>) => string) =>
  `${t(`social.challenges.types.${challenge.type}`)} · ${t("social.challenges.target", { count: challenge.target })}`;

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [activeChallenges, setActiveChallenges] = useState<SquadChallenge[]>([]);
  const [invites, setInvites] = useState<SquadChallenge[]>([]);
  const [history, setHistory] = useState<SquadChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyChallengeId, setBusyChallengeId] = useState<number | null>(null);
  const [, setNowTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leaderboardData, activeItems, inviteItems, historyItems] = await Promise.all([
        getLeaderboard(),
        listChallenges("active"),
        listChallenges("invited"),
        getChallengeHistory(),
      ]);
      setLeaderboard(leaderboardData);
      setActiveChallenges(activeItems);
      setInvites(inviteItems);
      setHistory(historyItems);
    } catch {
      Alert.alert(t("common.error"), t("social.leaderboard.alerts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const id = setInterval(() => setNowTick((current) => current + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const toggleOptIn = async () => {
    if (!leaderboard) return;
    const previous = leaderboard;
    const optedIn = !leaderboard.viewer_settings.opted_in;
    setLeaderboard({ ...leaderboard, viewer_settings: { opted_in: optedIn } });
    try {
      await updateLeaderboardSettings(optedIn);
    } catch {
      setLeaderboard(previous);
      Alert.alert(t("common.error"), t("social.leaderboard.alerts.settingsFailed"));
    }
  };

  const respondToInvite = async (challenge: SquadChallenge, action: "accept" | "decline") => {
    setBusyChallengeId(challenge.id);
    try {
      if (action === "accept") {
        const updated = await acceptChallengeInvite(challenge.id);
        setInvites((current) => current.filter((item) => item.id !== challenge.id));
        setActiveChallenges((current) => [updated, ...current]);
      } else {
        await declineChallengeInvite(challenge.id);
        setInvites((current) => current.filter((item) => item.id !== challenge.id));
      }
    } catch {
      Alert.alert(t("common.error"), t("social.challenges.alerts.actionFailed"));
    } finally {
      setBusyChallengeId(null);
    }
  };

  const topThree = leaderboard?.items.slice(0, 3) ?? [];
  const rest = leaderboard?.items.slice(3) ?? [];
  const unlocked = Boolean(leaderboard?.unlocked);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>{t("social.leaderboard.eyebrow")}</Text>
          <Text style={styles.title}>{t("social.leaderboard.title")}</Text>
        </View>
        <Pressable style={styles.createButton} onPress={() => navigation.navigate("SocialChallengeCreate")}>
          <Text style={styles.createButtonText}>{t("social.challenges.createCta")}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <>
          <View style={styles.resetCard}>
            <Text style={styles.resetLabel}>{t("social.leaderboard.resetsIn")}</Text>
            <Text style={styles.resetValue}>{countdownTo(leaderboard?.next_reset_at) || t("social.leaderboard.soon")}</Text>
            <Pressable style={styles.optInButton} onPress={toggleOptIn}>
              <Text style={styles.optInText}>
                {leaderboard?.viewer_settings.opted_in ? t("social.leaderboard.optOut") : t("social.leaderboard.optIn")}
              </Text>
            </Pressable>
          </View>

          {!unlocked ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("social.leaderboard.emptyTitle")}</Text>
              <Text style={styles.emptyBody}>{t("social.leaderboard.emptyBody")}</Text>
              <Pressable style={styles.primaryButton} onPress={() => navigation.navigate("SocialUserSearch")}>
                <Text style={styles.primaryButtonText}>{t("social.leaderboard.inviteFriends")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.podiumRow}>
                <PodiumBlock entry={topThree[1]} color={SILVER} height={88} label="2" />
                <PodiumBlock entry={topThree[0]} color={GOLD} height={116} label="1" />
                <PodiumBlock entry={topThree[2]} color={BRONZE} height={76} label="3" />
              </View>
              {rest.map((entry) => (
                <RankRow key={entry.user.user_id} entry={entry} />
              ))}
            </>
          )}

          {invites.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>{t("social.challenges.invites")}</Text>
              {invites.map((challenge) => (
                <View key={`invite-${challenge.id}`} style={styles.challengeCard}>
                  <Text style={styles.challengeTitle}>{challenge.title}</Text>
                  <Text style={styles.challengeMeta}>{challengeMeta(challenge, t)}</Text>
                  <View style={styles.inviteActions}>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={busyChallengeId === challenge.id}
                      onPress={() => respondToInvite(challenge, "decline")}
                    >
                      <Text style={styles.secondaryText}>{t("social.challenges.decline")}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.smallPrimaryButton}
                      disabled={busyChallengeId === challenge.id}
                      onPress={() => respondToInvite(challenge, "accept")}
                    >
                      <Text style={styles.smallPrimaryText}>{t("social.challenges.accept")}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          <Text style={styles.sectionTitle}>{t("social.challenges.active")}</Text>
          {activeChallenges.length === 0 ? <Text style={styles.emptySubtle}>{t("social.challenges.noActive")}</Text> : null}
          {activeChallenges.map((challenge) => (
            <Pressable
              key={`active-${challenge.id}`}
              style={styles.challengeCard}
              onPress={() => navigation.navigate("SocialChallengeDetail", { challengeId: challenge.id })}
            >
              <Text style={styles.challengeTitle}>{challenge.title}</Text>
              <Text style={styles.challengeMeta}>{challengeMeta(challenge, t)}</Text>
              <Text style={styles.countdownText}>
                {t("social.challenges.endsIn", { time: countdownTo(`${challenge.end_date}T23:59:59`) || t("social.leaderboard.soon") })}
              </Text>
            </Pressable>
          ))}

          {history.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>{t("social.challenges.history")}</Text>
              {history.slice(0, 3).map((challenge) => (
                <View key={`history-${challenge.id}`} style={styles.historyRow}>
                  <Text style={styles.historyTitle}>{challenge.title}</Text>
                  <Text style={styles.historyWinner}>
                    {challenge.winner ? t("social.challenges.winner", { name: challenge.winner.name }) : t("social.challenges.completed")}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>{t("social.challenges.history")}</Text>
              <Text style={styles.emptySubtle}>{t("social.challenges.noHistory")}</Text>
            </>
          )}
        </>
      )}
    </View>
  );
}

function PodiumBlock({ entry, color, height, label }: { entry?: LeaderboardEntry; color: string; height: number; label: string }) {
  const { t } = useTranslation();
  if (!entry) return <View style={styles.podiumSlot} />;
  return (
    <View style={styles.podiumSlot}>
      <View style={styles.podiumAvatar}>
        <Text style={styles.podiumAvatarText}>{entry.user.initials}</Text>
      </View>
      <Text style={styles.podiumName} numberOfLines={1}>
        {entry.user.name}
      </Text>
      <View style={[styles.podiumBlock, { backgroundColor: color, height }]}>
        <Text style={styles.podiumRank}>{label}</Text>
        <Text style={styles.podiumWorkouts}>{t("social.leaderboard.workouts", { count: entry.workouts_this_week })}</Text>
      </View>
    </View>
  );
}

function RankRow({ entry }: { entry: LeaderboardEntry }) {
  const { t } = useTranslation();
  return (
    <View style={styles.rankRow}>
      <Text style={styles.rankNumber}>#{entry.rank}</Text>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{entry.user.initials}</Text>
      </View>
      <View style={styles.rankText}>
        <Text style={styles.rankName}>{entry.user.name}</Text>
        <Text style={styles.rankMeta}>
          {t("social.leaderboard.rowMeta", { workouts: entry.workouts_this_week, streak: entry.current_streak })}
        </Text>
      </View>
      <Text style={styles.scoreText}>{entry.score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: BG },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  eyebrow: { color: GREEN, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginBottom: 4, textTransform: "uppercase" },
  title: { color: TEXT, fontSize: 24, fontWeight: "900" },
  createButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  createButtonText: { color: WHITE, fontSize: 12, fontWeight: "900" },
  loader: { marginTop: 40 },
  resetCard: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 14, padding: 14 },
  resetLabel: { color: MUTED, flex: 1, fontSize: 12, fontWeight: "800" },
  resetValue: { color: ORANGE, fontSize: 14, fontWeight: "900" },
  optInButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  optInText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  emptyCard: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 20, borderWidth: 1, marginBottom: 16, padding: 22 },
  emptyTitle: { color: TEXT, fontSize: 17, fontWeight: "900", marginBottom: 6, textAlign: "center" },
  emptyBody: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: 14, textAlign: "center" },
  primaryButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 },
  primaryButtonText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  podiumRow: { alignItems: "flex-end", flexDirection: "row", gap: 8, marginBottom: 14 },
  podiumSlot: { alignItems: "center", flex: 1 },
  podiumAvatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderColor: WHITE, borderRadius: 24, borderWidth: 2, height: 48, justifyContent: "center", marginBottom: 6, width: 48 },
  podiumAvatarText: { color: GREEN, fontSize: 14, fontWeight: "900" },
  podiumName: { color: TEXT, fontSize: 12, fontWeight: "900", marginBottom: 6, maxWidth: 92 },
  podiumBlock: { alignItems: "center", borderRadius: 16, justifyContent: "center", padding: 8, width: "100%" },
  podiumRank: { color: WHITE, fontSize: 22, fontWeight: "900" },
  podiumWorkouts: { color: WHITE, fontSize: 10, fontWeight: "900", textAlign: "center" },
  rankRow: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 12 },
  rankNumber: { color: PURPLE, fontSize: 13, fontWeight: "900", width: 34 },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 19, height: 38, justifyContent: "center", width: 38 },
  avatarText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  rankText: { flex: 1, minWidth: 0 },
  rankName: { color: TEXT, fontSize: 14, fontWeight: "900" },
  rankMeta: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 2 },
  scoreText: { color: TEXT, fontSize: 14, fontWeight: "900" },
  sectionTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 8, marginTop: 10 },
  emptySubtle: { color: TERTIARY, fontSize: 13, fontWeight: "700", marginBottom: 12 },
  challengeCard: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 18, borderWidth: 1, marginBottom: 10, padding: 13 },
  challengeTitle: { color: TEXT, fontSize: 15, fontWeight: "900", marginBottom: 4 },
  challengeMeta: { color: MUTED, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  countdownText: { color: ORANGE, fontSize: 12, fontWeight: "900" },
  inviteActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  secondaryButton: { backgroundColor: "#F4EEE8", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { color: ORANGE, fontSize: 12, fontWeight: "900" },
  smallPrimaryButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  smallPrimaryText: { color: WHITE, fontSize: 12, fontWeight: "900" },
  historyRow: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 16, borderWidth: 1, marginBottom: 8, padding: 12 },
  historyTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  historyWinner: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 3 },
});
