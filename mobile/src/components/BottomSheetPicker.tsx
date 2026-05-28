import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const idRef = useRef(`picker-${Math.random().toString(36).slice(2)}`);
  const [, forceUpdate] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const listener = () => {
      setOpen(openPickerId === idRef.current);
      forceUpdate((v) => v + 1);
    };
    pickerListeners.add(listener);
    return () => {
      pickerListeners.delete(listener);
      if (openPickerId === idRef.current) {
        openPickerId = null;
      }
    };
  }, []);

  const selected = useMemo(() => options.find((o) => o.value === value)?.label ?? placeholder, [options, value, placeholder]);

  const setOpenPicker = (nextOpen: boolean) => {
    openPickerId = nextOpen ? idRef.current : null;
    for (const notify of pickerListeners) notify();
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpenPicker(!open)}
        style={[
          styles.trigger,
          error ? styles.triggerError : null,
          open ? styles.triggerActive : null,
          open ? styles.triggerOpen : null,
        ]}
      >
        <Text style={[styles.triggerText, value === null || value === "" ? styles.placeholder : null]}>{selected}</Text>
        <Text style={[styles.chevron, open ? styles.chevronOpen : null]}>▾</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {open ? (
        <View style={styles.panel}>
          <Text style={styles.title}>{label}</Text>
          <ScrollView nestedScrollEnabled style={styles.optionsList}>
            {options.map((item, idx) => {
              const isSelected = item.value === value;
              return (
                <Pressable
                  key={`${item.value}-${idx}`}
                  style={styles.row}
                  onPress={() => {
                    onChange(item.value);
                    setOpenPicker(false);
                  }}
                >
                  <Text style={[styles.rowText, isSelected ? styles.rowTextSelected : null]}>{item.label}</Text>
                  {isSelected ? <Text style={styles.tick}>✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

let openPickerId: string | null = null;
const pickerListeners = new Set<() => void>();

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
  triggerOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  triggerError: { borderColor: ONBOARDING_COLORS.danger },
  triggerText: { color: ONBOARDING_COLORS.textPrimary, fontSize: 15 },
  placeholder: { color: ONBOARDING_COLORS.textTertiary },
  chevron: { color: ONBOARDING_COLORS.textTertiary, fontSize: 15 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  error: { marginTop: 4, fontSize: 12, color: ONBOARDING_COLORS.danger },
  panel: {
    backgroundColor: ONBOARDING_COLORS.card,
    borderWidth: 1,
    borderColor: ONBOARDING_COLORS.primary,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  title: { color: ONBOARDING_COLORS.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 6, marginTop: 10 },
  optionsList: { maxHeight: 260 },
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
