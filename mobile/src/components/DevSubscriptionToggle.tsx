import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { resolveApiBaseUrl } from "../api/client";
import { useAuthStore } from "../store/authStore";

const DEV_EMAIL = "shashank@gmail.com";
const DEV_TOGGLE_SECRET = "nexrep-dev-toggle-2026";

type Props = {
  email?: string;
};

export default function DevSubscriptionToggle({ email = "" }: Props) {
  const plan_id = useAuthStore((s) => s.plan_id) ?? "free";
  const setPlanId = useAuthStore((s) => s.setPlanId);
  const token = useAuthStore((s) => s.token);

  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (email.toLowerCase() !== DEV_EMAIL.toLowerCase()) return null;

  const toggle = async (newPlan: "free" | "pro" | "elite") => {
    setLoading(true);
    setResult(null);
    try {
      const base = resolveApiBaseUrl();
      const res = await fetch(`${base}/dev/subscription-toggle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Dev-Secret": DEV_TOGGLE_SECRET,
        },
        body: JSON.stringify({ plan_id: newPlan, billing_cycle: "monthly" }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? data);
        throw new Error(detail || `Error ${res.status}`);
      }
      setPlanId(data.plan_id);
      setResult(`✓ Switched to ${String(data.plan_id).toUpperCase()}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Request failed";
      setResult(`✗ ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={() => setExpanded((p) => !p)}
        style={styles.header}
        activeOpacity={0.8}
      >
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
        <Text style={styles.headerTitle}>Plan toggle · {plan_id.toUpperCase()}</Text>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.body}>
          <Text style={styles.currentLabel}>
            Active plan: <Text style={styles.currentValue}>{plan_id.toUpperCase()}</Text>
          </Text>

          <View style={styles.btnRow}>
            {(["free", "pro", "elite"] as const).map((plan) => (
              <TouchableOpacity
                key={plan}
                onPress={() => void toggle(plan)}
                disabled={loading || plan_id === plan}
                style={[
                  styles.planBtn,
                  plan_id === plan && styles.planBtnActive,
                  plan === "pro" && { borderColor: "#1d9e75" },
                  plan === "elite" && { borderColor: "#7f77dd" },
                ]}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.planBtnText,
                    plan === "pro" && { color: plan_id === plan ? "#fff" : "#1d9e75" },
                    plan === "elite" && { color: plan_id === plan ? "#fff" : "#7f77dd" },
                    plan === "free" && { color: plan_id === plan ? "#fff" : "#8b949e" },
                  ]}
                >
                  {plan.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#1d9e75" />
              <Text style={styles.loadingText}>Switching…</Text>
            </View>
          ) : null}

          {result && !loading ? (
            <Text style={[styles.resultText, result.startsWith("✓") ? styles.resultOk : styles.resultErr]}>
              {result}
            </Text>
          ) : null}

          <Text style={styles.warning}>⚠ Dev only — visible to shashank@gmail.com only</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ef9f27",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
  },
  devBadge: {
    backgroundColor: "#ef9f27",
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  devBadgeText: {
    color: "#1a1a2e",
    fontSize: 10,
    fontWeight: "700",
  },
  headerTitle: {
    color: "#f0c060",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  chevron: {
    color: "#f0c060",
    fontSize: 11,
  },
  body: {
    padding: 14,
    borderTopWidth: 0.5,
    borderTopColor: "rgba(239,159,39,0.3)",
  },
  currentLabel: {
    color: "#8b949e",
    fontSize: 12,
    marginBottom: 12,
  },
  currentValue: {
    color: "#ffffff",
    fontWeight: "600",
  },
  btnRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  planBtn: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#161b22",
  },
  planBtnActive: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  planBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  loadingText: {
    color: "#6e7681",
    fontSize: 12,
  },
  resultText: {
    fontSize: 12,
    marginBottom: 8,
    fontWeight: "500",
  },
  resultOk: { color: "#3fcf8e" },
  resultErr: { color: "#f07676" },
  warning: {
    color: "#6e7681",
    fontSize: 10,
    fontStyle: "italic",
    marginTop: 4,
  },
});
