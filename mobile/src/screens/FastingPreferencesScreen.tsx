import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";
import {
  deactivateFastingPreference,
  getFastingPreferences,
  saveFastingPreference,
  type FastingPeriodType,
  type FastingPreference,
} from "../api/fasting";
import { BottomSheetPicker } from "../components/BottomSheetPicker";
import { ScreenContainer } from "../components/ScreenContainer";
import { apiErrorMessage, confirmUser, notifyUser } from "../utils/notify";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";

const pad2 = (value: number) => String(value).padStart(2, "0");
const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const parseIsoDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const PERIOD_TYPES: FastingPeriodType[] = ["navratri", "ramadan", "ekadashi", "custom"];

export function FastingPreferencesScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<FastingPreference[]>([]);
  const [active, setActive] = useState<FastingPreference | null>(null);
  const [periodType, setPeriodType] = useState<FastingPeriodType>("navratri");
  const [startDate, setStartDate] = useState(() => toIsoDate(new Date()));
  const [endDate, setEndDate] = useState(() => {
    const next = new Date();
    next.setDate(next.getDate() + 8);
    return toIsoDate(next);
  });
  const [datePicker, setDatePicker] = useState<"start" | "end" | null>(null);

  const periodOptions = useMemo(
    () => PERIOD_TYPES.map((value) => ({ value, label: t(`fasting.periods.${value}`) })),
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFastingPreferences();
      setItems(data.items ?? []);
      setActive(data.active ?? null);
    } catch (error) {
      notifyUser(
        t("common.error"),
        apiErrorMessage(error, t("fasting.alerts.loadFailed"), t("fasting.alerts.unavailable")),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDatePicker = (field: "start" | "end") => {
    const value = field === "start" ? startDate : endDate;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: parseIsoDate(value),
        onChange: (event: DateTimePickerEvent, selected?: Date) => {
          if (event.type === "dismissed" || !selected) return;
          const iso = toIsoDate(selected);
          if (field === "start") {
            setStartDate(iso);
            if (parseIsoDate(iso) > parseIsoDate(endDate)) setEndDate(iso);
          } else {
            setEndDate(iso);
            if (parseIsoDate(iso) < parseIsoDate(startDate)) setStartDate(iso);
          }
        },
      });
      return;
    }
    setDatePicker(field);
  };

  const onIosDateChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (!selected || !datePicker) return;
    const iso = toIsoDate(selected);
    if (datePicker === "start") {
      setStartDate(iso);
      if (parseIsoDate(iso) > parseIsoDate(endDate)) setEndDate(iso);
    } else {
      setEndDate(iso);
      if (parseIsoDate(iso) < parseIsoDate(startDate)) setStartDate(iso);
    }
  };

  const submit = async () => {
    if (parseIsoDate(endDate) < parseIsoDate(startDate)) {
      notifyUser(t("common.error"), t("fasting.alerts.invalidRange"));
      return;
    }
    setSaving(true);
    try {
      await saveFastingPreference({
        period_type: periodType,
        start_date: startDate,
        end_date: endDate,
        active: true,
      });
      notifyUser(t("fasting.alerts.savedTitle"), t("fasting.alerts.savedBody"));
      await load();
    } catch (error) {
      notifyUser(t("common.error"), apiErrorMessage(error, t("fasting.alerts.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (pref: FastingPreference) => {
    const ok = await confirmUser(t("fasting.deactivateTitle"), t("fasting.deactivateBody"), t("fasting.deactivateConfirm"));
    if (!ok) return;
    try {
      await deactivateFastingPreference(pref.id);
      await load();
    } catch (error) {
      notifyUser(t("common.error"), apiErrorMessage(error, t("fasting.alerts.actionFailed")));
    }
  };

  const formatRange = (pref: FastingPreference) =>
    t("fasting.dateRange", { start: pref.start_date, end: pref.end_date });

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={styles.headerTextBlock}>
          <Text style={styles.title}>{t("fasting.title")}</Text>
          <Text style={styles.sub}>{t("fasting.subtitle")}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {active ? (
            <View style={styles.activeCard}>
              <Text style={styles.activeLabel}>{t("fasting.activeNow")}</Text>
              <Text style={styles.activeTitle}>{t(`fasting.periods.${active.period_type}`)}</Text>
              <Text style={styles.activeRange}>{formatRange(active)}</Text>
              <Text style={styles.activeHint}>{t("fasting.activeHint")}</Text>
            </View>
          ) : (
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>{t("fasting.noActive")}</Text>
            </View>
          )}

          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>{t("fasting.addPeriod")}</Text>
            <BottomSheetPicker
              label={t("fasting.periodType")}
              value={periodType}
              options={periodOptions}
              onChange={(value) => {
                if (typeof value === "string" && PERIOD_TYPES.includes(value as FastingPeriodType)) {
                  setPeriodType(value as FastingPeriodType);
                }
              }}
              placeholder={t("fasting.periodType")}
            />
            <Pressable style={styles.dateRow} onPress={() => openDatePicker("start")}>
              <Text style={styles.dateLabel}>{t("fasting.startDate")}</Text>
              <Text style={styles.dateValue}>{startDate}</Text>
            </Pressable>
            <Pressable style={styles.dateRow} onPress={() => openDatePicker("end")}>
              <Text style={styles.dateLabel}>{t("fasting.endDate")}</Text>
              <Text style={styles.dateValue}>{endDate}</Text>
            </Pressable>
            {datePicker && Platform.OS === "ios" ? (
              <DateTimePicker mode="date" value={parseIsoDate(datePicker === "start" ? startDate : endDate)} onChange={onIosDateChange} />
            ) : null}
            <Pressable style={[styles.saveBtn, saving && styles.saveBtnDisabled]} disabled={saving} onPress={() => void submit()}>
              {saving ? <ActivityIndicator color={WHITE} /> : <Text style={styles.saveBtnText}>{t("fasting.save")}</Text>}
            </Pressable>
            <Text style={styles.note}>{t("fasting.manualDatesNote")}</Text>
          </View>

          {items.length > 0 ? (
            <View style={styles.listCard}>
              <Text style={styles.sectionTitle}>{t("fasting.savedPeriods")}</Text>
              {items.map((pref) => (
                <View key={pref.id} style={styles.listRow}>
                  <View style={styles.listRowText}>
                    <Text style={styles.listTitle}>{t(`fasting.periods.${pref.period_type}`)}</Text>
                    <Text style={styles.listSub}>{formatRange(pref)}</Text>
                    <Text style={[styles.listStatus, pref.active ? styles.listStatusActive : styles.listStatusInactive]}>
                      {pref.active ? t("fasting.statusActive") : t("fasting.statusInactive")}
                    </Text>
                  </View>
                  {pref.active ? (
                    <Pressable onPress={() => void deactivate(pref)} style={styles.deactivateBtn}>
                      <Text style={styles.deactivateText}>{t("fasting.deactivate")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: WHITE, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER },
  backBtnText: { fontSize: 18, color: TEXT },
  headerTextBlock: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", color: TEXT },
  sub: { fontSize: 13, color: MUTED, marginTop: 2 },
  loader: { marginTop: 40 },
  body: { padding: 16, gap: 16, paddingBottom: 40 },
  activeCard: { backgroundColor: GREEN_LIGHT, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#CFE8DC" },
  activeLabel: { fontSize: 12, fontWeight: "700", color: GREEN, textTransform: "uppercase" },
  activeTitle: { fontSize: 18, fontWeight: "700", color: TEXT, marginTop: 4 },
  activeRange: { fontSize: 14, color: MUTED, marginTop: 4 },
  activeHint: { fontSize: 13, color: MUTED, marginTop: 8 },
  infoCard: { backgroundColor: WHITE, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER },
  infoText: { fontSize: 14, color: MUTED, lineHeight: 20 },
  formCard: { backgroundColor: WHITE, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: TEXT },
  dateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  dateLabel: { fontSize: 14, color: MUTED },
  dateValue: { fontSize: 15, fontWeight: "600", color: TEXT },
  saveBtn: { marginTop: 4, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: WHITE, fontWeight: "700", fontSize: 15 },
  note: { fontSize: 12, color: MUTED, lineHeight: 18 },
  listCard: { backgroundColor: WHITE, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 12 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  listRowText: { flex: 1 },
  listTitle: { fontSize: 15, fontWeight: "600", color: TEXT },
  listSub: { fontSize: 13, color: MUTED, marginTop: 2 },
  listStatus: { fontSize: 12, marginTop: 4, fontWeight: "600" },
  listStatusActive: { color: GREEN },
  listStatusInactive: { color: MUTED },
  deactivateBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: "#FFF1EE" },
  deactivateText: { color: "#D85A30", fontWeight: "600", fontSize: 12 },
});
