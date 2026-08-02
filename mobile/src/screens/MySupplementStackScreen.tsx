import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from "react-native-draggable-flatlist";
import {
  addSupplementStackItem,
  getMySupplementStack,
  removeSupplementStackItem,
  reorderSupplementStack,
  setSupplementStackVisibility,
  updateSupplementStackItem,
  type StackTimingType,
  type SupplementCategory,
  type SupplementStackItem,
} from "../api/supplementStacks";
import { ScreenContainer } from "../components/ScreenContainer";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BLUE = "#3478C7";
const AMBER = "#D99118";
const BG = "#F7F6F3";
const TEXT = "#1A1A18";
const MUTED = "#6F766F";
const TERTIARY = "#9BA39D";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";
const DANGER = "#B42318";

const categories: SupplementCategory[] = ["protein", "creatine", "preworkout", "bcaa", "multivitamin", "other"];
const timingTypes: StackTimingType[] = ["time_of_day", "relative_to_workout", "custom_text"];

const categoryColor: Record<SupplementCategory, string> = {
  protein: BLUE,
  creatine: GREEN,
  preworkout: AMBER,
  bcaa: "#7B68CC",
  multivitamin: "#D85A30",
  other: MUTED,
};

type Draft = {
  id?: number;
  category: SupplementCategory;
  product_name: string;
  quantity_note: string;
  timing_type: StackTimingType;
  timing_value: string;
};

const emptyDraft = (): Draft => ({
  category: "protein",
  product_name: "",
  quantity_note: "",
  timing_type: "relative_to_workout",
  timing_value: "",
});

const toDraft = (item: SupplementStackItem): Draft => ({
  id: item.id,
  category: item.category,
  product_name: item.product_name,
  quantity_note: item.quantity_note ?? "",
  timing_type: item.timing_type,
  timing_value: item.timing_value ?? "",
});

