import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { ONBOARDING_COLORS } from "../constants/onboarding";

type Option = { value: string | number | null; label: string; description?: string };

export const BottomSheetPicker = ({
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  value: string | number | null;
  options: Option[];
  onChange: (value: string | number | null) => void;
  placeholder: string;
  error?: string;
}) => {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((o) => o.value === value)?.label ?? placeholder, [options, value, placeholder]);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, error ? styles.triggerError : null, open ? styles.triggerActive : null]}
      >
        <Text style={[styles.triggerText, value === null || value === "" ? styles.placeholder : null]}>{selected}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.title}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(item, idx) => `${item.value}-${idx}`}
              getItemLayout={(_, index) => ({ length: 52, offset: 52 * index, index })}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    style={styles.row}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.rowText, isSelected ? styles.rowTextSelected : null]}>{item.label}</Text>
                    {isSelected ? <Text style={styles.tick}>✓</Text> : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  trigger: {
    height: 48,
    backgroundColor: ONBOARDING_COLORS.card,
    borderWidth: 1,
    borderColor: ONBOARDING_COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  triggerActive: { borderColor: ONBOARDING_COLORS.primary },
  triggerError: { borderColor: ONBOARDING_COLORS.danger },
  triggerText: { color: ONBOARDING_COLORS.textPrimary, fontSize: 15 },
  placeholder: { color: ONBOARDING_COLORS.textTertiary },
  chevron: { color: ONBOARDING_COLORS.textTertiary, fontSize: 15 },
  error: { marginTop: 4, fontSize: 12, color: ONBOARDING_COLORS.danger },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: ONBOARDING_COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#444444",
    marginTop: 8,
    marginBottom: 14,
  },
  title: { color: ONBOARDING_COLORS.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  row: {
    height: 52,
    borderBottomWidth: 1,
    borderBottomColor: ONBOARDING_COLORS.border,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowText: { color: ONBOARDING_COLORS.textPrimary, fontSize: 15 },
  rowTextSelected: { color: ONBOARDING_COLORS.primary },
  tick: { color: ONBOARDING_COLORS.primary, fontSize: 16, fontWeight: "700" },
});
