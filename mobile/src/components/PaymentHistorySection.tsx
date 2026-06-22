import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "../store/subscriptionStore";
import type { PaymentRecord } from "../types/subscription";
import { formatDate } from "../utils/dateFormat";

const STATUS_COLORS: Record<PaymentRecord["status"], string> = {
  paid: "#2ECC9A",
  failed: "#e24b4a",
  refunded: "#FFC107",
  pending: "rgba(226,232,228,0.4)",
};

function PaymentRow({ payment, isLast }: { payment: PaymentRecord; isLast: boolean }) {
  const { t } = useTranslation();
  const statusColor = STATUS_COLORS[payment.status];
  const statusLabel =
    payment.status === "paid"
      ? t("subscription.paymentHistory.paid")
      : payment.status === "failed"
        ? t("subscription.paymentHistory.failed")
        : payment.status === "refunded"
          ? t("subscription.paymentHistory.refunded")
          : payment.status;

  return (
    <View style={[styles.payRow, !isLast && styles.payRowBorder]}>
      <View style={styles.payLeft}>
        <Text style={styles.payDesc}>{payment.description}</Text>
        <Text style={styles.payDate}>{formatDate(payment.date)}</Text>
      </View>
      <View style={styles.payRight}>
        <Text style={[styles.payStatus, { color: statusColor }]}>{statusLabel}</Text>
        <Text style={styles.payAmount}>₹{payment.amount.toLocaleString("en-IN")}</Text>
        {payment.invoiceUrl ? (
          <Pressable onPress={() => void Linking.openURL(payment.invoiceUrl!)}>
            <Text style={styles.receiptLink}>{t("subscription.paymentHistory.receipt")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function PaymentHistorySection() {
  const { t } = useTranslation();
  const payments = useSubscriptionStore((s) => s.payments);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? payments : payments.slice(0, 3);

  if (payments.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t("subscription.paymentHistory.billingHistory")}</Text>
      <View style={styles.paymentCard}>
        {visible.map((p, i) => (
          <PaymentRow key={p.id} payment={p} isLast={i === visible.length - 1} />
        ))}
      </View>
      {payments.length > 3 ? (
        <Pressable onPress={() => setExpanded(!expanded)}>
          <Text style={styles.seeAll}>
            {expanded ? t("subscription.paymentHistory.showLess") : t("subscription.paymentHistory.seeAll", { count: payments.length })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 12 },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "rgba(226,232,228,0.35)",
    marginBottom: 8,
    fontWeight: "500",
  },
  paymentCard: {
    backgroundColor: "#111c17",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    overflow: "hidden",
  },
  payRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 12 },
  payRowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  payLeft: { flex: 1, paddingRight: 8 },
  payDesc: { fontSize: 13, color: "rgba(226,232,228,0.8)", fontWeight: "500" },
  payDate: { fontSize: 11, color: "rgba(226,232,228,0.35)", marginTop: 2 },
  payRight: { alignItems: "flex-end", gap: 2 },
  payStatus: { fontSize: 12, fontWeight: "500" },
  payAmount: { fontSize: 13, color: "#e2e8e4", fontWeight: "600" },
  receiptLink: { fontSize: 11, color: "#2ECC9A", marginTop: 4 },
  seeAll: { textAlign: "center", color: "#2ECC9A", fontSize: 13, marginTop: 10 },
});
