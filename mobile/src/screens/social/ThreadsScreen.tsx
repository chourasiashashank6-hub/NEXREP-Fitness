import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  acceptThreadInvite,
  declineThreadInvite,
  listThreads,
  type GymThread,
  type ThreadBucket,
} from "../../api/threads";
import { getThreadStackDetails, type SupplementCategory, type ThreadStackMember } from "../../api/supplementStacks";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#993C1D";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const TERTIARY = "#9BA39D";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";
const STACK_COLORS: Record<SupplementCategory, string> = {
  protein: "#3478C7",
  creatine: "#0F6E56",
  preworkout: "#D99118",
  bcaa: "#7B68CC",
  multivitamin: "#D85A30",
  other: "#6F766F",
};

const buckets: ThreadBucket[] = ["active", "invited", "past"];

const formatThreadTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function ThreadsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [bucket, setBucket] = useState<ThreadBucket>("active");
  const [items, setItems] = useState<GymThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyThreadId, setBusyThreadId] = useState<number | null>(null);
  const [stackSheetThread, setStackSheetThread] = useState<GymThread | null>(null);
  const [stackMembers, setStackMembers] = useState<ThreadStackMember[]>([]);
  const [loadingStacks, setLoadingStacks] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listThreads(bucket));
    } catch {
      Alert.alert(t("common.error"), t("social.threads.alerts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [bucket, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleAccept = async (thread: GymThread) => {
    const previous = items;
    setBusyThreadId(thread.id);
    setItems((current) => current.filter((item) => item.id !== thread.id));
    try {
      await acceptThreadInvite(thread.id);
    } catch {
      setItems(previous);
      Alert.alert(t("common.error"), t("social.threads.alerts.actionFailed"));
    } finally {
      setBusyThreadId(null);
    }
  };

  const handleDecline = async (thread: GymThread) => {
    const previous = items;
    setBusyThreadId(thread.id);
    setItems((current) => current.filter((item) => item.id !== thread.id));
    try {
      await declineThreadInvite(thread.id);
    } catch {
      setItems(previous);
      Alert.alert(t("common.error"), t("social.threads.alerts.actionFailed"));
    } finally {
      setBusyThreadId(null);
    }
  };

  const openStackSheet = async (thread: GymThread) => {
    setStackSheetThread(thread);
    setLoadingStacks(true);
    try {
      setStackMembers(await getThreadStackDetails(thread.id));
    } catch {
      Alert.alert(t("common.error"), t("social.stacks.alerts.loadFailed"));
    } finally {
      setLoadingStacks(false);
    }
  };

  const stackCaption = (thread: GymThread) => {
    const items = thread.stack_summary ?? [];
    const shown = items.slice(0, 3).map((item) => t(`social.stacks.categories.${item.category}`));
    const more = Math.max(0, items.length - shown.length);
    return more > 0 ? `${shown.join(", ")} ${t("social.threads.stackMore", { count: more })}` : shown.join(", ");
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>{t("social.threads.eyebrow")}</Text>
          <Text style={styles.title}>{t("social.threads.title")}</Text>
        </View>
        <Pressable style={styles.createButton} onPress={() => navigation.navigate("SocialThreadCreate")}>
          <Text style={styles.createButtonText}>{t("social.threads.create")}</Text>
        </Pressable>
      </View>

      <View style={styles.segment}>
        {buckets.map((item) => (
          <Pressable
            key={item}
            style={[styles.segmentButton, bucket === item ? styles.segmentActive : null]}
            onPress={() => setBucket(item)}
          >
            <Text style={[styles.segmentText, bucket === item ? styles.segmentTextActive : null]}>
              {t(`social.threads.tabs.${item}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={GREEN} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t(`social.threads.empty.${bucket}.title`)}</Text>
          <Text style={styles.emptyBody}>{t(`social.threads.empty.${bucket}.body`)}</Text>
        </View>
      ) : (
        items.map((thread) => (
          <Pressable
            key={thread.id}
            style={styles.card}
            onPress={() => navigation.navigate("SocialThreadDetail", { threadId: thread.id })}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardText}>
                <Text style={styles.threadTitle} numberOfLines={1}>
                  {thread.title}
                </Text>
                <Text style={styles.threadGym} numberOfLines={1}>
                  {thread.gym_name}
                </Text>
                <Text style={styles.threadTime}>{formatThreadTime(thread.scheduled_time)}</Text>
              </View>
              {thread.current_user_status === "joined" && (thread.stack_summary?.length ?? 0) > 0 ? (
                <Pressable
                  style={styles.stackCluster}
                  onPress={(event) => {
                    event.stopPropagation();
                    void openStackSheet(thread);
                  }}
                >
                  <View style={styles.stackDots}>
                    {(thread.stack_summary ?? []).slice(0, 3).map((item) => (
                      <View key={item.category} style={[styles.stackDot, { backgroundColor: STACK_COLORS[item.category] }]}>
                        <Text style={styles.stackDotText}>{item.count}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.stackCaption} numberOfLines={2}>
                    {stackCaption(thread)}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.supplementSlot}>
                  <Text style={styles.supplementText}>{t("social.threads.supplementSlot")}</Text>
                </View>
              )}
            </View>
            <View style={styles.cardBottom}>
              <View style={styles.avatarRow}>
                {thread.member_preview.slice(0, 4).map((member) => (
                  <View key={member.user_id} style={styles.avatar}>
                    <Text style={styles.avatarText}>{member.initials}</Text>
                  </View>
                ))}
                <Text style={styles.goingText}>{t("social.threads.goingCount", { count: thread.going_count })}</Text>
              </View>
              {bucket === "invited" ? (
                <View style={styles.inviteActions}>
                  <Pressable
                    style={styles.secondaryButton}
                    disabled={busyThreadId === thread.id}
                    onPress={() => handleDecline(thread)}
                  >
                    <Text style={styles.secondaryText}>{t("social.threads.decline")}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.primaryButton}
                    disabled={busyThreadId === thread.id}
                    onPress={() => handleAccept(thread)}
                  >
                    <Text style={styles.primaryText}>{t("social.threads.accept")}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))
      )}
      <Modal visible={Boolean(stackSheetThread)} transparent animationType="slide" onRequestClose={() => setStackSheetThread(null)}>
        <Pressable style={styles.backdrop} onPress={() => setStackSheetThread(null)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{t("social.threads.stackSheetTitle")}</Text>
            {loadingStacks ? (
              <ActivityIndicator color={GREEN} />
            ) : (
              stackMembers.map((member) => (
                <View key={member.user.user_id} style={styles.stackMemberCard}>
                  <View style={styles.stackMemberHeader}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{member.user.initials}</Text>
                    </View>
                    <Text style={styles.stackMemberName}>{member.user.name}</Text>
                  </View>
                  {!member.shared ? (
                    <Text style={styles.stackHidden}>{t("social.threads.stackNotShared")}</Text>
                  ) : member.items.length === 0 ? (
                    <Text style={styles.stackHidden}>{t("social.threads.stackEmpty")}</Text>
                  ) : (
                    member.items.map((item) => (
                      <View key={item.id} style={styles.stackLine}>
                        <View style={[styles.smallDot, { backgroundColor: STACK_COLORS[item.category] }]} />
                        <Text style={styles.stackLineText}>
                          {[item.product_name, item.quantity_note, item.timing_value].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: BG },
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
  title: { color: TEXT, fontSize: 24, fontWeight: "900" },
  createButton: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  createButtonText: { color: WHITE, fontSize: 13, fontWeight: "900" },
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
  segmentButton: { alignItems: "center", borderRadius: 14, flex: 1, paddingVertical: 10 },
  segmentActive: { backgroundColor: GREEN_LIGHT },
  segmentText: { color: MUTED, fontSize: 13, fontWeight: "800" },
  segmentTextActive: { color: GREEN },
  loadingWrap: { alignItems: "center", padding: 28 },
  emptyCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
  },
  emptyTitle: { color: TEXT, fontSize: 17, fontWeight: "900", marginBottom: 6 },
  emptyBody: { color: MUTED, fontSize: 13, lineHeight: 18, textAlign: "center" },
  card: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  cardTop: { flexDirection: "row", gap: 12, marginBottom: 14 },
  cardText: { flex: 1, minWidth: 0 },
  threadTitle: { color: TEXT, fontSize: 17, fontWeight: "900", marginBottom: 4 },
  threadGym: { color: MUTED, fontSize: 13, fontWeight: "700", marginBottom: 3 },
  threadTime: { color: ORANGE, fontSize: 12, fontWeight: "900" },
  supplementSlot: {
    alignItems: "center",
    borderColor: BORDER,
    borderRadius: 14,
    borderStyle: "dashed",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 10,
    width: 82,
  },
  supplementText: { color: TERTIARY, fontSize: 10, fontWeight: "800", textAlign: "center" },
  stackCluster: {
    alignItems: "center",
    backgroundColor: "#F7FBF8",
    borderColor: BORDER,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 62,
    paddingHorizontal: 8,
    width: 108,
  },
  stackDots: { flexDirection: "row", marginBottom: 5 },
  stackDot: {
    alignItems: "center",
    borderColor: WHITE,
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    marginRight: -5,
    width: 24,
  },
  stackDotText: { color: WHITE, fontSize: 9, fontWeight: "900" },
  stackCaption: { color: MUTED, fontSize: 10, fontWeight: "800", textAlign: "center" },
  cardBottom: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  avatarRow: { alignItems: "center", flexDirection: "row", flex: 1 },
  avatar: {
    alignItems: "center",
    backgroundColor: GREEN_LIGHT,
    borderColor: WHITE,
    borderRadius: 15,
    borderWidth: 2,
    height: 30,
    justifyContent: "center",
    marginRight: -6,
    width: 30,
  },
  avatarText: { color: GREEN, fontSize: 10, fontWeight: "900" },
  goingText: { color: MUTED, fontSize: 12, fontWeight: "800", marginLeft: 12 },
  inviteActions: { flexDirection: "row", gap: 6 },
  primaryButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  primaryText: { color: WHITE, fontSize: 12, fontWeight: "900" },
  secondaryButton: { backgroundColor: "#F4EEE8", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { color: ORANGE, fontSize: 12, fontWeight: "900" },
  backdrop: { backgroundColor: "rgba(0,0,0,0.32)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "82%", padding: 18 },
  handle: { alignSelf: "center", backgroundColor: BORDER, borderRadius: 999, height: 4, marginBottom: 16, width: 44 },
  sheetTitle: { color: TEXT, fontSize: 22, fontWeight: "900", marginBottom: 12 },
  stackMemberCard: { borderColor: BORDER, borderRadius: 16, borderWidth: 1, marginBottom: 10, padding: 12 },
  stackMemberHeader: { alignItems: "center", flexDirection: "row", gap: 9, marginBottom: 8 },
  stackMemberName: { color: TEXT, flex: 1, fontSize: 14, fontWeight: "900" },
  stackHidden: { color: TERTIARY, fontSize: 12, fontWeight: "700" },
  stackLine: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 6 },
  smallDot: { borderRadius: 5, height: 10, width: 10 },
  stackLineText: { color: MUTED, flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 17 },
});
