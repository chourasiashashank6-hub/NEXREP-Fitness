import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { getProfile } from "../api/user";
import { postSessionComplete } from "../api/workoutSessions";
import { useLanguageStore } from "../i18n/languageStore";
import { useAuthStore } from "../store/authStore";
import { useWorkoutSessionStore } from "../store/workoutSessionStore";
import { AuthScreen } from "../screens/AuthScreen";
import GuidedWarmupScreen from "../screens/GuidedWarmupScreen";
import ActiveWorkoutScreen from "../screens/ActiveWorkoutScreen";
import AICameraWorkoutScreen from "../screens/AICameraWorkoutScreen";
import AITrainerCalibrationScreen from "../screens/aiTrainer/AITrainerCalibrationScreen";
import WorkoutCompletionScreen from "../screens/WorkoutCompletionScreen";
import GamePlanModalScreen from "../screens/GamePlanModalScreen";
import CoachNavigator from "../screens/Coach/CoachNavigator";
import { ProfileStackNavigator } from "./ProfileStackNavigator";
import SocialNavigator from "./SocialNavigator";
import AdminNavigator from "./AdminNavigator";
import { OnboardingProvider } from "../hooks/OnboardingContext";
import Screen1Personal from "../screens/onboarding/Screen1Personal";
import Screen2Goal from "../screens/onboarding/Screen2Goal";
import Screen3Activity from "../screens/onboarding/Screen3Activity";
import Screen4Diet from "../screens/onboarding/Screen4Diet";
import Screen5BodyComp from "../screens/onboarding/Screen5BodyComp";
import Screen6Setup from "../screens/onboarding/Screen6Setup";
import ResultsScreen from "../screens/onboarding/ResultsScreen";
import { useAppTheme } from "../theme";
import { textAlignStart } from "../utils/rtl";
import { navigationRef } from "./navigationRef";
import { confirmUser } from "../utils/notify";

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function ProfileTabInitials({ initials, color }: { initials: string; color: string }) {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 1.5,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color, fontSize: 10, fontWeight: "800" }}>{initials}</Text>
    </View>
  );
}

