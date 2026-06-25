import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { CommonActions, useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { getFriends, type SocialUserProfile } from "../../api/social";
import { createThread, getThread, updateThread, type GymThread, type ThreadStatus, type ThreadVisibility } from "../../api/threads";
import { ScreenContainer } from "../../components/ScreenContainer";
import { UserAvatar } from "../../components/UserAvatar";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const TERTIARY = "#9BA39D";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";

const toLocalInputDate = (date: Date) =>
  date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

type Mode = "create" | "edit";

export default function ThreadFormScreen({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const threadId = Number(route.params?.threadId ?? 0);
  const [title, setTitle] = useState("");
  const [initialTitle, setInitialTitle] = useState("");
  const [gymName, setGymName] = useState("");
  const [initialGymName, setInitialGymName] = useState("");
  const [visibility, setVisibility] = useState<ThreadVisibility>("private");
  const [initialVisibility, setInitialVisibility] = useState<ThreadVisibility>("private");
  const [threadStatus, setThreadStatus] = useState<ThreadStatus>("active");
  const [dateChanged, setDateChanged] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => {
    const next = new Date();
    next.setHours(next.getHours() + 2, 0, 0, 0);
    return next;
  });
  const [friends, setFriends] = useState<SocialUserProfile[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    void getFriends()
      .then(setFriends)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !threadId) return;
    setLoading(true);
    getThread(threadId)
      .then((thread) => {
        setTitle(thread.title);
        setInitialTitle(thread.title);
        setGymName(thread.gym_name);
        setInitialGymName(thread.gym_name);
        setScheduledAt(new Date(thread.scheduled_time));
        setVisibility(thread.visibility);
        setInitialVisibility(thread.visibility);
        setThreadStatus(thread.status);
        setDateChanged(false);
      })
      .catch(() => Alert.alert(t("common.error"), t("social.threads.alerts.loadFailed")))
      .finally(() => setLoading(false));
  }, [mode, t, threadId]);

  const selectedFriends = useMemo(
    () => friends.filter((friend) => selectedFriendIds.has(friend.user_id)),
    [friends, selectedFriendIds],
  );

  const toggleFriend = (userId: number) => {
    setSelectedFriendIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== "ios") setShowPicker(false);
    if (date) {
      setScheduledAt(date);
      setDateChanged(true);
    }
  };

  const openDatePicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: scheduledAt,
        onChange: (event, date) => {
          if (event.type === "dismissed" || !date) return;
          const nextDate = new Date(scheduledAt);
          nextDate.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
          DateTimePickerAndroid.open({
            mode: "time",
            value: nextDate,
            onChange: (timeEvent, time) => {
              if (timeEvent.type === "dismissed" || !time) return;
              const next = new Date(nextDate);
              next.setHours(time.getHours(), time.getMinutes(), 0, 0);
              setScheduledAt(next);
              setDateChanged(true);
            },
          });
        },
      });
      return;
    }
    setShowPicker((current) => !current);
  };

  const submit = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert(t("common.required"), t("social.threads.form.titleRequired"));
      return;
    }
    if (!gymName.trim()) {
      Alert.alert(t("common.required"), t("social.threads.form.gymRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        gym: {
          name: gymName.trim(),
          place_id: null,
        },
        scheduled_time: scheduledAt.toISOString(),
        visibility,
      };
      const thread =
        mode === "edit"
          ? await updateThread(threadId, {
              ...(payload.title !== initialTitle ? { title: payload.title } : {}),
              ...(payload.gym.name !== initialGymName ? { gym: payload.gym } : {}),
              ...(dateChanged ? { scheduled_time: payload.scheduled_time } : {}),
              ...(visibility !== initialVisibility ? { visibility } : {}),
            })
          : await createThread({
              ...payload,
              invite_user_ids: Array.from(selectedFriendIds),
            });
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [
            { name: "SocialThreads" },
            { name: "SocialThreadDetail", params: { threadId: thread.id } },
          ],
        }),
      );
    } catch {
      Alert.alert(t("common.error"), t("social.threads.alerts.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [dateChanged, gymName, initialGymName, initialTitle, initialVisibility, mode, navigation, scheduledAt, selectedFriendIds, t, threadId, title, visibility]);

  const showPrivateSwitchWarning = mode === "edit" && initialVisibility === "public" && visibility === "private";
  const editingLocked = mode === "edit" && threadStatus !== "active";

  const renderVisibilitySelector = () => (
    <>
      <Text style={styles.label}>{t("social.threads.form.visibilityTitle")}</Text>
      {(["public", "private"] as ThreadVisibility[]).map((option) => {
        const selected = visibility === option;
        return (
          <Pressable
            key={option}
            style={[styles.visibilityCard, selected ? styles.visibilityCardSelected : null]}
            onPress={() => setVisibility(option)}
          >
            <View style={styles.radioOuter}>
              {selected ? <View style={styles.radioInner} /> : null}
            </View>
            <View style={styles.visibilityTextWrap}>
              <Text style={styles.visibilityTitle}>{t(`social.threads.visibility.${option}.title`)}</Text>
              <Text style={styles.visibilityBody}>{t(`social.threads.visibility.${option}.body`)}</Text>
            </View>
          </Pressable>
        );
      })}
    </>
  );

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
        <Text style={styles.title}>{mode === "edit" ? t("social.threads.form.editTitle") : t("social.threads.form.createTitle")}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <>
          <Text style={styles.label}>{t("social.threads.form.threadTitle")}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t("social.threads.form.titlePlaceholder")}
            placeholderTextColor={TERTIARY}
            style={styles.input}
          />

          <Text style={styles.label}>{t("social.threads.form.gym")}</Text>
          <TextInput
            value={gymName}
            onChangeText={setGymName}
            placeholder={t("social.threads.form.gymPlaceholder")}
            placeholderTextColor={TERTIARY}
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>{t("social.threads.form.time")}</Text>
          <Pressable style={styles.dateButton} onPress={openDatePicker}>
            <Text style={styles.dateText}>{toLocalInputDate(scheduledAt)}</Text>
          </Pressable>
          {showPicker ? <DateTimePicker value={scheduledAt} mode="datetime" onChange={handleDateChange} /> : null}

          {renderVisibilitySelector()}

          {mode === "create" ? (
            <>
              <Text style={styles.label}>{t("social.threads.form.inviteFriends")}</Text>
              {friends.length === 0 ? <Text style={styles.emptyText}>{t("social.threads.form.noFriends")}</Text> : null}
              {friends.map((friend) => {
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
                    <Text style={styles.checkText}>{selected ? t("social.threads.form.selected") : t("social.threads.form.select")}</Text>
                  </Pressable>
                );
              })}
              {selectedFriends.length > 0 ? (
                <Text style={styles.selectedText}>
                  {t("social.threads.form.selectedCount", { count: selectedFriends.length })}
                </Text>
              ) : null}
            </>
          ) : null}

          {editingLocked ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>{t("social.threads.form.inactiveEditWarning")}</Text>
            </View>
          ) : showPrivateSwitchWarning ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>{t("social.threads.form.privateSwitchWarning")}</Text>
            </View>
          ) : null}

          <Pressable style={[styles.submitButton, saving || editingLocked ? styles.submitButtonDisabled : null]} disabled={saving || editingLocked} onPress={submit}>
            <Text style={styles.submitText}>
              {saving ? t("common.saving") : mode === "edit" ? t("social.threads.form.save") : t("social.threads.form.create")}
            </Text>
          </Pressable>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 16 },
  backButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  title: { color: TEXT, flex: 1, fontSize: 23, fontWeight: "900" },
  loader: { marginTop: 40 },
  label: { color: TEXT, fontSize: 13, fontWeight: "900", marginBottom: 7, marginTop: 12 },
  input: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    color: TEXT,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateButton: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dateText: { color: TEXT, fontSize: 15, fontWeight: "700" },
  visibilityCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
    padding: 12,
  },
  visibilityCardSelected: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  radioOuter: {
    alignItems: "center",
    borderColor: GREEN,
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  radioInner: { backgroundColor: GREEN, borderRadius: 5, height: 10, width: 10 },
  visibilityTextWrap: { flex: 1 },
  visibilityTitle: { color: TEXT, fontSize: 14, fontWeight: "900", marginBottom: 2 },
  visibilityBody: { color: MUTED, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  emptyText: { color: MUTED, fontSize: 13, fontWeight: "700", marginBottom: 10 },
  friendRow: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
    padding: 10,
  },
  friendRowSelected: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  avatarText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  friendName: { color: TEXT, flex: 1, fontSize: 14, fontWeight: "800" },
  checkText: { color: GREEN, fontSize: 12, fontWeight: "900" },
  selectedText: { color: MUTED, fontSize: 12, fontWeight: "800", marginTop: 4 },
  warningBanner: {
    backgroundColor: "#FFF7E8",
    borderColor: "#E7A321",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  warningText: { color: "#7A4A00", fontSize: 12, fontWeight: "800", lineHeight: 17 },
  submitButton: { alignItems: "center", backgroundColor: GREEN, borderRadius: 16, marginTop: 18, paddingVertical: 14 },
  submitButtonDisabled: { opacity: 0.55 },
  submitText: { color: WHITE, fontSize: 14, fontWeight: "900" },
});
