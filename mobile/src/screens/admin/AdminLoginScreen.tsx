import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { adminApi } from "../../api/adminApi";
import { useAdminStore } from "../../store/adminStore";
import { adminColors } from "./adminTheme";
import { ErrorText } from "../../components/admin/AdminShared";

export default function AdminLoginScreen() {
  const navigation = useNavigation();
  const setAuth = useAdminStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await adminApi.login(email.trim(), password);
      setAuth(res.access_token, res.role, res.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backButton}
        hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>
      <View style={styles.card}>
        <Text style={styles.title}>Admin Dashboard</Text>
        <Text style={styles.sub}>Sign in with your admin account</Text>
        {error ? <ErrorText message={error} /> : null}
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="admin@example.com"
          placeholderTextColor={adminColors.muted}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={adminColors.muted}
        />
        <Pressable style={styles.submit} onPress={() => void onSubmit()} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Sign in</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: adminColors.bg, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: adminColors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: adminColors.border,
    padding: 20,
  },
  title: { color: adminColors.text, fontSize: 22, fontWeight: "700", marginBottom: 6 },
  sub: { color: adminColors.muted, fontSize: 13, marginBottom: 16 },
  label: { color: adminColors.muted, fontSize: 12, marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: adminColors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: adminColors.text,
    fontSize: 14,
  },
  submit: {
    marginTop: 20,
    backgroundColor: adminColors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  backButton: {
    position: "absolute",
    top: 52,
    left: 20,
    zIndex: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backButtonText: {
    color: "#1d9e75",
    fontSize: 16,
    fontWeight: "600",
  },
});
