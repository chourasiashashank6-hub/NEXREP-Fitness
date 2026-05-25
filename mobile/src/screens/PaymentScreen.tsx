import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ProfileStackParamList } from "../navigation/types";
import { useAppTheme } from "../theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "Payment">;

export function PaymentScreen({ route }: Props) {
  const { planId, price, isYearly } = route.params;
  const { colors } = useAppTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={["top", "left", "right"]}>
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.text }]}>Checkout</Text>
        <Text style={[styles.body, { color: colors.muted }]}>Plan {planId.toUpperCase()}</Text>
        <Text style={[styles.price, { color: colors.text }]}>
          ₹{price}
          <Text style={[styles.period, { color: colors.muted }]}> / {isYearly ? "year" : "month"}</Text>
        </Text>
        <Text style={[styles.note, { color: colors.muted }]}>
          Wire your payment provider here (Stripe, Razorpay, etc.).
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  inner: { flex: 1, padding: 20, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 12 },
  body: { fontSize: 16, marginBottom: 8 },
  price: { fontSize: 36, fontWeight: "900", marginVertical: 16 },
  period: { fontSize: 18, fontWeight: "600" },
  note: { fontSize: 14, lineHeight: 20, marginTop: 24 },
});
