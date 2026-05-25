import { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import ProGateModal from "../../components/ProGateModal";
import { canAccess } from "../../constants/featureTiers";
import type { CoachStackParamList } from "../../navigation/coachTypes";
import { useAuthStore } from "../../store/authStore";

export type { CoachStackParamList } from "../../navigation/coachTypes";

type GateConfig = {
  feature: string;
  name: string;
  description: string;
  emoji: string;
  accentColor: string;
};

export default function CoachHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoachStackParamList>>();
  const plan_id = useAuthStore((s) => s.plan_id) ?? "free";
  const [gate, setGate] = useState<GateConfig | null>(null);

  const openOrGate = useCallback(
    (navigateFn: () => void, config: GateConfig) => {
      if (canAccess(plan_id, config.feature)) {
        navigateFn();
      } else {
        setGate(config);
      }
    },
    [plan_id],
  );

  const openSubscription = () => {
    navigation.getParent()?.navigate("Profile", { screen: "Subscription" });
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero header ────────────────────────────────────── */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            Your personal{"\n"}
            <Text style={styles.heroTitleAccent}>AI coach</Text>
            {" "}is ready.
          </Text>
          <Text style={styles.heroSub}>
            Real-time guidance on nutrition, workouts, and recovery —
            all powered by your own data.
          </Text>
          <View style={styles.trustRow}>
            <View style={styles.trustPill}>
              <Text style={styles.trustPillText}>
                🏃 <Text style={styles.trustPillBold}>50K+</Text> athletes
              </Text>
            </View>
            <View style={styles.trustPill}>
              <Text style={styles.trustPillText}>
                🧠 <Text style={styles.trustPillBold}>4 AI</Text> coaches
              </Text>
            </View>
            <View style={styles.trustPill}>
              <Text style={styles.trustPillText}>🔒 Pro plan</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* ── SECTION: Nutrition ─────────────────────────────── */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>NUTRITION</Text>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>Pro feature</Text>
            </View>
          </View>

          {/* ── Card 1: AI Calorie Coach ───────────────────────── */}
          <TouchableOpacity
            style={[styles.card, styles.cardTeal]}
            onPress={() =>
              openOrGate(() => navigation.navigate("AICalorieCoach"), {
                feature: "calorie_coach",
                name: "AI Calorie Coach",
                description:
                  "Get daily AI insights based on what you actually ate. Your coach analyses your food log and tells you exactly what to adjust.",
                emoji: "🥗",
                accentColor: "#1d9e75",
              })
            }
            activeOpacity={0.85}
          >
            <View style={[styles.accentBar, { backgroundColor: "#1d9e75" }]} />
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, styles.iconTeal]}>
                <Text style={styles.iconEmoji}>🥗</Text>
              </View>
              <View style={styles.badgeRow}>
                <View style={styles.badgePro}>
                  <Text style={styles.badgeProText}>PRO</Text>
                </View>
              </View>
            </View>

            <Text style={styles.cardTitle}>AI Calorie Coach</Text>
            <Text style={styles.cardSub}>
              Get daily AI insights based on what you actually ate —
              not generic advice. Your coach analyses your food log
              and tells you exactly what to adjust.
            </Text>

            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#1d9e75" }]}>Daily</Text>
                <Text style={styles.statLabel}>Fresh insights</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#1d9e75" }]}>Auto</Text>
                <Text style={styles.statLabel}>From your log</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#1d9e75" }]}>AI</Text>
                <Text style={styles.statLabel}>Personalised</Text>
              </View>
            </View>

            <View style={styles.featureList}>
              {[
                "Macro gap analysis — protein, carbs, fats",
                "Personalised food swap suggestions",
                "Daily calorie surplus / deficit feedback",
                "Protein gap alerts with fix suggestions",
              ].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <View style={[styles.featDot, { backgroundColor: "#1d9e75" }]} />
                  <Text style={styles.featText}>{f}</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                styles.cardBtn,
                {
                  backgroundColor: canAccess(plan_id, "calorie_coach") ? "#1d9e75" : "#1c2128",
                },
              ]}
            >
              <Text
                style={[
                  styles.cardBtnText,
                  { color: canAccess(plan_id, "calorie_coach") ? "#ffffff" : "#6e7681" },
                ]}
              >
                {canAccess(plan_id, "calorie_coach")
                  ? "Open AI Calorie Coach →"
                  : "🔒  Unlock — upgrade to Pro"}
              </Text>
            </View>
          </TouchableOpacity>

          {/* ── SECTION: Training ──────────────────────────────── */}
          <View style={[styles.sectionRow, { marginTop: 20 }]}>
            <Text style={styles.sectionLabel}>TRAINING</Text>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>Pro feature</Text>
            </View>
          </View>

          {/* ── Card 2: AI Workout Coach ───────────────────────── */}
          <TouchableOpacity
            style={[styles.card, styles.cardPurple]}
            onPress={() =>
              openOrGate(() => navigation.navigate("AIWorkoutCoach"), {
                feature: "workout_coach",
                name: "AI Workout Coach",
                description:
                  "Your personal trainer in your pocket. Analyses sessions and gives recovery, intensity, and progression advice.",
                emoji: "💪",
                accentColor: "#7f77dd",
              })
            }
            activeOpacity={0.85}
          >
            <View style={[styles.accentBar, { backgroundColor: "#7f77dd" }]} />
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, styles.iconPurple]}>
                <Text style={styles.iconEmoji}>💪</Text>
              </View>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.badgePro,
                    {
                      backgroundColor: "rgba(127,119,221,0.15)",
                      borderColor: "rgba(127,119,221,0.35)",
                    },
                  ]}
                >
                  <Text style={[styles.badgeProText, { color: "#a5a0f0" }]}>PRO</Text>
                </View>
              </View>
            </View>

            <Text style={styles.cardTitle}>AI Workout Coach</Text>
            <Text style={styles.cardSub}>
              Your personal trainer in your pocket. Analyses your logged
              sessions and gives you recovery, intensity, and progression
              advice tailored to your training history.
            </Text>

            <View style={styles.featureList}>
              {[
                "Daily workout performance feedback",
                "Recovery time recommendations",
                "Progressive overload guidance",
                "Based on your actual session history",
              ].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <View style={[styles.featDot, { backgroundColor: "#7f77dd" }]} />
                  <Text style={styles.featText}>{f}</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                styles.cardBtn,
                {
                  backgroundColor: canAccess(plan_id, "workout_coach") ? "#7f77dd" : "#1c2128",
                },
              ]}
            >
              <Text
                style={[
                  styles.cardBtnText,
                  { color: canAccess(plan_id, "workout_coach") ? "#ffffff" : "#6e7681" },
                ]}
              >
                {canAccess(plan_id, "workout_coach")
                  ? "Open Workout Coach →"
                  : "🔒  Unlock — upgrade to Pro"}
              </Text>
            </View>
          </TouchableOpacity>

          {/* ── SECTION: Planners ──────────────────────────────── */}
          <View style={[styles.sectionRow, { marginTop: 20 }]}>
            <Text style={styles.sectionLabel}>PLANNERS</Text>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>Pro feature</Text>
            </View>
          </View>

          {/* ── Card 3: Monthly Meal Planner ───────────────────── */}
          <TouchableOpacity
            style={[styles.card, styles.cardBlue]}
            onPress={() =>
              openOrGate(() => navigation.navigate("MonthlyMealPlanner"), {
                feature: "meal_plan_generation",
                name: "Monthly Meal Planner",
                description:
                  "A full 31-day personalised meal plan built around your calorie targets, budget, and food preferences.",
                emoji: "📅",
                accentColor: "#378add",
              })
            }
            activeOpacity={0.85}
          >
            <View style={[styles.accentBar, { backgroundColor: "#378add" }]} />
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, styles.iconBlue]}>
                <Text style={styles.iconEmoji}>📅</Text>
              </View>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.badgePro,
                    {
                      backgroundColor: "rgba(55,138,221,0.15)",
                      borderColor: "rgba(55,138,221,0.35)",
                    },
                  ]}
                >
                  <Text style={[styles.badgeProText, { color: "#79b8f8" }]}>PRO</Text>
                </View>
                <View style={styles.badgeNew}>
                  <Text style={styles.badgeNewText}>NEW</Text>
                </View>
              </View>
            </View>

            <Text style={styles.cardTitle}>Monthly meal planner</Text>
            <Text style={styles.cardSub}>
              A full 31-day personalised meal plan built around your
              calorie targets, budget, and food preferences.
              Swap any meal instantly with AI.
            </Text>

            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#378add" }]}>31</Text>
                <Text style={styles.statLabel}>Days planned</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#378add" }]}>3×</Text>
                <Text style={styles.statLabel}>Meals/day</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#378add" }]}>5×</Text>
                <Text style={styles.statLabel}>Daily swaps</Text>
              </View>
            </View>

            <View style={styles.featureList}>
              {[
                "Budget-aware daily meal suggestions",
                "Swap any meal with one tap",
                "Regenerate any full day (3×/month)",
                "Protein gap suggestions included",
              ].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <View style={[styles.featDot, { backgroundColor: "#378add" }]} />
                  <Text style={styles.featText}>{f}</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                styles.cardBtn,
                {
                  backgroundColor: canAccess(plan_id, "meal_plan_generation") ? "#378add" : "#1c2128",
                },
              ]}
            >
              <Text
                style={[
                  styles.cardBtnText,
                  { color: canAccess(plan_id, "meal_plan_generation") ? "#ffffff" : "#6e7681" },
                ]}
              >
                {canAccess(plan_id, "meal_plan_generation")
                  ? "Open meal planner →"
                  : "🔒  Unlock — upgrade to Pro"}
              </Text>
            </View>
          </TouchableOpacity>

          {/* ── Card 4: Monthly Workout Planner ────────────────── */}
          <TouchableOpacity
            style={[styles.card, styles.cardPurple]}
            onPress={() =>
              openOrGate(() => navigation.navigate("MonthlyWorkoutPlanner"), {
                feature: "workout_plan_generation",
                name: "Monthly Workout Planner",
                description:
                  "A structured 4-week training plan built around your goal, experience level, and target muscles.",
                emoji: "🏆",
                accentColor: "#7f77dd",
              })
            }
            activeOpacity={0.85}
          >
            <View style={[styles.accentBar, { backgroundColor: "#7f77dd" }]} />
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, styles.iconPurple]}>
                <Text style={styles.iconEmoji}>🏆</Text>
              </View>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.badgePro,
                    {
                      backgroundColor: "rgba(127,119,221,0.15)",
                      borderColor: "rgba(127,119,221,0.35)",
                    },
                  ]}
                >
                  <Text style={[styles.badgeProText, { color: "#a5a0f0" }]}>PRO</Text>
                </View>
                <View style={styles.badgeNew}>
                  <Text style={styles.badgeNewText}>NEW</Text>
                </View>
              </View>
            </View>

            <Text style={styles.cardTitle}>Monthly workout planner</Text>
            <Text style={styles.cardSub}>
              A structured 4-week training plan built around your goal,
              experience level, and target muscles. Swap any exercise
              and regenerate sessions freely.
            </Text>

            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#7f77dd" }]}>4wk</Text>
                <Text style={styles.statLabel}>Full plan</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#7f77dd" }]}>5×</Text>
                <Text style={styles.statLabel}>Swaps/day</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: "#7f77dd" }]}>AI</Text>
                <Text style={styles.statLabel}>Personalised</Text>
              </View>
            </View>

            <View style={styles.featureList}>
              {[
                "Push / Pull / Legs / Full-body splits",
                "Swap any exercise with AI alternatives",
                "Rest days auto-scheduled",
                "Tracks your focus muscles monthly",
              ].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <View style={[styles.featDot, { backgroundColor: "#7f77dd" }]} />
                  <Text style={styles.featText}>{f}</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                styles.cardBtn,
                {
                  backgroundColor: canAccess(plan_id, "workout_plan_generation") ? "#7f77dd" : "#1c2128",
                },
              ]}
            >
              <Text
                style={[
                  styles.cardBtnText,
                  { color: canAccess(plan_id, "workout_plan_generation") ? "#ffffff" : "#6e7681" },
                ]}
              >
                {canAccess(plan_id, "workout_plan_generation")
                  ? "Open workout planner →"
                  : "🔒  Unlock — upgrade to Pro"}
              </Text>
            </View>
          </TouchableOpacity>

          {/* ── Upgrade banner ─────────────────────────────────── */}
          <View style={styles.upgradeBanner}>
            <Text style={styles.upgradeIcon}>🔐</Text>
            <View style={styles.upgradeInfo}>
              <Text style={styles.upgradeTitle}>Unlock all AI features</Text>
              <Text style={styles.upgradeSub}>Pro — ₹999/mo · Elite — ₹1,999/mo</Text>
            </View>
            <TouchableOpacity
              onPress={openSubscription}
              style={styles.upgradeBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.upgradeBtnText}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {gate ? (
        <ProGateModal
          visible={gate !== null}
          onClose={() => setGate(null)}
          featureName={gate.name}
          featureDescription={gate.description}
          featureEmoji={gate.emoji}
          accentColor={gate.accentColor}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  content: {
    paddingBottom: 40,
  },

  // ── Hero ──────────────────────────────────────────────────
  hero: {
    backgroundColor: "#111827",
    padding: 24,
    paddingTop: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 32,
    marginBottom: 8,
  },
  heroTitleAccent: {
    color: "#1d9e75",
  },
  heroSub: {
    color: "#8b949e",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 18,
  },
  trustRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  trustPill: {
    backgroundColor: "#161b22",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  trustPillText: {
    color: "#8b949e",
    fontSize: 11,
  },
  trustPillBold: {
    color: "#c9d1d9",
    fontWeight: "600",
  },

  // ── Body ──────────────────────────────────────────────────
  body: {
    padding: 16,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionLabel: {
    color: "#6e7681",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  sectionBadge: {
    backgroundColor: "rgba(29,158,117,0.1)",
    borderWidth: 0.5,
    borderColor: "rgba(29,158,117,0.25)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  sectionBadgeText: {
    color: "#3fcf8e",
    fontSize: 11,
    fontWeight: "500",
  },

  // ── Feature card ──────────────────────────────────────────
  card: {
    backgroundColor: "#161b22",
    borderWidth: 0.5,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    overflow: "hidden",
  },
  cardTeal: { borderColor: "rgba(29,158,117,0.3)" },
  cardBlue: { borderColor: "rgba(55,138,221,0.3)" },
  cardPurple: { borderColor: "rgba(127,119,221,0.3)" },

  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },

  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 4,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconTeal: { backgroundColor: "rgba(29,158,117,0.15)" },
  iconBlue: { backgroundColor: "rgba(55,138,221,0.15)" },
  iconPurple: { backgroundColor: "rgba(127,119,221,0.15)" },
  iconEmoji: {
    fontSize: 22,
  },

  badgeRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  badgePro: {
    backgroundColor: "rgba(29,158,117,0.15)",
    borderWidth: 0.5,
    borderColor: "rgba(29,158,117,0.35)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeProText: {
    color: "#3fcf8e",
    fontSize: 10,
    fontWeight: "700",
  },
  badgeNew: {
    backgroundColor: "#1d9e75",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeNewText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },

  cardTitle: {
    color: "#e6edf3",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  cardSub: {
    color: "#8b949e",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },

  // ── Stats ────────────────────────────────────────────────
  statRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  stat: {
    flex: 1,
    backgroundColor: "#0d1117",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  statVal: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  statLabel: {
    color: "#6e7681",
    fontSize: 10,
    textAlign: "center",
  },

  // ── Feature bullet list ───────────────────────────────────
  featureList: {
    gap: 6,
    marginBottom: 14,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  featDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    flexShrink: 0,
  },
  featText: {
    color: "#c9d1d9",
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
  },

  // ── CTA button ────────────────────────────────────────────
  cardBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cardBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },

  // ── Upgrade banner ────────────────────────────────────────
  upgradeBanner: {
    backgroundColor: "#161b22",
    borderWidth: 0.5,
    borderColor: "rgba(29,158,117,0.25)",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  upgradeIcon: {
    fontSize: 26,
  },
  upgradeInfo: {
    flex: 1,
  },
  upgradeTitle: {
    color: "#e6edf3",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 3,
  },
  upgradeSub: {
    color: "#8b949e",
    fontSize: 11,
  },
  upgradeBtn: {
    backgroundColor: "#1d9e75",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  upgradeBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
});
