import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { blockSocialUser, submitUserReport, type FriendshipStatus, type SocialUserProfile } from "../../api/social";
import { getFriendSupplementStack, type SupplementStackItem } from "../../api/supplementStacks";
import { UserAvatar } from "../UserAvatar";
import { GREEN, GREEN_LIGHT, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

const TERTIARY = "#9BA39D";
const BACKDROP = "rgba(0,0,0,0.32)";

type Props = {
  visible: boolean;
  user: SocialUserProfile | null;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: (user: SocialUserProfile) => void;
  onShareStackItem?: (user: SocialUserProfile, item: SupplementStackItem) => void;
  onClose: () => void;
};

function statusKey(status: FriendshipStatus) {
  if (status === "friends") return "social.status.friends";
  if (status === "pending_sent") return "social.status.pendingSent";
  if (status === "pending_received") return "social.status.pendingReceived";
  return "social.status.none";
}

export default function SocialProfilePeekSheet({ visible, user, actionLabel, actionDisabled, onAction, onShareStackItem, onClose }: Props) {
  const { t } = useTranslation();
  const [stackItems, setStackItems] = useState<SupplementStackItem[]>([]);
  const [stackVisible, setStackVisible] = useState(false);
  const [loadingStack, setLoadingStack] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!visible || !user || user.friendship_status !== "friends") {
      setStackItems([]);
      setStackVisible(false);
      return;
    }
    setLoadingStack(true);
    getFriendSupplementStack(user.user_id)
      .then((stack) => {
        if (!alive) return;
        setStackVisible(stack.visible);
        setStackItems(stack.items);
      })
      .catch(() => {
        if (!alive) return;
        setStackVisible(false);
        setStackItems([]);
      })
      .finally(() => {
        if (alive) setLoadingStack(false);
      });
    return () => {
      alive = false;
    };
  }, [user, visible]);

  const promptAlsoBlock = (reportedUser: SocialUserProfile) => {
    Alert.alert(t("social.reports.submitted"), t("social.reports.alsoBlock"), [
      { text: t("social.reports.notNow"), style: "cancel" },
      {
        text: t("social.reports.block"),
        style: "destructive",
        onPress: async () => {
          try {
            await blockSocialUser(reportedUser.user_id);
            onClose();
          } catch {
            Alert.alert(t("common.error"), t("social.reports.blockFailed"));
          }
        },
      },
    ]);
  };

  const submitProfileReport = (reportedUser: SocialUserProfile) => {
    Alert.alert(t("social.reports.userTitle"), t("social.reports.reasonPromptUser"), [
      { text: t("social.reports.reasons.harassment"), onPress: () => void reportUser(reportedUser, "harassment") },
      { text: t("social.reports.reasons.spam"), onPress: () => void reportUser(reportedUser, "spam") },
      { text: t("social.reports.reasons.fake_profile"), onPress: () => void reportUser(reportedUser, "fake_profile") },
      { text: t("social.reports.reasons.other"), onPress: () => void reportUser(reportedUser, "other") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const reportUser = async (reportedUser: SocialUserProfile, reason: "harassment" | "spam" | "fake_profile" | "other") => {
    try {
      await submitUserReport({ reported_user_id: reportedUser.user_id, reason, context: "profile" });
      promptAlsoBlock(reportedUser);
    } catch {
      Alert.alert(t("common.error"), t("social.reports.submitFailed"));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />
          {user ? (
            <>
              <View style={styles.header}>
                <UserAvatar
                  name={user.name}
                  initials={user.initials}
                  profilePhotoUrl={user.profile_photo_url}
                  style={styles.avatar}
                  textStyle={styles.avatarText}
                />
                <View style={styles.identity}>
                  <Text style={styles.name}>{user.name}</Text>
                  <Text style={styles.mutual}>
                    {t("social.friends.mutualCount", { count: user.mutual_friends_count })}
                  </Text>
                </View>
                <View style={styles.headerActions}>
                  <Pressable accessibilityRole="button" onPress={() => submitProfileReport(user)} style={styles.iconButton}>
                    <Text style={styles.kebabText}>...</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
                    <Text style={styles.closeText}>{t("common.close")}</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>{t("social.profilePeek.friendshipStatus")}</Text>
                <Text style={styles.statusValue}>{t(statusKey(user.friendship_status))}</Text>
              </View>

              <View style={styles.supplementSlot}>
                <Text style={styles.supplementTitle}>{t("social.profilePeek.supplementStack")}</Text>
                {loadingStack ? (
                  <ActivityIndicator color={GREEN} style={styles.stackLoader} />
                ) : stackVisible && stackItems.length > 0 && user ? (
                  <View style={styles.chipRow}>
                    {stackItems.slice(0, 6).map((item) => (
                      <Pressable
                        key={item.id}
                        style={styles.stackChip}
                        onPress={() => onShareStackItem?.(user, item)}
                      >
                        <Text style={styles.stackChipText} numberOfLines={1}>
                          {item.product_name}
                        </Text>
                        <Text style={styles.stackChipMeta} numberOfLines={1}>
                          {[item.quantity_note, item.timing_value].filter(Boolean).join(" · ")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.supplementBody}>
                    {stackVisible ? t("social.profilePeek.supplementPlaceholder") : t("social.stacks.notShared")}
                  </Text>
                )}
              </View>

              {actionLabel && onAction ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={actionDisabled}
                  style={[styles.actionButton, actionDisabled ? styles.actionButtonDisabled : null]}
                  onPress={() => onAction(user)}
                >
                  <Text style={styles.actionText}>{actionLabel}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: BACKDROP,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    minHeight: "46%",
    padding: 18,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: BORDER,
    borderRadius: 999,
    height: 4,
    marginBottom: 18,
    width: 44,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: GREEN_LIGHT,
    borderRadius: 30,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  avatarText: {
    color: GREEN,
    fontSize: 19,
    fontWeight: "900",
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 4,
  },
  mutual: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "600",
  },
  closeButton: {
    padding: 8,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  iconButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  kebabText: {
    color: MUTED,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  closeText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: "800",
  },
  statusRow: {
    alignItems: "center",
    backgroundColor: "#F7FBF8",
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    padding: 14,
  },
  statusLabel: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  statusValue: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  supplementSlot: {
    borderColor: BORDER,
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  supplementTitle: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 4,
  },
  supplementBody: {
    color: TERTIARY,
    fontSize: 12,
    fontWeight: "600",
  },
  stackLoader: {
    alignSelf: "flex-start",
    marginTop: 6,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  stackChip: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 999,
    maxWidth: "48%",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  stackChipText: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "900",
  },
  stackChipMeta: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 14,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  actionText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: "900",
  },
});
