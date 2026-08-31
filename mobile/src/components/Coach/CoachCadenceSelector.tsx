import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { CoachCadence } from "../../hooks/useCoachRedesign";
import { BG, TEXT, BORDER } from "../../theme/colors";

const MUTED = "#BBBBBB";
type Props = {
  value: CoachCadence;
  accentColor: string;
  onChange: (cadence: CoachCadence) => void;
  onYearlyPress: () => void;
  isCadenceLocked: (cadence: CoachCadence) => boolean;
};

const CADENCES: CoachCadence[] = ["daily", "weekly", "monthly", "yearly"];

export function CoachCadenceSelector({ value, accentColor, onChange, onYearlyPress, isCadenceLocked }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      {CADENCES.map((cadence) => {
        const selected = value === cadence;
        const locked = isCadenceLocked(cadence);
        const label = t(`coach.redesign.cadence.${cadence}`);

        return (
          <Pressable
            key={cadence}
            style={[
              styles.pill,
              selected && { borderColor: accentColor, backgroundColor: `${accentColor}12` },
              locked && !selected && styles.pillLocked,
            ]}
            onPress={() => {
              if (cadence === "yearly") {
                onYearlyPress();
                return;
              }
              onChange(cadence);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: false }}
          >
            <Text style={[styles.pillText, selected && { color: accentColor, fontWeight: "900" }]}>{label}</Text>
            {locked ? <Ionicons name="lock-closed" size={10} color={MUTED} style={styles.lockIcon} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillLocked: {
    opacity: 0.85,
  },
  pillText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
  },
  lockIcon: {
    marginLeft: 5,
  },
});
