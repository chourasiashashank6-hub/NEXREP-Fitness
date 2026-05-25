import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { adminApi } from "../api/adminApi";
import AdminLoginScreen from "../screens/admin/AdminLoginScreen";
import AdminDashboardScreen from "../screens/admin/AdminDashboardScreen";
import AdminUsersScreen from "../screens/admin/AdminUsersScreen";
import AdminUserDetailScreen from "../screens/admin/AdminUserDetailScreen";
import AdminAiUsageScreen from "../screens/admin/AdminAiUsageScreen";
import AdminSubscriptionsScreen from "../screens/admin/AdminSubscriptionsScreen";
import { useAdminStore } from "../store/adminStore";
import { COLORS } from "../screens/admin/adminTheme";

export type AdminStackParamList = {
  AdminLogin: undefined;
  AdminDashboard: undefined;
  AdminUsers: undefined;
  AdminUserDetail: { userId: number };
  AdminAiUsage: undefined;
  AdminSubscriptions: undefined;
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

export default function AdminNavigator() {
  const token = useAdminStore((s) => s.token);
  const [sessionReady, setSessionReady] = useState(!token);

  useEffect(() => {
    if (!token) {
      setSessionReady(true);
      return;
    }

    let cancelled = false;
    setSessionReady(false);
    void (async () => {
      try {
        await adminApi.me();
      } catch {
        useAdminStore.getState().logout();
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!sessionReady) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={COLORS.teal} size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.bg,
        },
        headerTintColor: "#ffffff",
        headerTitleStyle: {
          fontWeight: "500",
          fontSize: 18,
          color: "#ffffff",
        },
        headerShadowVisible: false,
        headerBackTitleVisible: false,
        contentStyle: {
          backgroundColor: COLORS.bg,
        },
      }}
    >
      {!token ? (
        <Stack.Screen
          name="AdminLogin"
          component={AdminLoginScreen}
          options={{ title: "Admin Login", headerShown: false, gestureEnabled: true }}
        />
      ) : (
        <>
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: "Dashboard" }} />
          <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: "Users" }} />
          <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} options={{ title: "User Detail" }} />
          <Stack.Screen name="AdminAiUsage" component={AdminAiUsageScreen} options={{ title: "AI Usage" }} />
          <Stack.Screen
            name="AdminSubscriptions"
            component={AdminSubscriptionsScreen}
            options={{ title: "Subscriptions" }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
