import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { createSquad } from "../../api/gymSquads";
import { getFriends, type SocialUserProfile } from "../../api/social";
import { ScreenContainer } from "../../components/ScreenContainer";
import { UserAvatar } from "../../components/UserAvatar";
import { apiErrorMessage, notifyUser } from "../../utils/notify";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

const TERTIARY = "#9BA39D";
export default function GymSquadCreateScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [name, setName] = useState("");
  const [friends, setFriends] = useState<SocialUserProfile[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<number>>(new Set());
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFriends()
      .then(setFriends)
      .catch(() => notifyUser(t("common.error"), t("social.alerts.loadFailed")))
      .finally(() => setLoadingFriends(false));
  }, [t]);

  const selectedCount = useMemo(() => selectedFriendIds.size, [selectedFriendIds]);

  const toggleFriend = (userId: number) => {
    setSelectedFriendIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < 5) next.add(userId);
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) {
      notifyUser(t("common.required"), t("social.squads.form.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const squad = await createSquad({
        name: name.trim(),
        invite_user_ids: Array.from(selectedFriendIds),
      });
      navigation.replace("SocialGymSquadDetail", { squadId: squad.id });
    } catch (error) {
      notifyUser(
        t("common.error"),
        apiErrorMessage(error, t("social.squads.alerts.saveFailed"), t("social.squads.alerts.unavailable")),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("social.squads.form.title")}</Text>
      </View>

      <Text style={styles.label}>{t("social.squads.form.squadName")}</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t("social.squads.form.namePlaceholder")}
        placeholderTextColor={TERTIARY}
        style={styles.input}
      />

      <Text style={styles.label}>{t("social.squads.form.inviteFriends", { count: selectedCount, max: 5 })}</Text>
      {loadingFriends ? (
        <ActivityIndicator color={GREEN} />
      ) : friends.length === 0 ? (
        <Text style={styles.helper}>{t("social.squads.form.noFriends")}</Text>
      ) : (
        <View style={styles.friendList}>
          {friends.map((friend) => {
            const selected = selectedFriendIds.has(friend.user_id);
            return (
              <Pressable
                key={friend.user_id}
                style={[styles.friendRow, selected ? styles.friendRowSelected : null]}
                onPress={() => toggleFriend(friend.user_id)}
              >
                <UserAvatar name={friend.name} initials={friend.initials} photoUrl={friend.profile_photo_url} size={36} />
                <Text style={styles.friendName}>{friend.name}</Text>
                <Text style={styles.friendCheck}>{selected ? "✓" : ""}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Pressable style={[styles.submitBtn, saving && styles.submitDisabled]} disabled={saving} onPress={() => void submit()}>
        {saving ? <ActivityIndicator color={WHITE} /> : <Text style={styles.submitText}>{t("social.squads.form.create")}</Text>}
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 8 },
  backButton: { paddingVertical: 8, paddingRight: 12 },
  backText: { color: GREEN, fontWeight: "800", fontSize: 14 },
  title: { color: TEXT, fontSize: 20, fontWeight: "900", flex: 1 },
  label: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.6, marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: TEXT,
    fontSize: 15,
    fontWeight: "700",
  },
  helper: { color: MUTED, fontSize: 13, fontWeight: "700" },
  friendList: { gap: 8, marginTop: 4 },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
  },
  friendRowSelected: { borderColor: GREEN, backgroundColor: GREEN_LIGHT },
  friendName: { color: TEXT, fontSize: 14, fontWeight: "800", flex: 1 },
  friendCheck: { color: GREEN, fontSize: 16, fontWeight: "900", width: 18, textAlign: "center" },
  submitBtn: { marginTop: 20, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  submitDisabled: { opacity: 0.7 },
  submitText: { color: WHITE, fontSize: 15, fontWeight: "900" },
});
