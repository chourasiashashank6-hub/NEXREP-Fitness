import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { listConversations, type ChatConversation } from "../../api/messages";
import { UserAvatar } from "../../components/UserAvatar";
import { notifySocialUnreadChanged } from "../../utils/socialUnreadEvents";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

const TERTIARY = "#9BA39D";
const DANGER = "#B42318";

const previewFor = (conversation: ChatConversation, deletedLabel: string) => {
  const message = conversation.last_message;
  if (!message) return "";
  if (message.deleted) return deletedLabel;
  return message.body || message.type.replace("_", " ");
};

const timeFor = (value?: string | null) => {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

export default function ChatsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listConversations());
      notifySocialUnreadChanged();
    } catch {
      Alert.alert(t("common.error"), t("social.chats.alerts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openConversation = (conversation: ChatConversation) => {
    if (conversation.kind === "thread") {
      navigation.navigate("SocialChat", {
        threadId: conversation.thread_id,
        title: conversation.title,
      });
      return;
    }
    navigation.navigate("SocialChat", {
      dmConversationId: conversation.id,
      title: conversation.other_user?.name ?? t("social.messages.chat"),
      profilePhotoUrl: conversation.other_user?.profile_photo_url,
      initials: conversation.other_user?.initials,
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>{t("social.chats.eyebrow")}</Text>
        <Text style={styles.title}>{t("social.chats.title")}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("social.chats.emptyTitle")}</Text>
          <Text style={styles.emptyBody}>{t("social.chats.emptyBody")}</Text>
        </View>
      ) : (
        items.map((conversation) => {
          const key = conversation.kind === "thread" ? `thread-${conversation.thread_id}` : `dm-${conversation.id}`;
          const isThread = conversation.kind === "thread";
          const title = isThread
            ? conversation.title
            : conversation.other_user?.name ?? t("social.messages.unknownUser");
          const subtitle = isThread ? conversation.gym_name : null;
          const preview = previewFor(conversation, t("social.messages.deleted")) || t("social.messages.noMessagesYet");
          const timestamp = conversation.last_message?.created_at ?? (isThread ? conversation.scheduled_time : conversation.created_at);

          return (
            <Pressable key={key} style={styles.row} onPress={() => openConversation(conversation)}>
              {isThread ? (
                <View style={styles.threadAvatar}>
                  <Text style={styles.threadAvatarText}>#</Text>
                </View>
              ) : (
                <UserAvatar
                  name={conversation.other_user?.name}
                  initials={conversation.other_user?.initials ?? "DM"}
                  profilePhotoUrl={conversation.other_user?.profile_photo_url}
                  style={styles.avatar}
                  textStyle={styles.avatarText}
                />
              )}
              <View style={styles.textWrap}>
                <View style={styles.titleRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {title}
                  </Text>
                  {isThread ? (
                    <View style={styles.threadBadge}>
                      <Text style={styles.threadBadgeText}>{t("social.chats.threadBadge")}</Text>
                    </View>
                  ) : null}
                </View>
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
                <Text style={styles.preview} numberOfLines={1}>
                  {preview}
                </Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.time}>{timeFor(timestamp)}</Text>
                {conversation.unread_count > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{conversation.unread_count}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: BG },
  headerRow: { marginBottom: 14 },
  eyebrow: { color: GREEN, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginBottom: 4, textTransform: "uppercase" },
  title: { color: TEXT, fontSize: 24, fontWeight: "900" },
  loader: { marginTop: 40 },
  emptyCard: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 20, borderWidth: 1, padding: 22 },
  emptyTitle: { color: TEXT, fontSize: 17, fontWeight: "900", marginBottom: 6 },
  emptyBody: { color: MUTED, fontSize: 13, lineHeight: 18, textAlign: "center" },
  row: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    padding: 12,
  },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  avatarText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  threadAvatar: {
    alignItems: "center",
    backgroundColor: GREEN_LIGHT,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  threadAvatarText: { color: GREEN, fontSize: 18, fontWeight: "900" },
  textWrap: { flex: 1, minWidth: 0 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 2 },
  name: { color: TEXT, flex: 1, fontSize: 15, fontWeight: "900" },
  threadBadge: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  threadBadgeText: { color: GREEN, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  subtitle: { color: TERTIARY, fontSize: 11, fontWeight: "700", marginBottom: 3 },
  preview: { color: MUTED, fontSize: 13, fontWeight: "600" },
  meta: { alignItems: "flex-end", gap: 6 },
  time: { color: TERTIARY, fontSize: 11, fontWeight: "700" },
  badge: { alignItems: "center", backgroundColor: DANGER, borderRadius: 999, minWidth: 22, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { color: WHITE, fontSize: 11, fontWeight: "900" },
});
