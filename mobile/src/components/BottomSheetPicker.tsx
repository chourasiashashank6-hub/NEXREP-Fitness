import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BLUE = "#4A90D9";
const BLUE_LIGHT = "#EEF4FB";
const PURPLE = "#7B68CC";
const PURPLE_LIGHT = "#F0EEF9";
const GOLD = "#FFD700";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";
const SCREEN_BG = "#FFFFFF";

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
    backgroundColor: BG,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  triggerActive: { borderColor: GREEN },
  triggerOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  triggerError: { borderColor: ORANGE },
  triggerText: { color: TEXT, fontSize: 15, fontWeight: "700" },
  placeholder: { color: MUTED, fontWeight: "500" },
  chevron: { color: MUTED, fontSize: 15 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  error: { marginTop: 4, fontSize: 12, color: ORANGE },
  panel: {
    backgroundColor: WHITE,
    borderWidth: 1.5,
    borderColor: GREEN,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  title: { color: TEXT, fontSize: 16, fontWeight: "800", marginBottom: 6, marginTop: 10 },
  optionsList: { maxHeight: 260 },
  row: {
    height: 52,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowText: { color: TEXT, fontSize: 15, fontWeight: "600" },
  rowTextSelected: { color: GREEN, fontWeight: "800" },
  tick: { color: GREEN, fontSize: 16, fontWeight: "800" },
});
