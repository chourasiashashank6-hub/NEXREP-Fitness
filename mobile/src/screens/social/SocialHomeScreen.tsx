import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { listFeed, reactToFeedEvent, type FeedEvent, type FeedReactionType } from "../../api/feed";
import { startOrGetDMConversation } from "../../api/messages";
import { getFriends, type SocialUserProfile } from "../../api/social";
import { getProfile, type UserProfile } from "../../api/user";
import type { GymSquad } from "../../api/gymSquads";
import type { LeaderboardResponse } from "../../api/socialChallenges";
import { HomeSquadCard, loadHomeSquads } from "../../components/social/HomeSquadCard";
import { WeeklyLeaderboardSection, loadWeeklyLeaderboard } from "../../components/social/WeeklyLeaderboardSection";
import { ScreenContainer } from "../../components/ScreenContainer";
import { UserAvatar } from "../../components/UserAvatar";
import { useActivityDataRefreshStore } from "../../store/activityDataRefreshStore";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FCECE6";
const PURPLE = "#534AB7";
const PURPLE_LIGHT = "#ECEBFF";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const TERTIARY = "#9BA39D";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";
const FOCUS_STALE_MS = 45_000;

type SocialHomeScreenProps = {
  embedded?: boolean;
};

const formatTimestamp = (value: string | null | undefined, nowLabel: string) => {
  if (!value) return "";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return nowLabel;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const formatKg = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

export default function SocialHomeScreen({ embedded = false }: SocialHomeScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friends, setFriends] = useState<SocialUserProfile[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [squads, setSquads] = useState<GymSquad[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [squadsLoading, setSquadsLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyReaction, setBusyReaction] = useState<string | null>(null);
  const lastLoadAt = useRef(0);
  const activityRefreshVersion = useActivityDataRefreshStore((s) => s.version);

  const load = useCallback(
    async (mode: "initial" | "refresh" | "silent" = "initial") => {
      if (mode === "initial") {
        setLoading(true);
        setSquadsLoading(true);
        setLeaderboardLoading(true);
      } else if (mode === "refresh") {
        setRefreshing(true);
      }
      try {
        const [profileData, friendItems, feedPage, squadItems, leaderboardData] = await Promise.all([
          getProfile(),
          getFriends(),
          listFeed({ limit: 20 }),
          loadHomeSquads().catch(() => [] as GymSquad[]),
          loadWeeklyLeaderboard().catch(() => null),
        ]);
        setProfile(profileData);
        setFriends(friendItems);
        setFeed(feedPage.items);
        setSquads(squadItems);
        setLeaderboard(leaderboardData);
        lastLoadAt.current = Date.now();
      } catch {
        Alert.alert(t("common.error"), t("social.home.alerts.loadFailed"));
      } finally {
        setLoading(false);
        setSquadsLoading(false);
        setLeaderboardLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (lastLoadAt.current > 0 && now - lastLoadAt.current < FOCUS_STALE_MS) {
        return;
      }
      void load(lastLoadAt.current === 0 ? "initial" : "silent");
    }, [load]),
  );

  useEffect(() => {
    if (activityRefreshVersion === 0) return;
    lastLoadAt.current = 0;
    void load("silent");
  }, [activityRefreshVersion, load]);

  const refreshControl = useMemo(
    () => <RefreshControl tintColor={GREEN} refreshing={refreshing} onRefresh={() => void load("refresh")} />,
    [load, refreshing],
  );

  const openMessage = async (user: FeedEvent["user"]) => {
    try {
      const conversation = await startOrGetDMConversation(user.user_id);
      navigation.navigate("SocialChat", {
        dmConversationId: conversation.id,
        title: conversation.other_user?.name ?? user.name,
        profilePhotoUrl: user.profile_photo_url,
        initials: user.initials,
      });
    } catch {
      Alert.alert(t("common.error"), t("social.messages.alerts.loadConversationsFailed"));
    }
  };

  const handleReaction = async (event: FeedEvent, type: FeedReactionType) => {
    if (event.viewer_reactions.includes(type)) return;
    const key = `${event.id}:${type}`;
    const previous = feed;
    setBusyReaction(key);
    setFeed((current) =>
      current.map((item) =>
        item.id === event.id
          ? {
              ...item,
              reaction_counts: {
                ...item.reaction_counts,
                [type]: (item.reaction_counts[type] ?? 0) + 1,
              },
              viewer_reactions: [...item.viewer_reactions, type],
            }
          : item,
      ),
    );
    try {
      const updated = await reactToFeedEvent(event.id, type);
      setFeed((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setFeed(previous);
      Alert.alert(t("common.error"), t("social.home.alerts.reactionFailed"));
    } finally {
      setBusyReaction(null);
    }
  };

  const userFirstName = (profile?.name || t("social.home.fallbackName")).trim().split(/\s+/)[0];
  const hasFriends = friends.length > 0;

  return (
    <ScreenContainer bg={BG} refreshControl={refreshControl} embedded={embedded}>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>{t("social.home.eyebrow")}</Text>
        <Text style={styles.heroTitle}>{t("social.home.heroTitle", { name: userFirstName })}</Text>
        <Text style={styles.heroSubtitle}>{t("social.home.friendCount", { count: friends.length })}</Text>
      </View>

      <HomeSquadCard squads={squads} loading={squadsLoading} />
      <WeeklyLeaderboardSection
        leaderboard={leaderboard}
        loading={leaderboardLoading}
        onUpdated={setLeaderboard}
      />

      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <>
          <Text style={styles.feedTitle}>{t("social.home.feedTitle")}</Text>
          {!hasFriends ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("social.home.empty.zeroFriendsTitle")}</Text>
              <Text style={styles.emptyBody}>{t("social.home.empty.zeroFriendsBody")}</Text>
              <Pressable style={styles.primaryButton} onPress={() => navigation.navigate("SocialUserSearch")}>
                <Text style={styles.primaryButtonText}>{t("social.home.empty.searchFriends")}</Text>
              </Pressable>
            </View>
          ) : feed.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("social.home.empty.quietTitle")}</Text>
              <Text style={styles.emptyBody}>{t("social.home.empty.quietBody")}</Text>
            </View>
          ) : (
            feed.map((event) => (
              <FeedCard
                key={event.id}
                event={event}
                busyReaction={busyReaction}
                onMessage={openMessage}
                onReact={handleReaction}
              />
            ))
          )}
        </>
      )}
    </ScreenContainer>
  );
}

