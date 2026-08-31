import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { createChallenge, type ChallengeType } from "../../api/socialChallenges";
import { getFriends, type SocialUserProfile } from "../../api/social";
import { ScreenContainer } from "../../components/ScreenContainer";
import { UserAvatar } from "../../components/UserAvatar";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

const ORANGE = "#D85A30";
const TERTIARY = "#9BA39D";
const durations = [3, 7, 14, 30];
const types: ChallengeType[] = ["streak_battle", "workout_count"];

export default function ChallengeCreateScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ChallengeType>("streak_battle");
  const [target, setTarget] = useState("7");
  const [durationDays, setDurationDays] = useState(7);
  const [friends, setFriends] = useState<SocialUserProfile[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<number>>(new Set());
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFriends()
      .then(setFriends)
      .catch(() => Alert.alert(t("common.error"), t("social.alerts.loadFailed")))
      .finally(() => setLoadingFriends(false));
  }, [t]);

  const selectedCount = useMemo(() => selectedFriendIds.size, [selectedFriendIds]);

  const toggleFriend = (userId: number) => {
    setSelectedFriendIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const submit = async () => {
    const parsedTarget = Number(target);
    if (!title.trim()) {
      Alert.alert(t("common.required"), t("social.challenges.form.titleRequired"));
      return;
    }
    if (!Number.isFinite(parsedTarget) || parsedTarget < 1) {
      Alert.alert(t("common.required"), t("social.challenges.form.targetRequired"));
      return;
    }
    setSaving(true);
    try {
      const challenge = await createChallenge({
        title: title.trim(),
        type,
        target: Math.floor(parsedTarget),
        duration_days: durationDays,
        invite_user_ids: Array.from(selectedFriendIds),
      });
      navigation.replace("SocialChallengeDetail", { challengeId: challenge.id });
    } catch {
      Alert.alert(t("common.error"), t("social.challenges.alerts.saveFailed"));
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
        <Text style={styles.title}>{t("social.challenges.form.title")}</Text>
      </View>

      <Text style={styles.label}>{t("social.challenges.form.challengeTitle")}</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={t("social.challenges.form.titlePlaceholder")}
        placeholderTextColor={TERTIARY}
        style={styles.input}
      />

      <Text style={styles.label}>{t("social.challenges.form.type")}</Text>
      <View style={styles.segment}>
        {types.map((item) => {
          const selected = item === type;
          return (
            <Pressable key={item} style={[styles.segmentButton, selected ? styles.segmentActive : null]} onPress={() => setType(item)}>
              <Text style={[styles.segmentText, selected ? styles.segmentTextActive : null]}>{t(`social.challenges.types.${item}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>{t("social.challenges.form.target")}</Text>
      <TextInput
        value={target}
        onChangeText={setTarget}
        keyboardType="number-pad"
        placeholder={type === "streak_battle" ? "7" : "5"}
        placeholderTextColor={TERTIARY}
        style={styles.input}
      />

      <Text style={styles.label}>{t("social.challenges.form.duration")}</Text>
      <View style={styles.durationRow}>
        {durations.map((days) => (
          <Pressable
            key={days}
            style={[styles.durationChip, durationDays === days ? styles.durationChipActive : null]}
            onPress={() => setDurationDays(days)}
          >
            <Text style={[styles.durationText, durationDays === days ? styles.durationTextActive : null]}>
              {t("social.challenges.form.days", { count: days })}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{t("social.challenges.form.inviteFriends")}</Text>
      {loadingFriends ? (
        <ActivityIndicator color={GREEN} />
      ) : friends.length === 0 ? (
        <Text style={styles.emptyText}>{t("social.challenges.form.noFriends")}</Text>
      ) : (
        friends.map((friend) => {
          const selected = selectedFriendIds.has(friend.user_id);
          return (
            <Pressable
              key={friend.user_id}
              style={[styles.friendRow, selected ? styles.friendRowSelected : null]}
              onPress={() => toggleFriend(friend.user_id)}
            >
              <UserAvatar
                name={friend.name}
                initials={friend.initials}
                profilePhotoUrl={friend.profile_photo_url}
                style={styles.avatar}
                textStyle={styles.avatarText}
              />
              <Text style={styles.friendName}>{friend.name}</Text>
              <Text style={styles.selectText}>{selected ? t("social.threads.form.selected") : t("social.threads.form.select")}</Text>
            </Pressable>
          );
        })
      )}
      {selectedCount > 0 ? <Text style={styles.selectedText}>{t("social.threads.form.selectedCount", { count: selectedCount })}</Text> : null}

      <Pressable style={[styles.submitButton, saving ? styles.disabled : null]} disabled={saving} onPress={submit}>
        <Text style={styles.submitText}>{saving ? t("common.saving") : t("social.challenges.form.create")}</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  backButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  title: { color: TEXT, fontSize: 21, fontWeight: "900" },
  label: { color: TEXT, fontSize: 13, fontWeight: "900", marginBottom: 8, marginTop: 10 },
  input: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 16, borderWidth: 1, color: TEXT, fontSize: 15, fontWeight: "700", padding: 13 },
  segment: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 8, padding: 5 },
  segmentButton: { alignItems: "center", borderRadius: 14, flex: 1, paddingVertical: 10 },
  segmentActive: { backgroundColor: GREEN_LIGHT },
  segmentText: { color: MUTED, fontSize: 12, fontWeight: "800" },
  segmentTextActive: { color: GREEN },
  durationRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  durationChip: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 999, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 },
  durationChipActive: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  durationText: { color: MUTED, fontSize: 12, fontWeight: "900" },
  durationTextActive: { color: GREEN },
  friendRow: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 11 },
  friendRowSelected: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  avatarText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  friendName: { color: TEXT, flex: 1, fontSize: 14, fontWeight: "900" },
  selectText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  selectedText: { color: ORANGE, fontSize: 12, fontWeight: "900", marginBottom: 10, marginTop: 2 },
  emptyText: { color: TERTIARY, fontSize: 13, fontWeight: "700", marginBottom: 12 },
  submitButton: { alignItems: "center", backgroundColor: GREEN, borderRadius: 18, marginTop: 18, paddingVertical: 14 },
  submitText: { color: WHITE, fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.55 },
});
