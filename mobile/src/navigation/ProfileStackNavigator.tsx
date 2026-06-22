import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ProfileScreen } from "../screens/ProfileScreen";
import { NotificationPreferencesScreen } from "../screens/NotificationPreferencesScreen";
import { SubscriptionScreen } from "../screens/SubscriptionScreen";
import { PaymentScreen } from "../screens/PaymentScreen";
import { PaymentSuccessScreen } from "../screens/PaymentSuccessScreen";
import { ManageSubscriptionScreen } from "../screens/ManageSubscriptionScreen";
import { PlanPickerScreen } from "../screens/PlanPickerScreen";
import type { ProfileStackParamList } from "./types";

export type { ProfileStackParamList };

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} />
      <Stack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
      <Stack.Screen name="Subscription" component={SubscriptionScreen} />
      <Stack.Screen name="ManageSubscription" component={ManageSubscriptionScreen} />
      <Stack.Screen name="PlanPicker" component={PlanPickerScreen} />
      <Stack.Screen name="Payment" component={PaymentScreen} />
      <Stack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
