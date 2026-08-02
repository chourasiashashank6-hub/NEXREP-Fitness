import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../theme";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { monthYearLabel } from "../../utils/localDate";

type Nav = NativeStackNavigationProp<CoachStackParamList>;

export function CoachPlannerEntryCards({ navigation }: { navigation: Nav }) {
  const { t } = useTranslation();
  const { colors, radius } = useAppTheme();
  const now = new Date();
  const label = monthYearLabel(now.getMonth() + 1, now.getFullYear());

  return (
    <>
      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}
        onPress={() => navigation.getParent()?.navigate("Calories", { view: "planner" })}
      >
        <View style={styles.badgeWrap}>
          <LinearGradient colors={["#f97316", "#ec4899"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
            <Text style={styles.badgeText}>{t("coach.components.newBadge")}</Text>
          </LinearGradient>
        </View>
        <Text style={styles.emoji}>📅</Text>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t("coach.components.monthlyMealPlanner")}</Text>
        <Text style={[styles.cardSub, { color: colors.muted }]}>{t("coach.components.mealPlannerSubtitle", { month: label })}</Text>
      </Pressable>

      <Pressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg }]}
        onPress={() => navigation.getParent()?.navigate("Workout", { view: "planner" })}
      >
        <View style={styles.badgeWrap}>
          <LinearGradient colors={["#f97316", "#ec4899"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
            <Text style={styles.badgeText}>{t("coach.components.newBadge")}</Text>
          </LinearGradient>
        </View>
        <Text style={styles.emoji}>🏋️</Text>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t("coach.components.monthlyWorkoutPlanner")}</Text>
        <Text style={[styles.cardSub, { color: colors.muted }]}>{t("coach.components.workoutPlannerSubtitle")}</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 120,
    borderWidth: 1,
    padding: 16,
    justifyContent: "center",
    overflow: "hidden",
  },
  badgeWrap: { position: "absolute", top: 10, right: 10 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  emoji: { fontSize: 24, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "600" },
  cardSub: { fontSize: 12, marginTop: 4 },
});