const MainTabs = ({ initialRouteName = "Home" }: { initialRouteName?: "Home" | "Profile" }) => {
  const { t } = useTranslation();
  const setReturnToProfileAfterOnboarding = useAuthStore((s) => s.setReturnToProfileAfterOnboarding);
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const explicitLanguage = useLanguageStore((s) => s.explicitLanguage);
  const languageHydrated = useLanguageStore((s) => s.hydrated);
  const applyServerLanguage = useLanguageStore((s) => s.applyServerLanguage);
  const [profileInitials, setProfileInitials] = useState("U");

  useEffect(() => {
    if (initialRouteName === "Profile") {
      setReturnToProfileAfterOnboarding(false);
    }
  }, [initialRouteName, setReturnToProfileAfterOnboarding]);

  useEffect(() => {
    let alive = true;
    void getProfile()
      .then((profile) => {
        if (!alive) return;
        setProfileInitials(initialsFromName(String(profile?.name ?? "")));
        if (languageHydrated && !explicitLanguage && profile?.preferredLanguage) {
          void applyServerLanguage(profile.preferredLanguage);
        }
      })
      .catch(() => {
        if (alive) setProfileInitials("U");
      });
    return () => {
      alive = false;
    };
  }, [applyServerLanguage, explicitLanguage, languageHydrated, sessionUserId]);

  return (
    <Tabs.Navigator
      initialRouteName={initialRouteName}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarLabel: ({ color }) => (
          <Text
            style={[styles.tabBarLabel, { color }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {t(`tabs.${route.name.toLowerCase()}`)}
          </Text>
        ),
        tabBarActiveTintColor: "#00e5a0",
        tabBarInactiveTintColor: "rgba(255,255,255,0.3)",
        tabBarStyle: {
          borderTopColor: "rgba(255,255,255,0.07)",
          borderTopWidth: 1,
          backgroundColor: "#0a0e14",
          height: 92,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
          minWidth: 0,
        },
        tabBarIcon: ({ color, size, focused }) => {
          if (route.name === "Profile") {
            return <ProfileTabInitials initials={profileInitials} color={color} />;
          }
          const iconSize = size ?? 20;
          const map: Record<string, { on: any; off: any }> = {
            Home: { on: "home", off: "home-outline" },
            Workout: { on: "barbell", off: "barbell-outline" },
            Calories: { on: "flame", off: "flame-outline" },
            Coach: { on: "chatbubble-ellipses", off: "chatbubble-ellipses-outline" },
            Social: { on: "people", off: "people-outline" },
          };
          const iconName = map[route.name]?.[focused ? "on" : "off"] ?? "ellipse-outline";
          return <Ionicons name={iconName} size={iconSize} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Home" getComponent={() => require("../screens/HomeScreen").HomeScreen} />
      <Tabs.Screen name="Workout" getComponent={() => require("../screens/WorkoutScreen").WorkoutScreen} />
      <Tabs.Screen name="Calories" getComponent={() => require("../screens/CalorieLog").CalorieLog} />
      <Tabs.Screen name="Coach" component={CoachNavigator} />
      <Tabs.Screen name="Social" component={SocialNavigator} />
      <Tabs.Screen name="Profile" component={ProfileStackNavigator} />
    </Tabs.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBarLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "600",
    marginBottom: 2,
    maxWidth: "100%",
    paddingHorizontal: 2,
    textAlign: "center",
    writingDirection: textAlignStart === "right" ? "rtl" : "ltr",
  },
});

export const RootNavigator = () => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const token = useAuthStore((s) => s.token);
  const sessionUserId = useAuthStore((s) => s.sessionUserId);
  const hydrated = useAuthStore((s) => s.hydrated);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const setToken = useAuthStore((s) => s.setToken);
  const needsOnboarding = useAuthStore((s) => s.needsOnboarding);
  const returnToProfileAfterOnboarding = useAuthStore((s) => s.returnToProfileAfterOnboarding);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Resume / auto-abandon stale active workout sessions
  useEffect(() => {
    if (!token || needsOnboarding) return;

    const run = async () => {
      const { session, abandonSession, clearSession } = useWorkoutSessionStore.getState();
      if (!session) return;
      if (session.status !== "active" && session.status !== "resting") return;

      const ageMs = Date.now() - new Date(session.started_at).getTime();
      let weightKg = 70;
      try {
        const profile = await getProfile();
        const w = Number((profile as any)?.weight ?? (profile as any)?.weight_kg ?? 70);
        if (Number.isFinite(w) && w > 0) weightKg = w;
      } catch {
        // keep default
      }

      const payload = {
        session_id: session.session_id,
        plan_day_id: session.plan_day_id,
        started_at: session.started_at,
        ended_at: new Date().toISOString(),
        status: "abandoned" as const,
        set_logs: session.set_logs.map(
          ({
            exercise_name,
            set_number,
            reps,
            weight_kg,
            started_at,
            completed_at,
            tracking_method,
          }) => ({
            exercise_name,
            set_number,
            reps,
            weight_kg,
            started_at,
            completed_at,
            tracking_method: tracking_method ?? "manual",
          }),
        ),
        user_weight_kg: weightKg,
      };

      if (ageMs >= 3 * 60 * 60 * 1000) {
        abandonSession();
        postSessionComplete(payload).catch(() => undefined);
        clearSession();
        return;
      }

      const resume = await confirmUser("Resume workout?", "You have an active workout session. Resume?", "Resume");
      if (resume) {
        const planId = Number(session.plan_day_id);
        if (Number.isFinite(planId) && navigationRef.isReady()) {
          const screen =
            session.session_type === "ai_camera"
              ? "AICameraWorkoutSession"
              : "ActiveWorkoutSession";
          navigationRef.navigate(screen as never, { planId } as never);
        }
      } else {
        abandonSession();
        postSessionComplete(payload).catch(() => undefined);
        clearSession();
      }
    };

    void run();
  }, [token, needsOnboarding]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.secondary} />
        <Text style={{ color: colors.muted, marginTop: 10 }}>{t("app.loadingSession")}</Text>
      </View>
    );
  }

  const stackKey = !token ? "auth" : needsOnboarding ? "onboarding" : "main";

  return (
    <Stack.Navigator key={stackKey} screenOptions={{ headerShown: false }}>
      {token && needsOnboarding ? (
        <Stack.Screen name="Onboarding">
          {() => (
            <OnboardingProvider key={sessionUserId ?? token ?? "onboarding"}>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Screen1Personal" component={Screen1Personal} />
                <Stack.Screen name="Screen2Goal" component={Screen2Goal} />
                <Stack.Screen name="Screen3Activity" component={Screen3Activity} />
                <Stack.Screen name="Screen4Diet" component={Screen4Diet} />
                <Stack.Screen name="Screen5BodyComp" component={Screen5BodyComp} />
                <Stack.Screen name="Screen6Setup" component={Screen6Setup} />
                <Stack.Screen name="Results" component={ResultsScreen} />
              </Stack.Navigator>
            </OnboardingProvider>
          )}
        </Stack.Screen>
      ) : token ? (
        <>
          <Stack.Screen name="Main">
            {() => (
              <OnboardingProvider key={sessionUserId ?? token ?? "main"}>
                <MainTabs initialRouteName={returnToProfileAfterOnboarding ? "Profile" : "Home"} />
              </OnboardingProvider>
            )}
          </Stack.Screen>
          <Stack.Screen
            name="AdminStack"
            component={AdminNavigator}
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="GuidedWarmupSession"
            component={GuidedWarmupScreen}
            options={{ headerShown: false, presentation: "modal", gestureEnabled: false }}
          />
          <Stack.Screen
            name="ActiveWorkoutSession"
            component={ActiveWorkoutScreen}
            options={{ headerShown: false, presentation: "modal", gestureEnabled: false }}
          />
          <Stack.Screen
            name="AICameraWorkoutSession"
            component={AICameraWorkoutScreen}
            options={{ headerShown: false, presentation: "modal", gestureEnabled: false }}
          />
          <Stack.Screen
            name="AITrainerCalibration"
            component={AITrainerCalibrationScreen}
            options={{ headerShown: false, presentation: "modal", gestureEnabled: true }}
          />
          <Stack.Screen
            name="WorkoutCompletion"
            component={WorkoutCompletionScreen}
            options={{ headerShown: false, presentation: "modal", gestureEnabled: false }}
          />
          <Stack.Screen
            name="DailyGamePlan"
            component={GamePlanModalScreen}
            options={{
              headerShown: false,
              presentation: "transparentModal",
              animation: "fade",
              contentStyle: { backgroundColor: "transparent" },
              gestureEnabled: true,
            }}
          />
        </>
      ) : (
        <Stack.Screen name="Auth">
          {() => (
            <AuthScreen
              onAuth={async (t, mode) => {
                await setToken(t, { fromSignup: mode === "signup" });
              }}
            />
          )}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
};
