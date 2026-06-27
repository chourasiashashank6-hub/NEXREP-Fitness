import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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

const pad2 = (value: number) => String(value).padStart(2, "0");

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  return `${pad2(hours)}:${pad2(minutes)}`;
});

const toTimeInputValue = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

const withLocalDate = (current: Date, dateValue: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return null;
  const next = new Date(current);
  next.setFullYear(year, month - 1, day);
  return next;
};

const withLocalTime = (current: Date, timeValue: string) => {
  const [hours, minutes] = timeValue.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const next = new Date(current);
  next.setHours(hours, minutes, 0, 0);
  return next;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, delta: number) => new Date(date.getFullYear(), date.getMonth() + delta, 1);
const monthTitle = (date: Date) => date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const calendarCells = (cursor: Date, minimumDate: Date) => {
  const first = monthStart(cursor);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const minDay = startOfDay(minimumDate).getTime();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      inMonth: date.getMonth() === cursor.getMonth(),
      disabled: startOfDay(date).getTime() < minDay,
    };
  });
};

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
  const [dateCalendarOpen, setDateCalendarOpen] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(() => monthStart(scheduledAt));
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);

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
      const next = new Date(scheduledAt);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      setScheduledAt(next);
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
          setScheduledAt(nextDate);
          setDateChanged(true);
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
  const minSelectableDate = useMemo(() => {
    const now = new Date();
    return mode === "edit" && scheduledAt < now ? scheduledAt : now;
  }, [mode, scheduledAt]);
  const calendarDays = useMemo(() => calendarCells(calendarCursor, minSelectableDate), [calendarCursor, minSelectableDate]);

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

          <View style={styles.dateTimeRow}>
            <View style={styles.dateTimeField}>
              <Text style={styles.label}>{t("social.threads.form.date", { defaultValue: "Date" })}</Text>
              {Platform.OS === "web" ? (
                <Pressable
                  style={styles.dateButton}
                  disabled={editingLocked}
                  onPress={() => {
                    setCalendarCursor(monthStart(scheduledAt));
                    setDateCalendarOpen((current) => !current);
                    setTimeDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dateText}>
                    {scheduledAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                  <Text style={styles.timeChevron}>⌄</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable style={styles.dateButton} onPress={openDatePicker} disabled={editingLocked}>
                    <Text style={styles.dateText}>
                      {scheduledAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </Text>
                    <Text style={styles.dateHint}>{t("social.threads.form.tapToChange", { defaultValue: "Tap to change" })}</Text>
                  </Pressable>
                  {showPicker ? (
                    <DateTimePicker
                      value={scheduledAt}
                      mode="date"
                      minimumDate={minSelectableDate}
                      onChange={handleDateChange}
                    />
                  ) : null}
                </>
              )}
            </View>
            <View style={styles.dateTimeField}>
              <Text style={styles.label}>Time</Text>
              <Pressable
                style={styles.timeSelect}
                disabled={editingLocked}
                onPress={() => {
                  setTimeDropdownOpen((current) => !current);
                  setDateCalendarOpen(false);
                }}
              >
                <Text style={styles.dateText}>{toTimeInputValue(scheduledAt)}</Text>
                <Text style={styles.timeChevron}>⌄</Text>
              </Pressable>
            </View>
          </View>
          {dateCalendarOpen ? (
            <View style={styles.calendarDropdown}>
              <View style={styles.calendarHeader}>
                <Pressable style={styles.calendarNavButton} onPress={() => setCalendarCursor((current) => addMonths(current, -1))}>
                  <Text style={styles.calendarNavText}>‹</Text>
                </Pressable>
                <Text style={styles.calendarTitle}>{monthTitle(calendarCursor)}</Text>
                <Pressable style={styles.calendarNavButton} onPress={() => setCalendarCursor((current) => addMonths(current, 1))}>
                  <Text style={styles.calendarNavText}>›</Text>
                </Pressable>
              </View>
              <View style={styles.calendarWeekRow}>
                {weekdayLabels.map((label) => (
                  <Text key={label} style={styles.calendarWeekday}>{label}</Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {calendarDays.map((cell) => {
                  const selected = toDateInputValue(cell.date) === toDateInputValue(scheduledAt);
                  return (
                    <Pressable
                      key={toDateInputValue(cell.date)}
                      style={[
                        styles.calendarDay,
                        selected ? styles.calendarDaySelected : null,
                        !cell.inMonth ? styles.calendarDayMuted : null,
                        cell.disabled ? styles.calendarDayDisabled : null,
                      ]}
                      disabled={cell.disabled}
                      onPress={() => {
                        const next = withLocalDate(scheduledAt, toDateInputValue(cell.date));
                        if (!next) return;
                        setScheduledAt(next);
                        setDateChanged(true);
                        setDateCalendarOpen(false);
                      }}
                    >
                      <Text style={[styles.calendarDayText, selected ? styles.calendarDayTextSelected : null]}>
                        {cell.date.getDate()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {timeDropdownOpen ? (
            <ScrollView style={styles.timeDropdown} contentContainerStyle={styles.timeDropdownContent} nestedScrollEnabled>
              {timeOptions.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.timeOption, option === toTimeInputValue(scheduledAt) ? styles.timeOptionSelected : null]}
                  onPress={() => {
                    const next = withLocalTime(scheduledAt, option);
                    if (!next) return;
                    setScheduledAt(next);
                    setDateChanged(true);
                    setTimeDropdownOpen(false);
                  }}
                >
                  <Text style={[styles.timeOptionText, option === toTimeInputValue(scheduledAt) ? styles.timeOptionTextSelected : null]}>
                    {option}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

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
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateText: { color: TEXT, fontSize: 15, fontWeight: "700" },
  dateHint: { color: MUTED, fontSize: 11, fontWeight: "800", marginTop: 3 },
  dateTimeRow: { flexDirection: "row", gap: 10 },
  dateTimeField: { flex: 1 },
  timeSelect: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  timeChevron: { color: GREEN, fontSize: 18, fontWeight: "900" },
  timeDropdown: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
    maxHeight: 190,
  },
  timeDropdownContent: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 8,
  },
  timeOption: {
    alignItems: "center",
    backgroundColor: BG,
    borderRadius: 999,
    minWidth: 62,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  timeOptionSelected: { backgroundColor: GREEN_LIGHT },
  timeOptionText: { color: MUTED, fontSize: 12, fontWeight: "900" },
  timeOptionTextSelected: { color: GREEN },
  calendarDropdown: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  calendarHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  calendarNavButton: {
    alignItems: "center",
    backgroundColor: GREEN_LIGHT,
    borderRadius: 12,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  calendarNavText: { color: GREEN, fontSize: 22, fontWeight: "900" },
  calendarTitle: { color: TEXT, fontSize: 14, fontWeight: "900" },
  calendarWeekRow: { flexDirection: "row", marginBottom: 6 },
  calendarWeekday: { color: MUTED, flex: 1, fontSize: 11, fontWeight: "900", textAlign: "center" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarDay: {
    alignItems: "center",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    marginVertical: 2,
    width: `${100 / 7}%`,
  },
  calendarDaySelected: { backgroundColor: GREEN },
  calendarDayMuted: { opacity: 0.35 },
  calendarDayDisabled: { opacity: 0.18 },
  calendarDayText: { color: TEXT, fontSize: 13, fontWeight: "800" },
  calendarDayTextSelected: { color: WHITE },
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
