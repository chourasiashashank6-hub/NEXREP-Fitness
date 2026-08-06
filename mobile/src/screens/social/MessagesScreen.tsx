import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { listDMConversations, type DMConversation } from "../../api/messages";
import { UserAvatar } from "../../components/UserAvatar";
import { notifySocialUnreadChanged } from "../../utils/socialUnreadEvents";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const TERTIARY = "#9BA39D";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";
const DANGER = "#B42318";

const previewFor = (conversation: DMConversation, deletedLabel: string) => {
  const message = conversation.last_message;
  if (!message) return "";
  if (message.deleted) return deletedLabel;
  return message.body || message.type.replace("_", " ");
};

const timeFor = (value?: string | null) => {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

export default function MessagesScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<DMConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listDMConversations());
      notifySocialUnreadChanged();
    } catch {
      Alert.alert(t("common.error"), t("social.messages.alerts.loadConversationsFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>{t("social.messages.eyebrow")}</Text>
        <Text style={styles.title}>{t("social.messages.title")}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("social.messages.emptyTitle")}</Text>
          <Text style={styles.emptyBody}>{t("social.messages.emptyBody")}</Text>
        </View>
      ) : (
        items.map((conversation) => (
          <Pressable
            key={conversation.id}
            style={styles.row}
            onPress={() =>
              navigation.navigate("SocialChat", {
                dmConversationId: conversation.id,
                title: conversation.other_user?.name ?? t("social.messages.chat"),
                profilePhotoUrl: conversation.other_user?.profile_photo_url,
                initials: conversation.other_user?.initials,
              })
            }
          >
            <UserAvatar
              name={conversation.other_user?.name}
              initials={conversation.other_user?.initials ?? "DM"}
              profilePhotoUrl={conversation.other_user?.profile_photo_url}
              style={styles.avatar}
              textStyle={styles.avatarText}
            />
            <View style={styles.textWrap}>
              <Text style={styles.name} numberOfLines={1}>
                {conversation.other_user?.name ?? t("social.messages.unknownUser")}
              </Text>
              <Text style={styles.preview} numberOfLines={1}>
                {previewFor(conversation, t("social.messages.deleted")) || t("social.messages.noMessagesYet")}
              </Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.time}>{timeFor(conversation.last_message?.created_at)}</Text>
              {conversation.unread_count > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{conversation.unread_count}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))
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
  row: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 10, padding: 12 },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  avatarText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  textWrap: { flex: 1, minWidth: 0 },
  name: { color: TEXT, fontSize: 15, fontWeight: "900", marginBottom: 4 },
  preview: { color: MUTED, fontSize: 13, fontWeight: "600" },
  meta: { alignItems: "flex-end", gap: 6 },
  time: { color: TERTIARY, fontSize: 11, fontWeight: "700" },
  badge: { alignItems: "center", backgroundColor: DANGER, borderRadius: 999, minWidth: 22, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { color: WHITE, fontSize: 11, fontWeight: "900" },
});
