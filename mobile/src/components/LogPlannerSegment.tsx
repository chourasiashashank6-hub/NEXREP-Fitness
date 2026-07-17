import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const WHITE = "#FFFFFF";
const MUTED = "#BBBBBB";
const BORDER = "#ECEAE5";

export type LogPlannerMode = "log" | "planner";

type Props = {
  mode: LogPlannerMode;
  onChange: (mode: LogPlannerMode) => void;
};

/** Segmented Log | Planner control — matches FriendsScreen segment styling. */
export function LogPlannerSegment({ mode, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.segment}>
      <Pressable
        style={[styles.segmentButton, mode === "log" ? styles.segmentActive : null]}
        onPress={() => onChange("log")}
      >
        <Text style={[styles.segmentText, mode === "log" ? styles.segmentTextActive : null]}>
          {t("common.viewLog")}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.segmentButton, mode === "planner" ? styles.segmentActive : null]}
        onPress={() => onChange("planner")}
      >
        <Text style={[styles.segmentText, mode === "planner" ? styles.segmentTextActive : null]}>
          {t("common.viewPlanner")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    padding: 5,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 10,
  },
  segmentActive: {
    backgroundColor: GREEN_LIGHT,
  },
  segmentText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: GREEN,
  },
});
