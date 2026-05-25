import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ProfileStackParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";

const ACCENT = "#2ECC9A";
const BG = "#0a0f0d";

type Props = NativeStackScreenProps<ProfileStackParamList, "PaymentSuccess">;

export function PaymentSuccessScreen({ route, navigation }: Props) {
  const { planName, paymentId } = route.params;
  const setPlanId = useAuthStore((s) => s.setPlanId);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Ionicons name="checkmark-circle" size={72} color={ACCENT} />
        </View>
        <Text style={styles.title}>You&apos;re on {planName}!</Text>
        <Text style={styles.sub}>Your subscription is active. Enjoy your 7-day trial — billing starts after it ends.</Text>
        <Text style={styles.ref}>Payment ID: {paymentId}</Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={() => {
            setPlanId(planName.toLowerCase());
            navigation.popToTop();
          }}
        >
          <Text style={styles.ctaText}>Start training</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  inner: { flex: 1, padding: 24, justifyContent: "center", alignItems: "center" },
  iconWrap: { marginBottom: 20 },
  title: { color: "#e8f0eb", fontSize: 26, fontWeight: "700", textAlign: "center", marginBottom: 10 },
  sub: { color: "rgba(232,240,235,0.55)", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 16 },
  ref: { color: "rgba(232,240,235,0.35)", fontSize: 11, marginBottom: 28 },
  cta: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: "100%",
    alignItems: "center",
  },
  ctaText: { color: "#0a0f0d", fontSize: 16, fontWeight: "700" },
});
