import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  getFriends,
  removeFriend,
  sendFriendRequest,
  type PendingSocialUserProfile,
  type SocialUserProfile,
} from "../../api/social";
import { sendMessage, startOrGetDMConversation } from "../../api/messages";
import type { SupplementStackItem } from "../../api/supplementStacks";
import SocialProfilePeekSheet from "../../components/social/SocialProfilePeekSheet";
import SocialUserCard from "../../components/social/SocialUserCard";
import { notifySocialUnreadChanged } from "../../utils/socialUnreadEvents";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

type ViewMode = "friends" | "pending";

type Props = {
  initialView?: ViewMode;
};

const TERTIARY = "#9BA39D";
const DANGER = "#B42318";

const withStatus = (user: SocialUserProfile, friendship_status: SocialUserProfile["friendship_status"]) => ({
  ...user,
  friendship_status,
});

export default function FriendsScreen({ initialView = "friends" }: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<ViewMode>(initialView);
  const [friends, setFriends] = useState<SocialUserProfile[]>([]);
  const [incoming, setIncoming] = useState<PendingSocialUserProfile[]>([]);
  const [outgoing, setOutgoing] = useState<PendingSocialUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [selectedUser, setSelectedUser] = useState<SocialUserProfile | null>(null);

  const incomingCount = incoming.length;

  const mutualLabel = useCallback(
    (count: number) => t("social.friends.mutualCount", { count }),
    [t],
  );

  const loadSocialState = useCallback(async () => {
    setLoading(true);
    try {
      const [friendItems, requests] = await Promise.all([getFriends(), getFriendRequests()]);
      setFriends(friendItems);
      setIncoming(requests.incoming);
      setOutgoing(requests.outgoing);
    } catch {
      Alert.alert(t("common.error"), t("social.alerts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void loadSocialState();
    }, [loadSocialState]),
  );

  useEffect(() => {
    setMode(initialView);
  }, [initialView]);

  const snapshot = () => ({
    friends,
    incoming,
    outgoing,
    selectedUser,
  });

  const rollback = (previous: ReturnType<typeof snapshot>) => {
    setFriends(previous.friends);
    setIncoming(previous.incoming);
    setOutgoing(previous.outgoing);
    setSelectedUser(previous.selectedUser);
  };

  const updateSelected = (userId: number, nextStatus: SocialUserProfile["friendship_status"]) => {
    setSelectedUser((current) => (current?.user_id === userId ? withStatus(current, nextStatus) : current));
  };

  const handleAdd = async (user: SocialUserProfile) => {
    const previous = snapshot();
    setBusyUserId(user.user_id);
    setOutgoing((current) => [withStatus(user, "pending_sent"), ...current]);
    updateSelected(user.user_id, "pending_sent");
    try {
      await sendFriendRequest(user.user_id);
    } catch {
      rollback(previous);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleCancel = async (user: SocialUserProfile) => {
    const previous = snapshot();
    setBusyUserId(user.user_id);
    setOutgoing((current) => current.filter((item) => item.user_id !== user.user_id));
    updateSelected(user.user_id, "none");
    try {
      await cancelFriendRequest(user.user_id);
    } catch {
      rollback(previous);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleAccept = async (user: SocialUserProfile) => {
    const previous = snapshot();
    setBusyUserId(user.user_id);
    setIncoming((current) => current.filter((item) => item.user_id !== user.user_id));
    setFriends((current) => [withStatus(user, "friends"), ...current]);
    updateSelected(user.user_id, "friends");
    try {
      const friend = await acceptFriendRequest(user.user_id);
      setFriends((current) => current.map((item) => (item.user_id === friend.user_id ? friend : item)));
      setSelectedUser((current) => (current?.user_id === friend.user_id ? friend : current));
      notifySocialUnreadChanged();
    } catch {
      rollback(previous);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleIgnore = async (user: SocialUserProfile) => {
    const previous = snapshot();
    setBusyUserId(user.user_id);
    setIncoming((current) => current.filter((item) => item.user_id !== user.user_id));
    updateSelected(user.user_id, "none");
    try {
      await declineFriendRequest(user.user_id);
      notifySocialUnreadChanged();
    } catch {
      rollback(previous);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const performRemove = async (user: SocialUserProfile) => {
    const previous = snapshot();
    setBusyUserId(user.user_id);
    setFriends((current) => current.filter((item) => item.user_id !== user.user_id));
    updateSelected(user.user_id, "none");
    try {
      await removeFriend(user.user_id);
    } catch {
      rollback(previous);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const confirmRemove = (user: SocialUserProfile) => {
    Alert.alert(t("social.alerts.removeTitle"), t("social.alerts.removeBody", { name: user.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("social.actions.remove"),
        style: "destructive",
        onPress: () => void performRemove(user),
      },
    ]);
  };

  function actionForUser(user: SocialUserProfile) {
    if (user.friendship_status === "none") {
      return { label: t("social.actions.add"), handler: handleAdd };
    }
    if (user.friendship_status === "pending_sent") {
      return { label: t("social.actions.cancelRequest"), handler: handleCancel };
    }
    if (user.friendship_status === "pending_received") {
      return { label: t("social.actions.accept"), handler: handleAccept };
    }
    return { label: t("social.actions.remove"), handler: confirmRemove };
  }

  const selectedAction = selectedUser ? actionForUser(selectedUser) : null;

  const openMessage = async (user: SocialUserProfile) => {
    try {
      const conversation = await startOrGetDMConversation(user.user_id);
      navigation.navigate("SocialChat", {
        dmConversationId: conversation.id,
        title: conversation.other_user?.name ?? user.name,
        profilePhotoUrl: conversation.other_user?.profile_photo_url ?? user.profile_photo_url,
        initials: conversation.other_user?.initials ?? user.initials,
      });
    } catch {
      Alert.alert(t("common.error"), t("social.messages.alerts.loadConversationsFailed"));
    }
  };

  const shareStackItem = async (user: SocialUserProfile, item: SupplementStackItem) => {
    try {
      const conversation = await startOrGetDMConversation(user.user_id);
      const body = t("social.messages.attach.stackShared");
      await sendMessage({
        dm_conversation_id: conversation.id,
        type: "stack_share",
        body,
        metadata: {
          source_user_id: user.user_id,
          source_user_name: user.name,
          stack_item_id: item.id,
          category: item.category,
          product_name: item.product_name,
          quantity_note: item.quantity_note,
          timing_type: item.timing_type,
          timing_value: item.timing_value,
        },
      });
      setSelectedUser(null);
      navigation.navigate("SocialChat", {
        dmConversationId: conversation.id,
        title: conversation.other_user?.name ?? user.name,
        profilePhotoUrl: conversation.other_user?.profile_photo_url ?? user.profile_photo_url,
        initials: conversation.other_user?.initials ?? user.initials,
      });
    } catch {
      Alert.alert(t("common.error"), t("social.messages.alerts.sendFailed"));
    }
  };

  const pendingBody = useMemo(
    () => (
      <>
        <Text style={styles.sectionTitle}>{t("social.friends.incoming")}</Text>
        {incoming.length === 0 ? <Text style={styles.emptySubtle}>{t("social.friends.noPendingRequests")}</Text> : null}
        {incoming.map((user) => (
          <SocialUserCard
            key={`incoming-${user.user_id}`}
            user={user}
            mutualLabel={mutualLabel(user.mutual_friends_count)}
            primaryLabel={t("social.actions.accept")}
            secondaryLabel={t("social.actions.ignore")}
            disabled={busyUserId === user.user_id}
            onOpenProfile={setSelectedUser}
            onPrimary={handleAccept}
            onSecondary={handleIgnore}
          />
        ))}
        <Text style={styles.sectionTitle}>{t("social.friends.outgoing")}</Text>
        {outgoing.length === 0 ? <Text style={styles.emptySubtle}>{t("social.friends.noOutgoingRequests")}</Text> : null}
        {outgoing.map((user) => (
          <SocialUserCard
            key={`outgoing-${user.user_id}`}
            user={user}
            mutualLabel={mutualLabel(user.mutual_friends_count)}
            primaryLabel={t("social.actions.cancelRequest")}
            disabled={busyUserId === user.user_id}
            onOpenProfile={setSelectedUser}
            onPrimary={handleCancel}
          />
        ))}
      </>
    ),
    [busyUserId, incoming, mutualLabel, outgoing, t],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>{t("social.friends.eyebrow")}</Text>
          <Text style={styles.title}>{t("social.friends.title")}</Text>
        </View>
        <Pressable style={styles.searchButton} onPress={() => navigation.navigate("SocialUserSearch")}>
          <Text style={styles.searchButtonText}>{t("social.friends.searchCta")}</Text>
        </Pressable>
      </View>

      <View style={styles.segment}>
        <Pressable style={[styles.segmentButton, mode === "friends" ? styles.segmentActive : null]} onPress={() => setMode("friends")}>
          <Text style={[styles.segmentText, mode === "friends" ? styles.segmentTextActive : null]}>
            {t("social.friends.friendsWithCount", { count: friends.length })}
          </Text>
        </Pressable>
        <Pressable style={[styles.segmentButton, mode === "pending" ? styles.segmentActive : null]} onPress={() => setMode("pending")}>
          <Text style={[styles.segmentText, mode === "pending" ? styles.segmentTextActive : null]}>
            {t("social.friends.pending")}
          </Text>
          {incomingCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{incomingCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={GREEN} />
        </View>
      ) : mode === "friends" ? (
        <View>
          {friends.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("social.friends.zeroFriendsTitle")}</Text>
              <Text style={styles.emptyBody}>{t("social.friends.zeroFriendsBody")}</Text>
              <Pressable style={styles.emptyButton} onPress={() => navigation.navigate("SocialUserSearch")}>
                <Text style={styles.emptyButtonText}>{t("social.friends.searchByName")}</Text>
              </Pressable>
            </View>
          ) : null}
          {friends.map((user) => (
            <SocialUserCard
              key={`friend-${user.user_id}`}
              user={user}
              mutualLabel={mutualLabel(user.mutual_friends_count)}
              statusLabel={t("social.status.friends")}
              messageLabel={t("social.actions.message")}
              disabled={busyUserId === user.user_id}
              onOpenProfile={setSelectedUser}
              onMessage={openMessage}
            />
          ))}
        </View>
      ) : (
        pendingBody
      )}

      <SocialProfilePeekSheet
        visible={Boolean(selectedUser)}
        user={selectedUser}
        actionLabel={selectedAction?.label}
        actionDisabled={selectedUser ? busyUserId === selectedUser.user_id : false}
        onAction={(user) => selectedAction?.handler(user)}
        onShareStackItem={shareStackItem}
        onClose={() => setSelectedUser(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: BG,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  eyebrow: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  title: {
    color: TEXT,
    fontSize: 24,
    fontWeight: "900",
  },
  searchButton: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchButtonText: {
    color: WHITE,
    fontSize: 13,
    fontWeight: "900",
  },
  segment: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    padding: 5,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    paddingVertical: 10,
  },
  segmentActive: {
    backgroundColor: GREEN_LIGHT,
  },
  segmentText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: GREEN,
  },
  badge: {
    alignItems: "center",
    backgroundColor: DANGER,
    borderRadius: 999,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: WHITE,
    fontSize: 11,
    fontWeight: "900",
  },
  loadingWrap: {
    alignItems: "center",
    padding: 28,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 14,
    padding: 20,
  },
  emptyTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 6,
  },
  emptyBody: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
    textAlign: "center",
  },
  emptyButton: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  emptyButtonText: {
    color: WHITE,
    fontSize: 13,
    fontWeight: "900",
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 8,
    marginTop: 8,
  },
  emptySubtle: {
    color: TERTIARY,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 12,
  },
});
