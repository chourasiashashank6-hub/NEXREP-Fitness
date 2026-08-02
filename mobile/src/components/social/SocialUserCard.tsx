import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SocialUserProfile } from "../../api/social";
import { UserAvatar } from "../UserAvatar";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE_LIGHT = "#FFF1EE";
const ORANGE = "#993C1D";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";

type Props = {
  user: SocialUserProfile;
  mutualLabel: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  statusLabel?: string;
  messageLabel?: string;
  disabled?: boolean;
  onOpenProfile: (user: SocialUserProfile) => void;
  onMessage?: (user: SocialUserProfile) => void;
  onPrimary?: (user: SocialUserProfile) => void;
  onSecondary?: (user: SocialUserProfile) => void;
};

export default function SocialUserCard({
  user,
  mutualLabel,
  primaryLabel,
  secondaryLabel,
  statusLabel,
  messageLabel,
  disabled,
  onOpenProfile,
  onMessage,
  onPrimary,
  onSecondary,
}: Props) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.profileArea} onPress={() => onOpenProfile(user)} accessibilityRole="button">
        <UserAvatar
          name={user.name}
          initials={user.initials}
          profilePhotoUrl={user.profile_photo_url}
          style={styles.avatar}
          textStyle={styles.avatarText}
        />
        <View style={styles.userTextWrap}>
          <Text style={styles.name} numberOfLines={1}>
            {user.name}
          </Text>
          <Text style={styles.mutual} numberOfLines={1}>
            {mutualLabel}
          </Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        {statusLabel ? <Text style={styles.status}>{statusLabel}</Text> : null}
        {messageLabel ? (
          <Pressable style={styles.messageButton} disabled={disabled} onPress={() => onMessage?.(user)}>
            <Text style={styles.messageText}>{messageLabel}</Text>
          </Pressable>
        ) : null}
        {secondaryLabel && onSecondary ? (
          <Pressable style={styles.secondaryButton} disabled={disabled} onPress={() => onSecondary(user)}>
            <Text style={styles.secondaryText}>{secondaryLabel}</Text>
          </Pressable>
        ) : null}
        {primaryLabel && onPrimary ? (
          <Pressable style={styles.primaryButton} disabled={disabled} onPress={() => onPrimary(user)}>
            <Text style={styles.primaryText}>{primaryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
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
  profileArea: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: GREEN_LIGHT,
    borderRadius: 21,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  avatarText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: "900",
  },
  userTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 3,
  },
  mutual: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "500",
  },
  actions: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
    maxWidth: 150,
  },
  primaryButton: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  primaryText: {
    color: WHITE,
    fontSize: 12,
    fontWeight: "800",
  },
  secondaryButton: {
    backgroundColor: ORANGE_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  secondaryText: {
    color: ORANGE,
    fontSize: 12,
    fontWeight: "800",
  },
  messageButton: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  messageText: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "800",
  },
  status: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
});