function FeedCard({
  event,
  busyReaction,
  onMessage,
  onReact,
}: {
  event: FeedEvent;
  busyReaction: string | null;
  onMessage: (user: FeedEvent["user"]) => void;
  onReact: (event: FeedEvent, type: FeedReactionType) => void;
}) {
  const { t } = useTranslation();
  const reactionButton = (type: FeedReactionType, label: string) => {
    const selected = event.viewer_reactions.includes(type);
    return (
      <Pressable
        style={[styles.reactionButton, selected ? styles.reactionButtonActive : null]}
        disabled={selected || busyReaction === `${event.id}:${type}`}
        onPress={() => onReact(event, type)}
      >
        <Text style={[styles.reactionText, selected ? styles.reactionTextActive : null]}>
          {label} {event.reaction_counts[type] ?? 0}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.feedCard}>
      <View style={styles.feedHeader}>
        <UserAvatar
          name={event.user.name}
          initials={event.user.initials}
          profilePhotoUrl={event.user.profile_photo_url}
          style={styles.avatar}
          textStyle={styles.avatarText}
        />
        <View style={styles.feedHeaderText}>
          <Text style={styles.friendName}>{event.user.name}</Text>
          <Text style={styles.timestamp}>{formatTimestamp(event.created_at, t("social.home.time.now"))}</Text>
        </View>
        <Pressable onPress={() => onMessage(event.user)}>
          <Text style={styles.messageLink}>{t("social.actions.message")}</Text>
        </Pressable>
      </View>
      {event.type === "pr" ? <PrContent event={event} /> : event.type === "streak_milestone" ? <StreakContent event={event} /> : <ThreadJoinContent event={event} />}
      <View style={styles.reactionRow}>
        {reactionButton("flame", t("social.home.reactions.flame"))}
        {reactionButton("clap", t("social.home.reactions.cheer"))}
      </View>
    </View>
  );
}