export function MySupplementStackScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<SupplementStackItem[]>([]);
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMySupplementStack();
      setItems(data.items);
      setVisible(data.visible);
    } catch {
      Alert.alert(t("common.error"), t("social.stacks.alerts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleVisibility = async () => {
    const next = !visible;
    setVisible(next);
    try {
      setVisible(await setSupplementStackVisibility(next));
    } catch {
      setVisible(!next);
      Alert.alert(t("common.error"), t("social.stacks.alerts.visibilityFailed"));
    }
  };

  const persistOrder = async (next: SupplementStackItem[]) => {
    const previous = items;
    setItems(next);
    try {
      setItems(await reorderSupplementStack(next.map((item) => item.id)));
    } catch {
      setItems(previous);
      Alert.alert(t("common.error"), t("social.stacks.alerts.reorderFailed"));
    }
  };

  const renderStackItem = ({ item, drag, isActive }: RenderItemParams<SupplementStackItem>) => (
    <ScaleDecorator>
      <Pressable
        style={[styles.itemCard, isActive ? styles.itemCardActive : null]}
        onPress={() => setDraft(toDraft(item))}
      >
        <View style={[styles.categoryDot, { backgroundColor: categoryColor[item.category] }]} />
        <View style={styles.itemText}>
          <Text style={styles.itemTitle}>{item.product_name}</Text>
          <Text style={styles.itemMeta}>
            {[item.quantity_note, item.timing_value].filter(Boolean).join(" · ") || t(`social.stacks.categories.${item.category}`)}
          </Text>
        </View>
        <Pressable style={styles.dragHandle} onLongPress={drag} delayLongPress={120}>
          <Text style={styles.dragHandleText}>|||</Text>
        </Pressable>
      </Pressable>
    </ScaleDecorator>
  );

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.product_name.trim()) {
      Alert.alert(t("common.required"), t("social.stacks.alerts.productRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category: draft.category,
        product_name: draft.product_name.trim(),
        quantity_note: draft.quantity_note.trim() || null,
        timing_type: draft.timing_type,
        timing_value: draft.timing_value.trim() || null,
      };
      const saved = draft.id ? await updateSupplementStackItem(draft.id, payload) : await addSupplementStackItem(payload);
      setItems((current) => (draft.id ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved]));
      setDraft(null);
    } catch {
      Alert.alert(t("common.error"), t("social.stacks.alerts.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!draft?.id) return;
    setSaving(true);
    try {
      await removeSupplementStackItem(draft.id);
      setItems((current) => current.filter((item) => item.id !== draft.id));
      setDraft(null);
    } catch {
      Alert.alert(t("common.error"), t("social.stacks.alerts.deleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
        <Pressable style={styles.addButton} onPress={() => setDraft(emptyDraft())}>
          <Text style={styles.addText}>{t("social.stacks.add")}</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Text style={styles.title}>{t("social.stacks.title")}</Text>
        <Text style={styles.subtitle}>{t("social.stacks.subtitle")}</Text>
        <Pressable style={[styles.visibility, visible ? styles.visibilityOn : styles.visibilityOff]} onPress={toggleVisibility}>
          <Text style={[styles.visibilityText, visible ? styles.visibilityTextOn : styles.visibilityTextOff]}>
            {visible ? t("social.stacks.visible") : t("social.stacks.hidden")}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t("social.stacks.empty")}</Text>
        </View>
      ) : (
        <DraggableFlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderStackItem}
          onDragEnd={({ data }) => void persistOrder(data)}
          scrollEnabled={false}
        />
      )}

      <Modal visible={Boolean(draft)} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView>
              <Text style={styles.sheetTitle}>{draft?.id ? t("social.stacks.editTitle") : t("social.stacks.addTitle")}</Text>
              <Text style={styles.label}>{t("social.stacks.category")}</Text>
              <View style={styles.chipRow}>
                {categories.map((category) => (
                  <Pressable
                    key={category}
                    style={[styles.chip, draft?.category === category ? styles.chipActive : null]}
                    onPress={() => setDraft((current) => (current ? { ...current, category } : current))}
                  >
                    <Text style={[styles.chipText, draft?.category === category ? styles.chipTextActive : null]}>
                      {t(`social.stacks.categories.${category}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>{t("social.stacks.productName")}</Text>
              <TextInput
                value={draft?.product_name ?? ""}
                onChangeText={(value) => setDraft((current) => (current ? { ...current, product_name: value } : current))}
                placeholder={t("social.stacks.productPlaceholder")}
                placeholderTextColor={TERTIARY}
                style={styles.input}
              />
              <Text style={styles.label}>{t("social.stacks.quantity")}</Text>
              <TextInput
                value={draft?.quantity_note ?? ""}
                onChangeText={(value) => setDraft((current) => (current ? { ...current, quantity_note: value } : current))}
                placeholder={t("social.stacks.quantityPlaceholder")}
                placeholderTextColor={TERTIARY}
                style={styles.input}
              />
              <Text style={styles.label}>{t("social.stacks.timing")}</Text>
              <View style={styles.chipRow}>
                {timingTypes.map((timing_type) => (
                  <Pressable
                    key={timing_type}
                    style={[styles.chip, draft?.timing_type === timing_type ? styles.chipActive : null]}
                    onPress={() => setDraft((current) => (current ? { ...current, timing_type } : current))}
                  >
                    <Text style={[styles.chipText, draft?.timing_type === timing_type ? styles.chipTextActive : null]}>
                      {t(`social.stacks.timingTypes.${timing_type}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={draft?.timing_value ?? ""}
                onChangeText={(value) => setDraft((current) => (current ? { ...current, timing_value: value } : current))}
                placeholder={t("social.stacks.timingPlaceholder")}
                placeholderTextColor={TERTIARY}
                style={styles.input}
              />
              <View style={styles.sheetActions}>
                {draft?.id ? (
                  <Pressable style={styles.deleteButton} disabled={saving} onPress={deleteDraft}>
                    <Text style={styles.deleteText}>{t("social.stacks.delete")}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.cancelButton} onPress={() => setDraft(null)}>
                  <Text style={styles.cancelText}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable style={[styles.saveButton, saving ? styles.disabled : null]} disabled={saving} onPress={saveDraft}>
                  <Text style={styles.saveText}>{draft?.id ? t("social.stacks.save") : t("social.stacks.add")}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  backButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  addButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  addText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  hero: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 22, borderWidth: 1, marginBottom: 12, padding: 18 },
  title: { color: TEXT, fontSize: 26, fontWeight: "900", marginBottom: 6 },
  subtitle: { color: MUTED, fontSize: 13, fontWeight: "700", lineHeight: 19, marginBottom: 14 },
  visibility: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  visibilityOn: { backgroundColor: GREEN_LIGHT },
  visibilityOff: { backgroundColor: "#F4EEE8" },
  visibilityText: { fontSize: 12, fontWeight: "900" },
  visibilityTextOn: { color: GREEN },
  visibilityTextOff: { color: DANGER },
  loader: { marginTop: 40 },
  emptyCard: { backgroundColor: WHITE, borderColor: BORDER, borderRadius: 20, borderWidth: 1, padding: 18 },
  emptyText: { color: MUTED, fontSize: 14, fontWeight: "700", lineHeight: 20, textAlign: "center" },
  itemCard: { alignItems: "center", backgroundColor: WHITE, borderColor: BORDER, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 10, padding: 12 },
  itemCardActive: { borderColor: GREEN, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8 },
  categoryDot: { borderRadius: 8, height: 16, width: 16 },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { color: TEXT, fontSize: 15, fontWeight: "900", marginBottom: 3 },
  itemMeta: { color: MUTED, fontSize: 12, fontWeight: "700" },
  dragHandle: { paddingHorizontal: 8, paddingVertical: 6 },
  dragHandleText: { color: GREEN, fontSize: 20, fontWeight: "900" },
  backdrop: { backgroundColor: "rgba(0,0,0,0.32)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "88%", padding: 18 },
  sheetTitle: { color: TEXT, fontSize: 22, fontWeight: "900", marginBottom: 14 },
  label: { color: MUTED, fontSize: 12, fontWeight: "900", marginBottom: 7, marginTop: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { backgroundColor: "#F7FBF8", borderColor: BORDER, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  chipActive: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  chipText: { color: MUTED, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: GREEN },
  input: { backgroundColor: "#F7FBF8", borderColor: BORDER, borderRadius: 14, borderWidth: 1, color: TEXT, fontSize: 14, fontWeight: "700", paddingHorizontal: 12, paddingVertical: 11 },
  sheetActions: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 18 },
  cancelButton: { backgroundColor: "#F7FBF8", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  cancelText: { color: MUTED, fontSize: 13, fontWeight: "900" },
  saveButton: { backgroundColor: GREEN, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  saveText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  deleteButton: { marginRight: "auto", paddingHorizontal: 8, paddingVertical: 11 },
  deleteText: { color: DANGER, fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.6 },
});
