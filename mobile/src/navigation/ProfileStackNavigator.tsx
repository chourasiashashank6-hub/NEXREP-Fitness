import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ProfileScreen } from "../screens/ProfileScreen";
import { SubscriptionScreen } from "../screens/SubscriptionScreen";
import { PaymentScreen } from "../screens/PaymentScreen";
import type { ProfileStackParamList } from "./types";

export type { ProfileStackParamList };

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} />
      <Stack.Screen name="Subscription" component={SubscriptionScreen} />
      <Stack.Screen name="Payment" component={PaymentScreen} />
    </Stack.Navigator>
  );
}
