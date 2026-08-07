import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { GlobalExercise } from "../constants/GlobalExercisesData";
import { useGlobalExercises } from "../hooks/useGlobalExercises";
import i18n from "../i18n";
import { logicalRow } from "../utils/rtl";

const TEAL = "#22d3ee";
const SELECT_CHOICE = i18n.t("workoutLog.selectChoice");

type ExerciseSearchInputProps = {
  value: string;
  onSelectCatalogExercise: (exerciseName: string, catalogId?: number) => void;
  onSelectGlobalExercise: (exercise: GlobalExercise) => void;
  catalogExerciseNames: string[];
  resolveCatalogId?: (name: string) => number | undefined;
  placeholder?: string;
  disabled?: boolean;
  chipMode?: boolean;
  chipSelected?: boolean;
  colors: {
    text: string;
    muted: string;
    border: string;
    cardAlt: string;
    primary: string;
    inputBg: string;
    tabBg?: string;
  };
  radius: { md: number; lg: number };
};

type CatalogRow = { kind: "catalog"; name: string };
type GlobalRow = { kind: "global"; exercise: GlobalExercise; inCatalog: boolean };
type ListRow = CatalogRow | GlobalRow;

type SectionedRow =
  | { kind: "header"; title: string }
  | { kind: "row"; item: ListRow };

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

function resolveCatalogName(name: string, catalogExerciseNames: string[]): string | null {
  const target = normalise(name);
  return catalogExerciseNames.find((item) => normalise(item) === target) ?? null;
}

function isInCatalog(exercise: GlobalExercise, catalogExerciseNames: string[]): boolean {
  if (exercise.catalog_id != null) return true;
  return resolveCatalogName(exercise.name, catalogExerciseNames) != null;
}