function PrContent({ event }: { event: FeedEvent }) {
  const { t } = useTranslation();
  return (
    <View>
      <View style={styles.prTitleRow}>
        <Text style={styles.eventTitle}>{event.payload.exercise_name || t("social.home.feed.prFallback")}</Text>
        <View style={styles.prBadge}>
          <Text style={styles.prBadgeText}>{t("social.home.feed.prBadge")}</Text>
        </View>
      </View>
      <View style={styles.metricRow}>
        <Metric label={t("social.home.feed.weight")} value={`${formatKg(event.payload.weight_kg)} kg`} />
        <Metric label={t("social.home.feed.reps")} value={String(event.payload.reps ?? "-")} />
        <Metric label={t("social.home.feed.oneRm")} value={`${formatKg(event.payload.estimated_1rm_kg)} kg`} />
      </View>
    </View>
  );
}

function StreakContent({ event }: { event: FeedEvent }) {
  const { t } = useTranslation();
  return (
    <View style={styles.streakBody}>
      <Text style={styles.streakEmoji}>🔥</Text>
      <View style={styles.streakTextWrap}>
        <Text style={styles.eventTitle}>{t("social.home.feed.streakTitle", { count: event.payload.current_streak ?? 0 })}</Text>
        <Text style={styles.eventBody}>{t("social.home.feed.streakBody")}</Text>
      </View>
    </View>
  );
}

function ThreadJoinContent({ event }: { event: FeedEvent }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text style={styles.eventTitle}>{t("social.home.feed.threadJoined", { title: event.payload.thread_title || t("social.home.feed.threadFallback") })}</Text>
      {event.payload.gym_name ? <Text style={styles.eventBody}>{event.payload.gym_name}</Text> : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: GREEN,
    borderRadius: 24,
    marginBottom: 14,
    padding: 20,
  },
  heroEyebrow: { color: "#BDE7D5", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },
  heroTitle: { color: WHITE, fontSize: 28, fontWeight: "900", marginBottom: 6 },
  heroSubtitle: { color: "#DCF6EC", fontSize: 14, fontWeight: "800" },
  loader: { marginTop: 28 },
  feedTitle: { color: TEXT, fontSize: 18, fontWeight: "900", marginBottom: 10 },
  emptyCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
  },
  emptyTitle: { color: TEXT, fontSize: 17, fontWeight: "900", marginBottom: 6, textAlign: "center" },
  emptyBody: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: 14, textAlign: "center" },
  primaryButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 },
  primaryButtonText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  feedCard: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  feedHeader: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 12 },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  avatarText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  feedHeaderText: { flex: 1, minWidth: 0 },
  friendName: { color: TEXT, fontSize: 15, fontWeight: "900" },
  timestamp: { color: TERTIARY, fontSize: 11, fontWeight: "700", marginTop: 2 },
  messageLink: { color: PURPLE, fontSize: 12, fontWeight: "900" },
  prTitleRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 12 },
  eventTitle: { color: TEXT, flex: 1, fontSize: 17, fontWeight: "900", lineHeight: 22 },
  eventBody: { color: MUTED, fontSize: 13, fontWeight: "700", marginTop: 4 },
  prBadge: { backgroundColor: ORANGE_LIGHT, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  prBadgeText: { color: ORANGE, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  metricRow: { flexDirection: "row", gap: 8 },
  metric: { backgroundColor: "#FAFAF8", borderColor: BORDER, borderRadius: 14, borderWidth: 1, flex: 1, padding: 10 },
  metricValue: { color: TEXT, fontSize: 14, fontWeight: "900", marginBottom: 3 },
  metricLabel: { color: MUTED, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  streakBody: { alignItems: "center", flexDirection: "row", gap: 12 },
  streakEmoji: { backgroundColor: ORANGE_LIGHT, borderRadius: 18, fontSize: 21, overflow: "hidden", padding: 7 },
  streakTextWrap: { flex: 1 },
  reactionRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  reactionButton: { backgroundColor: "#FAFAF8", borderColor: BORDER, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  reactionButtonActive: { backgroundColor: PURPLE_LIGHT, borderColor: PURPLE },
  reactionText: { color: MUTED, fontSize: 12, fontWeight: "900" },
  reactionTextActive: { color: PURPLE },
});
