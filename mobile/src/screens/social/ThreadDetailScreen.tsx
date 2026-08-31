import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  approveThreadJoinRequest,
  cancelThread,
  declineThreadJoinRequest,
  getThread,
  inviteThreadFriends,
  incrementThreadReferralCopy,
  incrementThreadReferralView,
  leaveThread,
  muteThread,
  removeThreadMember,
  removeThreadReferral,
  requestToJoinThread,
  shareThreadReferral,
  unmuteThread,
  upsertThreadReferral,
  type GymThread,
  type ThreadJoinRequest,
  type ThreadMember,
} from "../../api/threads";
import { blockSocialUser, getFriends, submitUserReport, type ReportReason, type SocialUserProfile } from "../../api/social";
import { ScreenContainer } from "../../components/ScreenContainer";
import { UserAvatar } from "../../components/UserAvatar";
import { useAuthStore } from "../../store/authStore";
import { notifySocialUnreadChanged } from "../../utils/socialUnreadEvents";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

const ORANGE = "#993C1D";
const TERTIARY = "#9BA39D";
const DANGER = "#B42318";

const formatThreadTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function ThreadDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const currentUserId = useAuthStore((state) => state.sessionUserId);
  const threadId = Number(route.params?.threadId);
  const [thread, setThread] = useState<GymThread | null>(null);
  const [friends, setFriends] = useState<SocialUserProfile[]>([]);
  const [selectedInviteIds, setSelectedInviteIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [referralModalVisible, setReferralModalVisible] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [referralDescription, setReferralDescription] = useState("");
  const [referralDiscount, setReferralDiscount] = useState("");
  const [busyRequestId, setBusyRequestId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [threadData, friendItems] = await Promise.all([getThread(threadId), getFriends()]);
      setThread(threadData);
      if (threadData.referral) {
        void incrementThreadReferralView(threadData.id).catch(() => undefined);
      }
      setFriends(friendItems);
    } catch {
      Alert.alert(t("common.error"), t("social.threads.alerts.loadFailed"));
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [navigation, t, threadId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleMute = async () => {
    if (!thread) return;
    const previous = thread;
    setThread({ ...thread, muted: !thread.muted });
    try {
      await (thread.muted ? unmuteThread(thread.id) : muteThread(thread.id));
    } catch {
      setThread(previous);
      Alert.alert(t("common.error"), t("social.threads.alerts.actionFailed"));
    }
  };

  const handleInvite = async () => {
    if (!thread || selectedInviteIds.size === 0) return;
    setSaving(true);
    try {
      const updated = await inviteThreadFriends(thread.id, Array.from(selectedInviteIds));
      setThread(updated);
      setSelectedInviteIds(new Set());
    } catch {
      Alert.alert(t("common.error"), t("social.threads.alerts.inviteFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (!thread) return;
    Alert.alert(t("social.threads.detail.cancelTitle"), t("social.threads.detail.cancelBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("social.threads.detail.cancelThread"),
        style: "destructive",
        onPress: async () => {
          try {
            setThread(await cancelThread(thread.id));
          } catch {
            Alert.alert(t("common.error"), t("social.threads.alerts.actionFailed"));
          }
        },
      },
    ]);
  };

  const handleLeave = () => {
    if (!thread) return;
    Alert.alert(t("social.threads.detail.leaveTitle"), t("social.threads.detail.leaveBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("social.threads.detail.leave"),
        style: "destructive",
        onPress: async () => {
          try {
            await leaveThread(thread.id);
            navigation.goBack();
          } catch {
            Alert.alert(t("common.error"), t("social.threads.alerts.actionFailed"));
          }
        },
      },
    ]);
  };

  const handleRemoveMember = async (member: ThreadMember) => {
    if (!thread) return;
    try {
      await removeThreadMember(thread.id, member.user_id);
      setThread(await getThread(thread.id));
    } catch {
      Alert.alert(t("common.error"), t("social.threads.alerts.actionFailed"));
    }
  };

  const promptAlsoBlock = (userId: number) => {
    Alert.alert(t("social.reports.submitted"), t("social.reports.alsoBlock"), [
      { text: t("social.reports.notNow"), style: "cancel" },
      {
        text: t("social.reports.block"),
        style: "destructive",
        onPress: async () => {
          try {
            await blockSocialUser(userId);
          } catch {
            Alert.alert(t("common.error"), t("social.reports.blockFailed"));
          }
        },
      },
    ]);
  };

  const reportMember = async (member: ThreadMember, reason: ReportReason) => {
    if (!thread) return;
    try {
      await submitUserReport({
        reported_user_id: member.user_id,
        reason,
        context: "thread",
        reference_id: thread.id,
      });
      promptAlsoBlock(member.user_id);
    } catch {
      Alert.alert(t("common.error"), t("social.reports.submitFailed"));
    }
  };

  const openMemberReportMenu = (member: ThreadMember) => {
    Alert.alert(t("social.reports.memberTitle"), t("social.reports.reasonPromptMember"), [
      { text: t("social.reports.reasons.harassment"), onPress: () => void reportMember(member, "harassment") },
      { text: t("social.reports.reasons.spam"), onPress: () => void reportMember(member, "spam") },
      { text: t("social.reports.reasons.inappropriate_content"), onPress: () => void reportMember(member, "inappropriate_content") },
      { text: t("social.reports.reasons.other"), onPress: () => void reportMember(member, "other") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const openReferralModal = () => {
    setReferralCode(thread?.referral?.code ?? "");
    setReferralDescription(thread?.referral?.description ?? "");
    setReferralDiscount(thread?.referral?.discount_text ?? "");
    setReferralModalVisible(true);
  };

  const saveReferral = async () => {
    if (!thread || !referralCode.trim()) return;
    setSaving(true);
    try {
      const updated = await upsertThreadReferral(thread.id, {
        code: referralCode.trim(),
        description: referralDescription.trim() || null,
        discount_text: referralDiscount.trim() || null,
      });
      setThread(updated);
      setReferralModalVisible(false);
    } catch {
      Alert.alert(t("common.error"), t("social.threads.referral.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deleteReferral = async () => {
    if (!thread) return;
    setSaving(true);
    try {
      setThread(await removeThreadReferral(thread.id));
      setReferralModalVisible(false);
    } catch {
      Alert.alert(t("common.error"), t("social.threads.referral.removeFailed"));
    } finally {
      setSaving(false);
    }
  };

  const shareReferral = async () => {
    if (!thread) return;
    try {
      await shareThreadReferral(thread.id);
      Alert.alert(t("social.threads.referral.sharedTitle"), t("social.threads.referral.sharedBody"));
    } catch {
      Alert.alert(t("common.error"), t("social.threads.referral.shareFailed"));
    }
  };

  const requestJoin = async () => {
    if (!thread) return;
    setSaving(true);
    try {
      setThread(await requestToJoinThread(thread.id));
    } catch {
      Alert.alert(t("common.error"), t("social.threads.alerts.requestFailed"));
    } finally {
      setSaving(false);
    }
  };

  const respondToJoinRequest = async (request: ThreadJoinRequest, action: "approve" | "decline") => {
    if (!thread) return;
    setBusyRequestId(request.id);
    try {
      setThread(
        action === "approve"
          ? await approveThreadJoinRequest(thread.id, request.id)
          : await declineThreadJoinRequest(thread.id, request.id),
      );
      notifySocialUnreadChanged();
    } catch {
      Alert.alert(t("common.error"), t("social.threads.alerts.actionFailed"));
    } finally {
      setBusyRequestId(null);
    }
  };

  const memberIds = new Set((thread?.members ?? []).map((member) => member.user_id));
  const inviteCandidates = friends.filter((friend) => !memberIds.has(friend.user_id));
  const pendingJoinRequests = thread?.pending_join_requests ?? [];
  const isOutsider = Boolean(thread && !thread.is_member);

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
        {thread?.is_host && thread.status === "active" ? (
          <Pressable style={styles.editButton} onPress={() => navigation.navigate("SocialThreadEdit", { threadId: thread.id })}>
            <Text style={styles.editText}>{t("social.threads.detail.edit")}</Text>
          </Pressable>
        ) : null}
      </View>

      {loading || !thread ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <>
          <View style={styles.heroCard}>
            <View style={styles.statusRow}>
              <Text style={styles.status}>{t(`social.threads.status.${thread.status}`)}</Text>
              <Text style={styles.visibilityBadge}>
                {thread.visibility === "public" ? t("social.threads.visibility.public.badge") : t("social.threads.visibility.private.badge")}
              </Text>
            </View>
            <Text style={styles.title}>{thread.title}</Text>
            <Text style={styles.gym}>{thread.gym_name}</Text>
            <Text style={styles.time}>{formatThreadTime(thread.scheduled_time)}</Text>
            {!isOutsider ? (
              <View style={styles.heroActions}>
              <Pressable style={styles.secondaryButton} onPress={toggleMute}>
                <Text style={styles.secondaryText}>
                  {thread.muted ? t("social.threads.detail.unmute") : t("social.threads.detail.mute")}
                </Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={handleLeave}>
                <Text style={styles.dangerText}>{t("social.threads.detail.leave")}</Text>
              </Pressable>
              {thread.is_host ? (
                <Pressable style={styles.secondaryButton} onPress={handleCancel}>
                  <Text style={styles.dangerText}>{t("social.threads.detail.cancelThread")}</Text>
                </Pressable>
              ) : null}
              </View>
            ) : null}
          </View>

          {isOutsider ? (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("social.threads.detail.membersPreview")}</Text>
                <View style={styles.avatarRow}>
                  {thread.member_preview.slice(0, 5).map((member) => (
                    <UserAvatar
                      key={member.user_id}
                      name={member.name}
                      initials={member.initials}
                      profilePhotoUrl={member.profile_photo_url}
                      style={styles.avatar}
                      textStyle={styles.avatarText}
                    />
                  ))}
                  <Text style={styles.goingText}>{t("social.threads.goingCount", { count: thread.going_count })}</Text>
                </View>
              </View>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("social.threads.detail.hostedBy", { name: thread.host?.name ?? "" })}</Text>
                {thread.host ? (
                  <View style={styles.memberRow}>
                    <UserAvatar
                      name={thread.host.name}
                      initials={thread.host.initials}
                      profilePhotoUrl={thread.host.profile_photo_url}
                      style={styles.avatar}
                      textStyle={styles.avatarText}
                    />
                    <Text style={styles.memberName}>{thread.host.name}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.card}>
                {thread.join_request_status === "pending" ? (
                  <Pressable style={[styles.primaryButton, styles.disabled]} disabled>
                    <Text style={styles.primaryText}>{t("social.threads.detail.requestSent")}</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[styles.primaryButton, saving ? styles.disabled : null]} disabled={saving || !thread.can_request_join} onPress={requestJoin}>
                    <Text style={styles.primaryText}>{t("social.threads.discover.requestToJoin")}</Text>
                  </Pressable>
                )}
                <Text style={styles.helperText}>{t("social.threads.detail.requestHelper")}</Text>
              </View>
            </>
          ) : null}

          {!isOutsider && pendingJoinRequests.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>{t("social.threads.detail.joinRequests")}</Text>
                <Text style={styles.countBadge}>{t("social.threads.detail.newRequests", { count: pendingJoinRequests.length })}</Text>
              </View>
              {pendingJoinRequests.map((request) => (
                <View key={request.id} style={styles.joinRequestRow}>
                  <UserAvatar
                    name={request.requester.name}
                    initials={request.requester.initials}
                    profilePhotoUrl={request.requester.profile_photo_url}
                    style={styles.avatar}
                    textStyle={styles.avatarText}
                  />
                  <View style={styles.memberText}>
                    <Text style={styles.memberName}>{request.requester.name}</Text>
                    <Text style={styles.memberStatus}>
                      {request.requester.mutual_friends_count > 0
                        ? t("social.threads.detail.mutualFriends", { count: request.requester.mutual_friends_count })
                        : t("social.threads.detail.noMutualFriends")}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.secondaryButton, busyRequestId === request.id ? styles.disabled : null]}
                    disabled={busyRequestId === request.id}
                    onPress={() => void respondToJoinRequest(request, "decline")}
                  >
                    <Text style={styles.dangerText}>{t("social.threads.detail.declineRequest")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallButton, busyRequestId === request.id ? styles.disabled : null]}
                    disabled={busyRequestId === request.id}
                    onPress={() => void respondToJoinRequest(request, "approve")}
                  >
                    <Text style={styles.smallButtonText}>{t("social.threads.detail.approveRequest")}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {!isOutsider ? (
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t("social.threads.referral.title")}</Text>
              {thread.is_host ? (
                <Pressable style={styles.smallButton} onPress={openReferralModal}>
                  <Text style={styles.smallButtonText}>{thread.referral ? t("social.threads.referral.edit") : t("social.threads.referral.set")}</Text>
                </Pressable>
              ) : null}
            </View>
            {thread.referral ? (
              <View style={styles.referralCard}>
                <Text style={styles.referralCode}>{thread.referral.code}</Text>
                {thread.referral.discount_text ? <Text style={styles.referralDiscount}>{thread.referral.discount_text}</Text> : null}
                {thread.referral.description ? <Text style={styles.referralDescription}>{thread.referral.description}</Text> : null}
                <Text style={styles.referralStats}>
                  {t("social.threads.referral.stats", { views: thread.referral.viewed_count, copies: thread.referral.copied_count })}
                </Text>
                <View style={styles.referralActions}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => {
                      void incrementThreadReferralCopy(thread.id).catch(() => undefined);
                    }}
                  >
                    <Text style={styles.secondaryText}>{t("social.threads.referral.copyCode")}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={shareReferral}>
                    <Text style={styles.secondaryText}>{t("social.threads.referral.shareInChat")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Text style={styles.emptyText}>{t("social.threads.referral.empty")}</Text>
            )}
          </View>
          ) : null}

          {!isOutsider ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("social.threads.detail.members")}</Text>
            {(thread.members ?? []).map((member) => (
              <View key={member.user_id} style={styles.memberRow}>
                <UserAvatar
                  name={member.name}
                  initials={member.initials}
                  profilePhotoUrl={member.profile_photo_url}
                  style={styles.avatar}
                  textStyle={styles.avatarText}
                />
                <View style={styles.memberText}>
                  <Text style={styles.memberName}>{member.name}</Text>
                  <Text style={styles.memberStatus}>{t(`social.threads.memberStatus.${member.status}`)}</Text>
                </View>
                {member.role === "host" ? <Text style={styles.hostBadge}>{t("social.threads.detail.host")}</Text> : null}
                {thread.is_host && member.role !== "host" ? (
                  <Pressable onPress={() => handleRemoveMember(member)}>
                    <Text style={styles.removeText}>{t("social.threads.detail.remove")}</Text>
                  </Pressable>
                ) : null}
                {member.user_id !== Number(currentUserId) ? (
                  <Pressable onPress={() => openMemberReportMenu(member)}>
                    <Text style={styles.reportText}>{t("social.reports.report")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
          ) : null}

          {!isOutsider ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("social.threads.detail.inviteFriends")}</Text>
            {inviteCandidates.length === 0 ? <Text style={styles.emptyText}>{t("social.threads.detail.noInviteCandidates")}</Text> : null}
            {inviteCandidates.map((friend) => {
              const selected = selectedInviteIds.has(friend.user_id);
              return (
                <Pressable
                  key={friend.user_id}
                  style={[styles.inviteRow, selected ? styles.inviteRowSelected : null]}
                  onPress={() =>
                    setSelectedInviteIds((current) => {
                      const next = new Set(current);
                      if (next.has(friend.user_id)) next.delete(friend.user_id);
                      else next.add(friend.user_id);
                      return next;
                    })
                  }
                >
                  <Text style={styles.inviteName}>{friend.name}</Text>
                  <Text style={styles.inviteAction}>{selected ? t("social.threads.form.selected") : t("social.threads.form.select")}</Text>
                </Pressable>
              );
            })}
            {inviteCandidates.length > 0 ? (
              <Pressable
                style={[styles.primaryButton, selectedInviteIds.size === 0 || saving ? styles.disabled : null]}
                disabled={selectedInviteIds.size === 0 || saving}
                onPress={handleInvite}
              >
                <Text style={styles.primaryText}>{t("social.threads.detail.sendInvites")}</Text>
              </Pressable>
            ) : null}
          </View>
          ) : null}

          {!isOutsider ? (
          <Pressable
            style={styles.chatPlaceholder}
            onPress={() => navigation.navigate("SocialChat", { threadId: thread.id, title: thread.title })}
          >
            <Text style={styles.sectionTitle}>{t("social.threads.detail.chat")}</Text>
            <Text style={styles.emptyText}>{t("social.threads.detail.chatPlaceholder")}</Text>
          </Pressable>
          ) : null}
          <Modal visible={referralModalVisible} transparent animationType="slide" onRequestClose={() => setReferralModalVisible(false)}>
            <Pressable style={styles.backdrop} onPress={() => setReferralModalVisible(false)}>
              <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
                <View style={styles.handle} />
                <Text style={styles.modalTitle}>{t("social.threads.referral.title")}</Text>
                <TextInput
                  value={referralCode}
                  onChangeText={setReferralCode}
                  placeholder={t("social.threads.referral.codePlaceholder")}
                  placeholderTextColor={TERTIARY}
                  style={styles.input}
                  autoCapitalize="characters"
                />
                <TextInput
                  value={referralDiscount}
                  onChangeText={setReferralDiscount}
                  placeholder={t("social.threads.referral.discountPlaceholder")}
                  placeholderTextColor={TERTIARY}
                  style={styles.input}
                />
                <TextInput
                  value={referralDescription}
                  onChangeText={setReferralDescription}
                  placeholder={t("social.threads.referral.descriptionPlaceholder")}
                  placeholderTextColor={TERTIARY}
                  style={[styles.input, styles.multilineInput]}
                  multiline
                />
                <Pressable style={[styles.primaryButton, !referralCode.trim() || saving ? styles.disabled : null]} disabled={!referralCode.trim() || saving} onPress={saveReferral}>
                  <Text style={styles.primaryText}>{t("social.threads.referral.save")}</Text>
                </Pressable>
                {thread.referral ? (
                  <Pressable style={styles.deleteReferralButton} disabled={saving} onPress={deleteReferral}>
                    <Text style={styles.dangerText}>{t("social.threads.referral.remove")}</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            </Pressable>
          </Modal>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  backButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  editButton: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  editText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  loader: { marginTop: 40 },
  heroCard: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 22, borderWidth: 1, marginBottom: 12, padding: 18 },
  statusRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  status: { color: GREEN, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  visibilityBadge: { backgroundColor: GREEN_LIGHT, borderRadius: 999, color: GREEN, fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  title: { color: TEXT, fontSize: 25, fontWeight: "900", marginBottom: 6 },
  gym: { color: MUTED, fontSize: 14, fontWeight: "800", marginBottom: 5 },
  time: { color: ORANGE, fontSize: 13, fontWeight: "900" },
  heroActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  card: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 20, borderWidth: 1, marginBottom: 12, padding: 14 },
  sectionTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 10 },
  sectionHeaderRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  smallButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  smallButtonText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  countBadge: { backgroundColor: GREEN_LIGHT, borderRadius: 999, color: GREEN, fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  referralCard: { backgroundColor: "#F7FBF8", borderColor: BORDER, borderRadius: 16, borderWidth: 1, padding: 12 },
  referralCode: { color: TEXT, fontSize: 22, fontWeight: "900", letterSpacing: 1.3, marginBottom: 4 },
  referralDiscount: { color: GREEN, fontSize: 14, fontWeight: "900", marginBottom: 4 },
  referralDescription: { color: MUTED, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  referralStats: { color: TERTIARY, fontSize: 11, fontWeight: "800", marginTop: 8 },
  referralActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  memberRow: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 8 },
  joinRequestRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 8 },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  avatarText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  avatarRow: { alignItems: "center", flexDirection: "row" },
  goingText: { color: MUTED, fontSize: 12, fontWeight: "800", marginLeft: 12 },
  memberText: { flex: 1, minWidth: 0 },
  memberName: { color: TEXT, fontSize: 14, fontWeight: "900" },
  memberStatus: { color: MUTED, fontSize: 12, fontWeight: "700" },
  hostBadge: { backgroundColor: GREEN_LIGHT, borderRadius: 999, color: GREEN, fontSize: 11, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 4 },
  removeText: { color: DANGER, fontSize: 12, fontWeight: "900" },
  reportText: { color: MUTED, fontSize: 12, fontWeight: "900" },
  inviteRow: { alignItems: "center", borderColor: BORDER, borderRadius: 14, borderWidth: 1, flexDirection: "row", marginBottom: 8, padding: 11 },
  inviteRowSelected: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  inviteName: { color: TEXT, flex: 1, fontSize: 14, fontWeight: "800" },
  inviteAction: { color: GREEN, fontSize: 12, fontWeight: "900" },
  primaryButton: { alignItems: "center", backgroundColor: GREEN, borderRadius: 16, marginTop: 8, paddingVertical: 13 },
  primaryText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  secondaryButton: { backgroundColor: "#F7FBF8", borderColor: BORDER, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  dangerText: { color: DANGER, fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  emptyText: { color: TERTIARY, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  helperText: { color: MUTED, fontSize: 12, fontWeight: "700", lineHeight: 17, marginTop: 8, textAlign: "center" },
  chatPlaceholder: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 20, borderStyle: "dashed", borderWidth: 1, padding: 16 },
  backdrop: { backgroundColor: "rgba(0,0,0,0.32)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18 },
  handle: { alignSelf: "center", backgroundColor: BORDER, borderRadius: 999, height: 4, marginBottom: 16, width: 44 },
  modalTitle: { color: TEXT, fontSize: 22, fontWeight: "900", marginBottom: 12 },
  input: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 14, borderWidth: 1, color: TEXT, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 11 },
  multilineInput: { minHeight: 86, textAlignVertical: "top" },
  deleteReferralButton: { alignItems: "center", marginTop: 12, paddingVertical: 10 },
});