export default function ExerciseSearchInput({
  value,
  onSelectCatalogExercise,
  onSelectGlobalExercise,
  catalogExerciseNames,
  resolveCatalogId,
  placeholder = "Search or select exercise",
  disabled = false,
  chipMode = false,
  chipSelected = false,
  colors,
  radius,
}: ExerciseSearchInputProps) {
  const { t } = useTranslation();
  const { results, search, clear } = useGlobalExercises();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputText, setInputText] = useState(value === SELECT_CHOICE ? "" : value);
  const inputRef = useRef<TextInput>(null);
  const selectingRef = useRef(false);

  const displayValue = value === SELECT_CHOICE ? "" : value;
  const hasSelection = displayValue.length > 0;
  const trimmed = inputText.trim();
  const showSearch = trimmed.length >= 2;

  useEffect(() => {
    if (!isDropdownOpen) {
      setInputText(displayValue);
    }
  }, [displayValue, isDropdownOpen]);

  const sectionedRows: SectionedRow[] = useMemo(() => {
    if (!isDropdownOpen) return [];
    if (!showSearch) {
      return catalogExerciseNames.map((name) => ({ kind: "row", item: { kind: "catalog", name } }));
    }

    const fromCatalog: GlobalRow[] = [];
    const allExercises: GlobalRow[] = [];
    for (const exercise of results) {
      const row: GlobalRow = {
        kind: "global",
        exercise,
        inCatalog: isInCatalog(exercise, catalogExerciseNames),
      };
      if (row.inCatalog) fromCatalog.push(row);
      else allExercises.push(row);
    }

    const rows: SectionedRow[] = [];
    if (fromCatalog.length > 0) {
      rows.push({ kind: "header", title: "From your catalog" });
      fromCatalog.forEach((item) => rows.push({ kind: "row", item }));
    }
    if (allExercises.length > 0) {
      rows.push({ kind: "header", title: "All exercises" });
      allExercises.forEach((item) => rows.push({ kind: "row", item }));
    }
    return rows;
  }, [catalogExerciseNames, isDropdownOpen, results, showSearch]);

  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
    setInputFocused(false);
    Keyboard.dismiss();
    inputRef.current?.blur();
  }, []);

  const handleSelectResult = useCallback(
    (nextText: string, onPick: () => void) => {
      selectingRef.current = true;
      setInputText(nextText);
      clear();
      inputRef.current?.blur();
      setIsDropdownOpen(false);
      setInputFocused(false);
      Keyboard.dismiss();
      onPick();
      setTimeout(() => {
        selectingRef.current = false;
      }, 250);
    },
    [clear],
  );

  const handleSelectCatalog = useCallback(
    (name: string) => {
      if (name === SELECT_CHOICE) {
        handleSelectResult("", () => onSelectCatalogExercise(SELECT_CHOICE));
        return;
      }
      const catalogId = resolveCatalogId?.(name);
      handleSelectResult(name, () => onSelectCatalogExercise(name, catalogId));
    },
    [handleSelectResult, onSelectCatalogExercise, resolveCatalogId],
  );

  const handleSelectGlobal = useCallback(
    (exercise: GlobalExercise) => {
      const exactCatalogName =
        catalogExerciseNames.find((n) => normalise(n) === normalise(exercise.name)) ??
        resolveCatalogName(exercise.name, catalogExerciseNames);

      if (exercise.catalog_id != null && exactCatalogName) {
        handleSelectResult(exactCatalogName, () =>
          onSelectCatalogExercise(exactCatalogName, exercise.catalog_id ?? undefined),
        );
        return;
      }

      if (exactCatalogName) {
        const catalogId = resolveCatalogId?.(exactCatalogName);
        handleSelectResult(exactCatalogName, () => onSelectCatalogExercise(exactCatalogName, catalogId));
        return;
      }

      handleSelectResult(exercise.name, () => onSelectGlobalExercise(exercise));
    },
    [catalogExerciseNames, handleSelectResult, onSelectCatalogExercise, onSelectGlobalExercise, resolveCatalogId],
  );

  const openDropdown = useCallback(() => {
    if (disabled) return;
    setIsDropdownOpen(true);
    if (hasSelection && !inputText) {
      setInputText(displayValue);
    }
    inputRef.current?.focus();
  }, [disabled, displayValue, hasSelection, inputText]);

  const onFocus = () => {
    if (disabled || selectingRef.current) return;
    setInputFocused(true);
    setIsDropdownOpen(true);
  };

  const onBlur = () => {
    if (selectingRef.current) return;
    setInputFocused(false);
  };

  const onChangeText = (text: string) => {
    setInputText(text);
    search(text);
    if (!isDropdownOpen) setIsDropdownOpen(true);
  };

  const onClear = () => {
    clear();
    setInputText("");
    onSelectCatalogExercise(SELECT_CHOICE);
    openDropdown();
  };

  const toggleDropdown = () => {
    if (isDropdownOpen) {
      closeDropdown();
      return;
    }
    openDropdown();
  };

  const renderRow = (item: SectionedRow) => {
    if (item.kind === "header") {
      return <Text style={[styles.sectionHeader, { color: colors.muted }]}>{item.title}</Text>;
    }

    const row = item.item;
    if (row.kind === "catalog") {
      return (
        <Pressable
          style={styles.resultRow}
          onPressIn={() => {
            selectingRef.current = true;
          }}
          onPress={() => handleSelectCatalog(row.name)}
        >
          <View style={styles.resultTextWrap}>
            <Text style={[styles.resultTitle, { color: colors.text }]} numberOfLines={2}>
              {row.name}
            </Text>
            <Text style={[styles.resultMeta, { color: colors.muted }]} numberOfLines={1}>
              {t("components.yourCatalog")}
            </Text>
          </View>
          {resolveCatalogName(row.name, catalogExerciseNames) ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
                {t("components.inCatalog")}
              </Text>
            </View>
          ) : null}
        </Pressable>
      );
    }

    const { exercise, inCatalog } = row;
    return (
      <Pressable
        style={styles.resultRow}
        onPressIn={() => {
          selectingRef.current = true;
        }}
        onPress={() => handleSelectGlobal(exercise)}
      >
        <View style={styles.resultTextWrap}>
          <Text style={[styles.resultTitle, { color: colors.text }]} numberOfLines={2}>
            {exercise.name}
          </Text>
          <Text style={[styles.resultMeta, { color: colors.muted }]} numberOfLines={1}>
            {exercise.body_part} · {exercise.equipment}
          </Text>
        </View>
        {inCatalog ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
              {t("components.inCatalog")}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const rowKey = (item: SectionedRow, index: number) =>
    item.kind === "header"
      ? `header-${item.title}`
      : `row-${index}-${item.item.kind === "catalog" ? item.item.name : item.item.exercise.name}`;

  const showDropdown = isDropdownOpen && !disabled && sectionedRows.length > 0;
  const fieldValue = isDropdownOpen ? inputText : displayValue;
  const isPlaceholder = !fieldValue;
  const chipIdleBg = colors.tabBg ?? colors.inputBg;
  const fieldBackground = chipMode ? (chipSelected ? colors.inputBg : chipIdleBg) : colors.inputBg;
  const fieldBorderColor = chipMode ? (chipSelected ? colors.primary : colors.border) : colors.border;
  const fieldTextColor = chipMode
    ? chipSelected
      ? colors.text
      : isPlaceholder
        ? colors.muted
        : colors.text
    : isPlaceholder
      ? colors.muted
      : colors.text;
  const chevronColor = chipMode ? (chipSelected ? colors.primary : colors.muted) : colors.muted;

  return (
    <View style={[styles.selectWrap, chipMode ? styles.selectWrapChip : null]}>
      {!chipMode ? <Text style={[styles.selectLabel, { color: colors.muted }]}>{t("components.exercise")}</Text> : null}
      <View
        style={[
          styles.inputRow,
          chipMode ? styles.inputRowChip : null,
          {
            borderColor: fieldBorderColor,
            backgroundColor: fieldBackground,
            borderRadius: chipMode ? 14 : radius.lg,
          },
          disabled ? styles.selectDisabled : null,
        ]}
      >
        <Pressable onPress={openDropdown} style={styles.inputPressable} disabled={disabled}>
          <TextInput
            ref={inputRef}
            value={fieldValue}
            onChangeText={onChangeText}
            onFocus={onFocus}
            onBlur={onBlur}
            onPressIn={() => {
              if (!disabled) setIsDropdownOpen(true);
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            editable={!disabled}
            style={[
              styles.textInput,
              chipMode ? styles.textInputChip : null,
              { color: fieldTextColor },
            ]}
            autoCorrect={false}
            autoCapitalize="words"
          />
        </Pressable>
        {isDropdownOpen && trimmed.length > 0 ? (
          <Pressable onPress={onClear} hitSlop={8} style={styles.clearBtn}>
            <Text style={[styles.clearText, { color: colors.muted }]}>×</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={toggleDropdown}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={disabled}
            style={styles.chevronBtn}
          >
            <Text style={[styles.selectChevron, { color: chevronColor }]}>{isDropdownOpen ? "▴" : "▾"}</Text>
          </Pressable>
        )}
      </View>

      {showDropdown ? (
        <View
          style={[
            styles.optionsCard,
            chipMode ? styles.optionsCardChip : null,
            { borderColor: colors.border, backgroundColor: colors.cardAlt, borderRadius: chipMode ? 14 : radius.lg },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="always"
            nestedScrollEnabled
            style={styles.list}
          >
            {sectionedRows.map((item, index) => (
              <View key={rowKey(item, index)}>{renderRow(item)}</View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {showSearch && isDropdownOpen && sectionedRows.length === 0 ? (
        <Text style={[styles.emptyHint, { color: colors.muted }]}>No exercises match “{trimmed}”.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  selectWrap: { marginBottom: 14, zIndex: 20 },
  selectWrapChip: { marginBottom: 10, zIndex: 20 },
  selectLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" },
  inputRow: {
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 4,
    flexDirection: logicalRow,
    alignItems: "center",
    minHeight: 48,
  },
  inputRowChip: {
    paddingVertical: 13,
    minHeight: undefined,
  },
  inputPressable: { flex: 1 },
  textInput: { flex: 1, fontWeight: "700", fontSize: 15, paddingVertical: 8 },
  textInputChip: { fontWeight: "600", paddingVertical: 0 },
  selectChevron: { fontSize: 12, fontWeight: "800" },
  chevronBtn: { paddingHorizontal: 4, paddingVertical: 6, marginLeft: 4 },
  clearBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  clearText: { fontSize: 22, fontWeight: "700", lineHeight: 22 },
  selectDisabled: { opacity: 0.45 },
  optionsCard: {
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden",
    maxHeight: 320,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  optionsCardChip: {
    elevation: 0,
    shadowOpacity: 0,
  },
  list: { maxHeight: 320 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  resultRow: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resultTextWrap: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 15, fontWeight: "700" },
  resultMeta: { fontSize: 12, marginTop: 1 },
  badge: {
    backgroundColor: "rgba(34, 211, 238, 0.15)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: "34%",
    flexShrink: 1,
  },
  badgeText: { color: TEAL, fontSize: 10, lineHeight: 12, fontWeight: "700", textAlign: "center" },
  emptyHint: { marginTop: 8, fontSize: 12, paddingHorizontal: 4 },
});
