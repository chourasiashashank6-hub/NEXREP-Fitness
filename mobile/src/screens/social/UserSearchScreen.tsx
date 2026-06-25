import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  searchSocialUsers,
  sendFriendRequest,
  type SocialUserProfile,
} from "../../api/social";
import { ScreenContainer } from "../../components/ScreenContainer";
import SocialProfilePeekSheet from "../../components/social/SocialProfilePeekSheet";
import SocialUserCard from "../../components/social/SocialUserCard";
import { notifySocialUnreadChanged } from "../../utils/socialUnreadEvents";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const TERTIARY = "#9BA39D";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

const withStatus = (user: SocialUserProfile, friendship_status: SocialUserProfile["friendship_status"]) => ({
  ...user,
  friendship_status,
});

export default function UserSearchScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SocialUserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [selectedUser, setSelectedUser] = useState<SocialUserProfile | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      searchSocialUsers(trimmed)
        .then((items) => {
          if (requestId === requestIdRef.current) {
            setResults(items);
          }
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setResults([]);
            Alert.alert(t("common.error"), t("social.alerts.searchFailed"));
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, t]);

  const updateUser = (userId: number, status: SocialUserProfile["friendship_status"]) => {
    setResults((current) => current.map((item) => (item.user_id === userId ? withStatus(item, status) : item)));
    setSelectedUser((current) => (current?.user_id === userId ? withStatus(current, status) : current));
  };

  const rollback = (previousResults: SocialUserProfile[], previousSelected: SocialUserProfile | null) => {
    setResults(previousResults);
    setSelectedUser(previousSelected);
  };

  const handleAdd = async (user: SocialUserProfile) => {
    const previousResults = results;
    const previousSelected = selectedUser;
    setBusyUserId(user.user_id);
    updateUser(user.user_id, "pending_sent");
    try {
      await sendFriendRequest(user.user_id);
    } catch {
      rollback(previousResults, previousSelected);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleCancel = async (user: SocialUserProfile) => {
    const previousResults = results;
    const previousSelected = selectedUser;
    setBusyUserId(user.user_id);
    updateUser(user.user_id, "none");
    try {
      await cancelFriendRequest(user.user_id);
    } catch {
      rollback(previousResults, previousSelected);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleAccept = async (user: SocialUserProfile) => {
    const previousResults = results;
    const previousSelected = selectedUser;
    setBusyUserId(user.user_id);
    updateUser(user.user_id, "friends");
    try {
      const friend = await acceptFriendRequest(user.user_id);
      setResults((current) => current.map((item) => (item.user_id === friend.user_id ? friend : item)));
      setSelectedUser((current) => (current?.user_id === friend.user_id ? friend : current));
      notifySocialUnreadChanged();
    } catch {
      rollback(previousResults, previousSelected);
      Alert.alert(t("common.error"), t("social.alerts.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  };

  const actionForUser = (user: SocialUserProfile) => {
    if (user.friendship_status === "none") {
      return { label: t("social.actions.add"), handler: handleAdd };
    }
    if (user.friendship_status === "pending_sent") {
      return { label: t("social.actions.cancelRequest"), handler: handleCancel };
    }
    if (user.friendship_status === "pending_received") {
      return { label: t("social.actions.accept"), handler: handleAccept };
    }
    return { statusLabel: t("social.status.friends"), messageLabel: t("social.actions.message") };
  };

  const selectedAction = selectedUser ? actionForUser(selectedUser) : null;
  const emptyText = useMemo(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) return t("social.search.startTyping");
    return t("social.search.noResults");
  }, [query, t]);

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("social.search.title")}</Text>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("social.search.placeholder")}
        placeholderTextColor={TERTIARY}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
      />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={GREEN} />
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        results.map((user) => {
          const action = actionForUser(user);
          return (
            <SocialUserCard
              key={user.user_id}
              user={user}
              mutualLabel={t("social.friends.mutualCount", { count: user.mutual_friends_count })}
              primaryLabel={"label" in action ? action.label : undefined}
              statusLabel={"statusLabel" in action ? action.statusLabel : undefined}
              messageLabel={"messageLabel" in action ? action.messageLabel : undefined}
              disabled={busyUserId === user.user_id}
              onOpenProfile={setSelectedUser}
              onPrimary={"handler" in action ? action.handler : undefined}
            />
          );
        })
      )}

      <SocialProfilePeekSheet
        visible={Boolean(selectedUser)}
        user={selectedUser}
        actionLabel={selectedAction && "label" in selectedAction ? selectedAction.label : undefined}
        actionDisabled={selectedUser ? busyUserId === selectedUser.user_id : false}
        onAction={
          selectedAction && "handler" in selectedAction
            ? selectedAction.handler
            : undefined
        }
        onClose={() => setSelectedUser(null)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: "900",
  },
  title: {
    color: TEXT,
    flex: 1,
    fontSize: 23,
    fontWeight: "900",
  },
  input: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    color: TEXT,
    fontSize: 15,
    marginBottom: 16,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  loadingWrap: {
    alignItems: "center",
    padding: 28,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
});
