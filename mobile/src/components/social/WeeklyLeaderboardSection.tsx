import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  getLeaderboard,
  updateLeaderboardSettings,
  type LeaderboardEntry,
  type LeaderboardResponse,
} from "../../api/socialChallenges";
import { UserAvatar } from "../UserAvatar";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const PURPLE = "#534AB7";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
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

type WeeklyLeaderboardSectionProps = {
  leaderboard: LeaderboardResponse | null;
  loading: boolean;
  onUpdated: (next: LeaderboardResponse) => void;
};

export function WeeklyLeaderboardSection({ leaderboard, loading, onUpdated }: WeeklyLeaderboardSectionProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const toggleOptIn = async () => {
    if (!leaderboard) return;
    const previous = leaderboard;
    const optedIn = !leaderboard.viewer_settings.opted_in;
    onUpdated({ ...leaderboard, viewer_settings: { opted_in: optedIn } });
    try {
      await updateLeaderboardSettings(optedIn);
    } catch {
      onUpdated(previous);
      Alert.alert(t("common.error"), t("social.leaderboard.alerts.settingsFailed"));
    }
  };

  const topThree = leaderboard?.items.slice(0, 3) ?? [];
  const rest = leaderboard?.items.slice(3) ?? [];
  const unlocked = Boolean(leaderboard?.unlocked);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("social.home.leaderboardTitle")}</Text>
        <Pressable onPress={() => navigation.navigate("SocialLeaderboard")}>
          <Text style={styles.seeAll}>{t("social.home.challengesLink")}</Text>
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
                <PodiumBlock entry={topThree[1]} color={SILVER} height={72} label="2" />
                <PodiumBlock entry={topThree[0]} color={GOLD} height={92} label="1" />
                <PodiumBlock entry={topThree[2]} color={BRONZE} height={64} label="3" />
              </View>
              {rest.slice(0, 5).map((entry) => (
                <RankRow key={entry.user.user_id} entry={entry} />
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

export async function loadWeeklyLeaderboard() {
  return getLeaderboard();
}

function PodiumBlock({ entry, color, height, label }: { entry?: LeaderboardEntry; color: string; height: number; label: string }) {
  const { t } = useTranslation();
  if (!entry) return <View style={styles.podiumSlot} />;
  return (
    <View style={styles.podiumSlot}>
      <UserAvatar
        name={entry.user.name}
        initials={entry.user.initials}
        profilePhotoUrl={entry.user.profile_photo_url}
        style={styles.podiumAvatar}
        textStyle={styles.podiumAvatarText}
      />
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
      <UserAvatar
        name={entry.user.name}
        initials={entry.user.initials}
        profilePhotoUrl={entry.user.profile_photo_url}
        style={styles.avatar}
        textStyle={styles.avatarText}
      />
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
  section: { marginBottom: 18 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: { color: TEXT, fontSize: 18, fontWeight: "900" },
  seeAll: { color: GREEN, fontSize: 12, fontWeight: "900" },
  loader: { marginVertical: 16 },
  resetCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
    padding: 12,
  },
  resetLabel: { color: MUTED, flex: 1, fontSize: 12, fontWeight: "800" },
  resetValue: { color: ORANGE, fontSize: 13, fontWeight: "900" },
  optInButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  optInText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  emptyCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  emptyTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 6, textAlign: "center" },
  emptyBody: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: 12, textAlign: "center" },
  primaryButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  primaryButtonText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  podiumRow: { alignItems: "flex-end", flexDirection: "row", gap: 8, marginBottom: 12 },
  podiumSlot: { alignItems: "center", flex: 1 },
  podiumAvatar: {
    alignItems: "center",
    backgroundColor: GREEN_LIGHT,
    borderColor: WHITE,
    borderRadius: 22,
    borderWidth: 2,
    height: 44,
    justifyContent: "center",
    marginBottom: 6,
    width: 44,
  },
  podiumAvatarText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  podiumName: { color: TEXT, fontSize: 11, fontWeight: "900", marginBottom: 6, maxWidth: 88 },
  podiumBlock: { alignItems: "center", borderRadius: 14, justifyContent: "center", padding: 6, width: "100%" },
  podiumRank: { color: WHITE, fontSize: 18, fontWeight: "900" },
  podiumWorkouts: { color: WHITE, fontSize: 9, fontWeight: "900", textAlign: "center" },
  rankRow: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
    padding: 10,
  },
  rankNumber: { color: PURPLE, fontSize: 12, fontWeight: "900", width: 30 },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 17, height: 34, justifyContent: "center", width: 34 },
  avatarText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  rankText: { flex: 1, minWidth: 0 },
  rankName: { color: TEXT, fontSize: 13, fontWeight: "900" },
  rankMeta: { color: MUTED, fontSize: 11, fontWeight: "700", marginTop: 2 },
  scoreText: { color: TEXT, fontSize: 13, fontWeight: "900" },
});
