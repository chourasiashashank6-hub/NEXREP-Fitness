import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AlertButton,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  deleteMessage,
  editMessage,
  fetchMessages,
  markConversationRead,
  sendMessage,
  type ChatMessage,
  type MessageType,
} from "../../api/messages";
import { blockSocialUser, submitUserReport, type ReportReason } from "../../api/social";
import { incrementThreadReferralCopy, shareThreadReferral } from "../../api/threads";
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
const OWN = "#0F6E56";
const OTHER = "#FFFFFF";

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const stackText = (metadata: Record<string, unknown>, fallback?: string | null) => ({
  sourceName: typeof metadata.source_user_name === "string" ? metadata.source_user_name : "",
  product: typeof metadata.product_name === "string" ? metadata.product_name : fallback ?? "",
  quantity: typeof metadata.quantity_note === "string" ? metadata.quantity_note : "",
  timing: typeof metadata.timing_value === "string" ? metadata.timing_value : "",
});

const referralText = (metadata: Record<string, unknown>, fallback?: string | null) => ({
  code: typeof metadata.code === "string" ? metadata.code : fallback ?? "",
  description: typeof metadata.description === "string" ? metadata.description : "",
  discount: typeof metadata.discount_text === "string" ? metadata.discount_text : "",
});

export default function ChatScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const threadId = route.params?.threadId ? Number(route.params.threadId) : undefined;
  const dmConversationId = route.params?.dmConversationId ? Number(route.params.dmConversationId) : undefined;
  const title = route.params?.title || t("social.messages.chat");
  const profilePhotoUrl = route.params?.profilePhotoUrl as string | undefined;
  const initials = route.params?.initials as string | undefined;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);

  const conversationParams = useMemo(
    () => (threadId ? { thread_id: threadId } : { dm_conversation_id: dmConversationId }),
    [dmConversationId, threadId],
  );

  const load = useCallback(async () => {
    if (!threadId && !dmConversationId) return;
    try {
      const items = await fetchMessages(conversationParams);
      setMessages(items);
      const last = items[items.length - 1];
      if (last) {
        void markConversationRead({ ...conversationParams, last_read_message_id: last.id })
          .then(() => notifySocialUnreadChanged())
          .catch(() => undefined);
      }
    } catch {
      Alert.alert(t("common.error"), t("social.messages.alerts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [conversationParams, dmConversationId, t, threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (AppState.currentState === "active") void load();
    };
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [load]);

  const submit = async (type: MessageType = "text", bodyOverride?: string) => {
    const body = (bodyOverride ?? input).trim();
    if (type === "text" && !body) return;
    setSending(true);
    try {
      if (editing) {
        const updated = await editMessage(editing.id, body);
        setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setEditing(null);
      } else {
        const created = await sendMessage({
          ...conversationParams,
          type,
          body: body || type.replace("_", " "),
          reply_to_message_id: replyTo?.id ?? undefined,
        });
        setMessages((current) => [...current, created]);
        setReplyTo(null);
      }
      setInput("");
    } catch {
      Alert.alert(t("common.error"), t("social.messages.alerts.sendFailed"));
    } finally {
      setSending(false);
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

  const reportMessage = async (message: ChatMessage, reason: ReportReason) => {
    try {
      await submitUserReport({
        reported_user_id: message.sender.user_id,
        reason,
        context: "message",
        reference_id: message.id,
      });
      promptAlsoBlock(message.sender.user_id);
    } catch {
      Alert.alert(t("common.error"), t("social.reports.submitFailed"));
    }
  };

  const openReportMenu = (message: ChatMessage) => {
    Alert.alert(t("social.reports.messageTitle"), t("social.reports.reasonPromptMessage"), [
      { text: t("social.reports.reasons.harassment"), onPress: () => void reportMessage(message, "harassment") },
      { text: t("social.reports.reasons.spam"), onPress: () => void reportMessage(message, "spam") },
      { text: t("social.reports.reasons.inappropriate_content"), onPress: () => void reportMessage(message, "inappropriate_content") },
      { text: t("social.reports.reasons.other"), onPress: () => void reportMessage(message, "other") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const handleShareReferral = async () => {
    if (!threadId) {
      Alert.alert(t("common.error"), t("social.messages.referral.threadOnly"));
      return;
    }
    setSending(true);
    try {
      const created = await shareThreadReferral(threadId);
      setMessages((current) => [...current, created]);
    } catch {
      Alert.alert(t("common.error"), t("social.messages.referral.noneSet"));
    } finally {
      setSending(false);
    }
  };

  const handleLongPress = (message: ChatMessage) => {
    const buttons: AlertButton[] = [
      { text: t("social.messages.actions.reply"), onPress: () => setReplyTo(message) },
    ];
    if (message.is_own && message.type === "text" && !message.deleted) {
      buttons.push({
        text: t("social.messages.actions.edit"),
        onPress: () => {
          setEditing(message);
          setInput(message.body ?? "");
        },
      });
    }
    if (message.is_own && !message.deleted) {
      buttons.push({
        text: t("social.messages.actions.delete"),
        onPress: async () => {
          await deleteMessage(message.id);
          setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, deleted: true, body: null } : item)));
        },
      });
    }
    if (!message.is_own && !message.deleted) {
      buttons.push({
        text: t("social.reports.report"),
        style: "destructive",
        onPress: () => openReportMenu(message),
      });
    }
    buttons.push({ text: t("common.cancel"), style: "cancel" as const });
    Alert.alert(t("social.messages.actions.messageOptions"), undefined, buttons);
  };

  const openAttachmentMenu = () => {
    Alert.alert(t("social.messages.attach.title"), undefined, [
      { text: t("social.messages.attach.location"), onPress: () => submit("location", t("social.messages.attach.locationShared")) },
      { text: t("social.messages.attach.referral"), onPress: handleShareReferral },
      { text: t("social.messages.attach.workout"), onPress: () => submit("workout_share", t("social.messages.attach.workoutShared")) },
      { text: t("social.messages.attach.stack"), onPress: () => submit("stack_share", t("social.messages.attach.stackShared")) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.type === "system") {
      return <Text style={styles.systemText}>{item.body}</Text>;
    }
    const own = item.is_own;
    return (
      <Pressable
        onLongPress={() => handleLongPress(item)}
        style={[styles.messageWrap, own ? styles.messageWrapOwn : styles.messageWrapOther]}
      >
        <View style={[styles.bubble, own ? styles.ownBubble : styles.otherBubble]}>
          {item.reply_to ? (
            <View style={styles.quote}>
              <Text style={styles.quoteName}>{item.reply_to.sender?.name ?? t("social.messages.deletedSender")}</Text>
              <Text style={styles.quoteBody} numberOfLines={1}>
                {item.reply_to.deleted ? t("social.messages.deleted") : item.reply_to.body}
              </Text>
            </View>
          ) : null}
          {!own ? <Text style={styles.senderName}>{item.sender.name}</Text> : null}
          {item.type === "referral" && !item.deleted ? (
            <View style={[styles.referralCard, own ? styles.referralCardOwn : null]}>
              <Text style={[styles.referralLabel, own ? styles.ownMeta : null]}>{t("social.messages.referral.codeLabel")}</Text>
              <Text style={[styles.referralCode, own ? styles.ownText : null]}>{referralText(item.metadata, item.body).code}</Text>
              {referralText(item.metadata, item.body).discount ? (
                <Text style={[styles.referralDiscount, own ? styles.ownText : null]}>{referralText(item.metadata, item.body).discount}</Text>
              ) : null}
              {referralText(item.metadata, item.body).description ? (
                <Text style={[styles.referralDescription, own ? styles.ownMeta : null]}>
                  {referralText(item.metadata, item.body).description}
                </Text>
              ) : null}
              {item.thread_id ? (
                <Pressable
                  style={[styles.copyButton, own ? styles.copyButtonOwn : null]}
                  onPress={() => void incrementThreadReferralCopy(Number(item.thread_id)).catch(() => undefined)}
                >
                  <Text style={[styles.copyText, own ? styles.ownText : null]}>{t("social.messages.referral.copyCode")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : item.type === "stack_share" && !item.deleted ? (
            <View style={[styles.stackCard, own ? styles.stackCardOwn : null]}>
              <Text style={[styles.stackCardTitle, own ? styles.ownText : null]}>
                {t("social.messages.stackCard.title", { name: stackText(item.metadata, item.body).sourceName || item.sender.name })}
              </Text>
              <Text style={[styles.stackCardProduct, own ? styles.ownText : null]}>{stackText(item.metadata, item.body).product}</Text>
              <Text style={[styles.stackCardMeta, own ? styles.ownMeta : null]}>
                {[stackText(item.metadata, item.body).quantity, stackText(item.metadata, item.body).timing].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ) : (
            <Text style={[styles.messageText, own ? styles.ownText : null]}>
              {item.deleted ? t("social.messages.deleted") : item.body}
            </Text>
          )}
          <Text style={[styles.metaText, own ? styles.ownMeta : null]}>
            {formatTime(item.created_at)}
            {item.edited_at ? ` · ${t("social.messages.edited")}` : ""}
            {own ? ` · ${t("social.messages.read")}` : ""}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 4 : 0}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>{t("common.back")}</Text>
          </Pressable>
          {dmConversationId ? (
            <UserAvatar
              name={title}
              initials={initials}
              profilePhotoUrl={profilePhotoUrl}
              size={36}
              style={styles.headerAvatar}
              textStyle={styles.headerAvatarText}
            />
          ) : null}
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={GREEN} style={styles.loader} />
        ) : (
          <FlatList
            style={styles.flex}
            data={messages}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderMessage}
            ListEmptyComponent={<Text style={styles.emptyChatText}>{t("social.messages.emptyChat")}</Text>}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          />
        )}
        {replyTo || editing ? (
          <View style={styles.composerContext}>
            <Text style={styles.contextLabel}>
              {editing ? t("social.messages.editing") : t("social.messages.replyingTo", { name: replyTo?.sender.name })}
            </Text>
            <Pressable onPress={() => { setReplyTo(null); setEditing(null); setInput(""); }}>
              <Text style={styles.clearContext}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composer}>
          <Pressable style={styles.attachButton} onPress={openAttachmentMenu}>
            <Text style={styles.attachText}>+</Text>
          </Pressable>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t("social.messages.placeholder")}
            placeholderTextColor={TERTIARY}
            style={styles.input}
            multiline
          />
          <Pressable style={[styles.sendButton, sending ? styles.disabled : null]} disabled={sending} onPress={() => submit()}>
            <Text style={styles.sendText}>{t("social.messages.send")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <SafeAreaView edges={["bottom"]} style={styles.bottomInset} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  bottomInset: { backgroundColor: BG },
  header: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 12, paddingHorizontal: 16, paddingTop: 4 },
  headerAvatar: { backgroundColor: GREEN_LIGHT },
  headerAvatarText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  backButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  title: { color: TEXT, flex: 1, fontSize: 20, fontWeight: "900" },
  loader: { marginTop: 40 },
  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 12 },
  emptyChatText: { alignSelf: "center", color: TERTIARY, fontSize: 13, fontWeight: "800", marginTop: 40, textAlign: "center" },
  systemText: { alignSelf: "center", color: MUTED, fontSize: 12, fontWeight: "700", marginVertical: 8, textAlign: "center" },
  messageWrap: { marginBottom: 9, maxWidth: "84%" },
  messageWrapOwn: { alignSelf: "flex-end" },
  messageWrapOther: { alignSelf: "flex-start" },
  bubble: { borderRadius: 18, padding: 11 },
  ownBubble: { backgroundColor: OWN },
  otherBubble: { backgroundColor: OTHER, borderColor: BORDER, borderWidth: 1 },
  senderName: { color: GREEN, fontSize: 11, fontWeight: "900", marginBottom: 4 },
  messageText: { color: TEXT, fontSize: 14, lineHeight: 19 },
  ownText: { color: WHITE },
  metaText: { color: MUTED, fontSize: 10, fontWeight: "700", marginTop: 5 },
  ownMeta: { color: "rgba(255,255,255,0.72)" },
  quote: { backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 10, marginBottom: 7, padding: 7 },
  quoteName: { color: GREEN, fontSize: 11, fontWeight: "900" },
  quoteBody: { color: MUTED, fontSize: 11, fontWeight: "700" },
  stackCard: { backgroundColor: "rgba(15,110,86,0.08)", borderRadius: 14, padding: 10 },
  stackCardOwn: { backgroundColor: "rgba(255,255,255,0.14)" },
  stackCardTitle: { color: GREEN, fontSize: 11, fontWeight: "900", marginBottom: 5 },
  stackCardProduct: { color: TEXT, fontSize: 15, fontWeight: "900", marginBottom: 3 },
  stackCardMeta: { color: MUTED, fontSize: 12, fontWeight: "700" },
  referralCard: { backgroundColor: "rgba(153,60,29,0.08)", borderColor: "rgba(153,60,29,0.18)", borderRadius: 14, borderWidth: 1, padding: 11 },
  referralCardOwn: { backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.22)" },
  referralLabel: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.7, marginBottom: 5, textTransform: "uppercase" },
  referralCode: { color: TEXT, fontSize: 20, fontWeight: "900", letterSpacing: 1.2, marginBottom: 4 },
  referralDiscount: { color: TEXT, fontSize: 13, fontWeight: "900", marginBottom: 4 },
  referralDescription: { color: MUTED, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  copyButton: { alignSelf: "flex-start", backgroundColor: GREEN_LIGHT, borderRadius: 999, marginTop: 9, paddingHorizontal: 10, paddingVertical: 7 },
  copyButtonOwn: { backgroundColor: "rgba(255,255,255,0.16)" },
  copyText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  composerContext: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginHorizontal: 16, padding: 10 },
  contextLabel: { color: MUTED, flex: 1, fontSize: 12, fontWeight: "800" },
  clearContext: { color: GREEN, fontSize: 12, fontWeight: "900" },
  composer: { alignItems: "flex-end", flexDirection: "row", gap: 8, marginHorizontal: 16, paddingBottom: 8 },
  attachButton: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  attachText: { color: GREEN, fontSize: 24, fontWeight: "700", lineHeight: 26 },
  input: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 18, borderWidth: 1, color: TEXT, flex: 1, maxHeight: 110, minHeight: 42, paddingHorizontal: 12, paddingVertical: 10 },
  sendButton: { backgroundColor: GREEN, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 11 },
  sendText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.6 },
});
