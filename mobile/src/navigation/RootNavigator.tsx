import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, Text, View } from "react-native";
import { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../store/authStore";
import { AuthScreen } from "../screens/AuthScreen";
import CoachNavigator from "../screens/Coach/CoachNavigator";
import { ProfileStackNavigator } from "./ProfileStackNavigator";
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

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const MainTabs = ({ initialRouteName = "Home" }: { initialRouteName?: "Home" | "Profile" }) => {
  const setReturnToProfileAfterOnboarding = useAuthStore((s) => s.setReturnToProfileAfterOnboarding);

  useEffect(() => {
    if (initialRouteName === "Profile") {
      setReturnToProfileAfterOnboarding(false);
    }
  }, [initialRouteName, setReturnToProfileAfterOnboarding]);

  return (
    <Tabs.Navigator
      initialRouteName={initialRouteName}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#00e5a0",
        tabBarInactiveTintColor: "rgba(255,255,255,0.3)",
        tabBarStyle: {
          borderTopColor: "rgba(255,255,255,0.07)",
          borderTopWidth: 1,
          backgroundColor: "#0a0e14",
          height: 84,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          lineHeight: 12,
          fontWeight: "600",
          marginBottom: 2,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const iconSize = size ?? 20;
          const map: Record<string, { on: any; off: any }> = {
            Home: { on: "home", off: "home-outline" },
            Workout: { on: "barbell", off: "barbell-outline" },
            Calories: { on: "flame", off: "flame-outline" },
            Coach: { on: "chatbubble-ellipses", off: "chatbubble-ellipses-outline" },
            Profile: { on: "person", off: "person-outline" },
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
      <Tabs.Screen name="Profile" component={ProfileStackNavigator} />
    </Tabs.Navigator>
  );
};

export const RootNavigator = () => {
  const { colors } = useAppTheme();
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const setToken = useAuthStore((s) => s.setToken);
  const needsOnboarding = useAuthStore((s) => s.needsOnboarding);
  const returnToProfileAfterOnboarding = useAuthStore((s) => s.returnToProfileAfterOnboarding);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.secondary} />
        <Text style={{ color: colors.muted, marginTop: 10 }}>Loading session...</Text>
      </View>
    );
  }

  const stackKey = !token ? "auth" : needsOnboarding ? "onboarding" : "main";

  return (
    <Stack.Navigator key={stackKey} screenOptions={{ headerShown: false }}>
      {token && needsOnboarding ? (
        <Stack.Screen name="Onboarding">
          {() => (
            <OnboardingProvider>
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
            {() => <MainTabs initialRouteName={returnToProfileAfterOnboarding ? "Profile" : "Home"} />}
          </Stack.Screen>
          <Stack.Screen
            name="AdminStack"
            component={AdminNavigator}
            options={{ headerShown: false, animation: "slide_from_right" }}
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
