import { useMemo, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { PLANS } from "../constants/plans";
import type { ProfileStackParamList } from "../navigation/types";
import { useSubscriptionStore } from "../store/subscriptionStore";
import { useAppTheme } from "../theme";
import { planTierTheme } from "../theme/planTierTheme";
import type { PlanHistoryEntry, PlanStatus, PlanTier, PaymentRecord } from "../types/subscription";
import { daysUntil, formatDate } from "../utils/dateFormat";

const TEAL = "#2ECC9A";
const AMBER = "#FFC107";
const MUTED = "rgba(226,232,228,0.45)";
const CARD_BG = "#111c17";
const CARD_BORDER = "rgba(255,255,255,0.06)";

const TIER_COLORS: Record<PlanTier, string> = {
  FREE: "#8b949e",
  PRO: "#2ECC9A",
  ELITE: "#a5a0f0",
};

const TIER_MONTHLY: Record<PlanTier, number> = {
  FREE: 0,
  PRO: 999,
  ELITE: 1999,
};

type Props = {
  userId: string;
  memberSince: string;
  onExerciseHistory: () => void;
  onCalorieHistory: () => void;
};

type TimelineItem =
  | { kind: "entry"; entry: PlanHistoryEntry; isCurrent: boolean }
  | { kind: "collapsed"; count: number; dateIso: string; tier: PlanTier };

function reasonLabel(reason: PlanHistoryEntry["reason"]): string {
  const map: Record<PlanHistoryEntry["reason"], string> = {
    initial: "Started",
    upgrade: "Upgraded",
    downgrade: "Downgraded",
    renewal: "Renewed",
    cancelled: "Cancelled",
    expired: "Expired",
  };
  return map[reason] ?? reason;
}

function entryStatusBadge(entry: PlanHistoryEntry, isCurrent: boolean): { label: string; color: string } {
  if (isCurrent && entry.reason !== "cancelled") {
    return { label: "Active", color: TEAL };
  }
  if (entry.reason === "cancelled") {
    return { label: "Cancelled", color: "rgba(226,232,228,0.4)" };
  }
  if (entry.reason === "downgrade") {
    return { label: "Downgraded", color: AMBER };
  }
  if (entry.reason === "upgrade") {
    return { label: "Upgraded", color: TEAL };
  }
  return { label: reasonLabel(entry.reason), color: MUTED };
}

function prepareTimeline(history: PlanHistoryEntry[]): TimelineItem[] {
  const ordered = [...history].reverse();
  const out: TimelineItem[] = [];
  let i = 0;
  while (i < ordered.length) {
    const entry = ordered[i];
    if (entry.reason === "cancelled") {
      const day = entry.startDate.slice(0, 10);
      let j = i + 1;
      while (
        j < ordered.length &&
        ordered[j].reason === "cancelled" &&
        ordered[j].startDate.slice(0, 10) === day
      ) {
        j += 1;
      }
      const count = j - i;
      if (count > 1) {
        out.push({ kind: "collapsed", count, dateIso: day, tier: entry.tier });
        i = j;
        continue;
      }
    }
    out.push({ kind: "entry", entry, isCurrent: !entry.endDate });
    i += 1;
  }
  return out;
}

function tierFromDescription(desc: string): PlanTier {
  if (desc.toUpperCase().includes("ELITE")) return "ELITE";
  if (desc.toUpperCase().includes("PRO")) return "PRO";
  return "FREE";
}

function PlanIcon({ tier, size = 36 }: { tier: PlanTier; size?: number }) {
  const letter = tier === "FREE" ? "F" : tier === "PRO" ? "P" : "E";
  return (
    <View style={[styles.planIcon, { width: size, height: size, borderRadius: size / 2, backgroundColor: `${TIER_COLORS[tier]}22` }]}>
      <Text style={[styles.planIconLetter, { color: TIER_COLORS[tier] }]}>{letter}</Text>
    </View>
  );
}

export default function SubscriptionBillingSection({
  userId,
  memberSince,
  onExerciseHistory,
  onCalorieHistory,
}: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { colors: themeColors } = useAppTheme();
  const subscription = useSubscriptionStore((s) => s.subscription);
  const payments = useSubscriptionStore((s) => s.payments);
  const planHistory = useSubscriptionStore((s) => s.planHistory);
  const [paymentsModalVisible, setPaymentsModalVisible] = useState(false);
  const [timelineModalVisible, setTimelineModalVisible] = useState(false);
  const [timelineModalDate, setTimelineModalDate] = useState<string | null>(null);

  const tier: PlanTier = subscription?.tier ?? "FREE";
  const status: PlanStatus = subscription?.status ?? "active";
  const isFree = tier === "FREE";
  const tierTheme = useMemo(() => planTierTheme(tier, themeColors), [tier, themeColors]);

  const savingsLabel = useMemo(() => {
    if (tier === "ELITE") return "Max tier";
    if (tier === "PRO") {
      const pro = PLANS.find((p) => p.id === "pro");
      if (pro) {
        const save = pro.monthlyPrice - pro.yearlyPrice;
        return `₹${save}/mo yearly`;
      }
      return "Go yearly";
    }
    const pro = PLANS.find((p) => p.id === "pro");
    return pro ? `From ₹${pro.discountedMonthly}/mo` : "50% off";
  }, [tier]);

  const timelineItems = useMemo(() => (planHistory.length > 1 ? prepareTimeline(planHistory) : []), [planHistory]);
  const hasTimeline = timelineItems.length > 0;

  const timelineModalEntries = useMemo(() => {
    if (!timelineModalDate) return [];
    return planHistory
      .filter((e) => e.reason === "cancelled" && e.startDate.slice(0, 10) === timelineModalDate)
      .reverse();
  }, [planHistory, timelineModalDate]);

  const nextBilling =
    subscription && !isFree
      ? formatDate(subscription.currentPeriodEnd)
      : null;

  const goPricing = () => navigation.navigate("Subscription");
  const goManage = () => navigation.navigate("ManageSubscription", { userId });

  const primaryCta =
    tier === "ELITE" ? null : tier === "PRO" ? "Upgrade to Elite" : "Upgrade to PRO";

  const statusColor =
    status === "active"
      ? tierTheme.statusActive
      : status === "trial"
        ? AMBER
        : status === "cancelled"
          ? MUTED
          : "#e24b4a";

  return (
    <View style={styles.wrap}>
      {/* 1. Plan hero */}
      <View style={[styles.hero, { backgroundColor: tierTheme.heroBg, borderColor: tierTheme.heroBorder }]}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroPlanName}>{isFree ? "FREE" : tier} Plan</Text>
            {!isFree ? (
              <View style={[styles.statusPill, { borderColor: statusColor, backgroundColor: tierTheme.accentSoft }]}>
                <Text style={[styles.statusPillText, { color: statusColor }]}>
                  {status === "active" ? "Active" : status === "trial" ? "Trial" : status === "cancelled" ? "Cancelled" : "Past due"}
                </Text>
              </View>
            ) : null}
          </View>
          {nextBilling ? (
            <View style={styles.heroBillingRight}>
              <Text style={styles.heroBillingLabel}>Next billing</Text>
              <Text style={[styles.heroBillingDate, { color: tierTheme.accent }]}>{nextBilling}</Text>
            </View>
          ) : null}
        </View>

        {!isFree && subscription ? (
          <Text style={styles.heroSub}>
            ₹{subscription.priceINR.toLocaleString("en-IN")}/{subscription.billingCycle === "monthly" ? "mo" : "yr"}
            {status === "active" ? ` · in ${daysUntil(subscription.currentPeriodEnd)} days` : ""}
          </Text>
        ) : (
          <Text style={styles.heroSub}>Basic features · No billing</Text>
        )}

        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatVal}>{memberSince || "—"}</Text>
            <Text style={styles.heroStatLabel}>Member since</Text>
          </View>
        </View>

        <View style={styles.heroActions}>
          {primaryCta ? (
            <Pressable
              style={[
                styles.btnPrimary,
                {
                  backgroundColor: tierTheme.btnPrimaryBg,
                  borderColor: tierTheme.btnPrimaryBorder,
                  borderWidth: tier === "FREE" ? 1 : 0,
                },
              ]}
              onPress={goPricing}
            >
              <Text style={[styles.btnPrimaryText, { color: tierTheme.btnPrimaryText }]}>{primaryCta}</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[
              styles.btnGhost,
              !primaryCta && styles.btnGhostFull,
              { borderColor: tierTheme.btnGhostBorder },
            ]}
            onPress={isFree ? goPricing : goManage}
          >
            <Text style={[styles.btnGhostText, { color: tierTheme.btnGhostText }]}>
              {isFree ? "View plans" : "Manage plan"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 2. Savings stat */}
      <View style={styles.statGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statCardVal} numberOfLines={1}>
            {savingsLabel}
          </Text>
          <Text style={styles.statCardLabel}>Savings vs next tier</Text>
        </View>
      </View>

      {/* 3. Billing history entry */}
      {payments.length > 0 ? (
        <View style={styles.section}>
          <Pressable style={styles.modalEntry} onPress={() => setPaymentsModalVisible(true)}>
            <Text style={styles.sectionLabel}>Billing history</Text>
            <Text style={[styles.sectionLink, { color: tierTheme.accent }]}>
              {`See all ${payments.length} payment${payments.length === 1 ? "" : "s"}`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* 4. Plan timeline entry */}
      {hasTimeline ? (
        <View style={styles.section}>
          <Pressable style={styles.modalEntry} onPress={() => setTimelineModalVisible(true)}>
            <Text style={styles.sectionLabel}>Plan timeline</Text>
            <Text style={[styles.sectionLink, { color: tierTheme.accent }]}>View timeline</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 5. Bottom history row */}
      <View style={styles.bottomRow}>
        <Pressable style={styles.bottomBtn} onPress={onExerciseHistory}>
          <Ionicons name="barbell-outline" size={20} color={TEAL} />
          <Text style={styles.bottomBtnText}>Exercise history</Text>
        </Pressable>
        <Pressable style={styles.bottomBtn} onPress={onCalorieHistory}>
          <Ionicons name="flame-outline" size={20} color="#E24B4A" />
          <Text style={styles.bottomBtnText}>Calorie history</Text>
        </Pressable>
      </View>

      <BillingSheetModal
        visible={paymentsModalVisible}
        title="All payments"
        subtitle={`${payments.length} payment${payments.length === 1 ? "" : "s"}`}
        onClose={() => setPaymentsModalVisible(false)}
      >
        {payments.map((p, i) => (
          <PaymentRow key={p.id} payment={p} isLast={i === payments.length - 1} />
        ))}
      </BillingSheetModal>

      <BillingSheetModal
        visible={timelineModalVisible}
        title="Plan timeline"
        subtitle={`${planHistory.length} plan event${planHistory.length === 1 ? "" : "s"}`}
        onClose={() => {
          setTimelineModalVisible(false);
          setTimelineModalDate(null);
        }}
      >
        {timelineItems.map((item, idx) => {
          if (item.kind === "collapsed") {
            return (
              <View
                key={`collapsed-${item.dateIso}`}
                style={[styles.timelineRow, idx < timelineItems.length - 1 && styles.rowBorder]}
              >
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, { backgroundColor: MUTED }]} />
                  {idx < timelineItems.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>
                <View style={styles.timelineBody}>
                  <View style={styles.expandTitleRow}>
                    <Text style={styles.timelineTitle}>{item.count} more cancelled same-day entries —</Text>
                    <Pressable onPress={() => setTimelineModalDate(item.dateIso)} hitSlop={8}>
                      <Text style={styles.expandLink}>Expand</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.timelineMeta}>{formatDate(item.dateIso)}</Text>
                </View>
                <View style={[styles.entryBadge, { borderColor: MUTED }]}>
                  <Text style={[styles.entryBadgeText, { color: MUTED }]}>Cancelled</Text>
                </View>
              </View>
            );
          }
          return (
            <TimelineEntryRow
              key={`${item.entry.tier}-${item.entry.startDate}`}
              entry={item.entry}
              isCurrent={item.isCurrent}
              showLine={idx < timelineItems.length - 1}
            />
          );
        })}
      </BillingSheetModal>

      <BillingSheetModal
        visible={timelineModalDate !== null}
        title="Cancelled entries"
        subtitle={timelineModalDate ? formatDate(timelineModalDate) : undefined}
        onClose={() => setTimelineModalDate(null)}
      >
        {timelineModalEntries.map((entry, i) => (
          <TimelineEntryRow
            key={`${entry.startDate}-${i}`}
            entry={entry}
            isCurrent={false}
            showLine={i < timelineModalEntries.length - 1}
            compact
          />
        ))}
      </BillingSheetModal>
    </View>
  );
}

function BillingSheetModal({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>{title}</Text>
              {subtitle ? <Text style={styles.modalSubtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable style={styles.modalCloseBtn} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#e2e8e4" />
            </Pressable>
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator
          >
            <View style={styles.modalListCard}>{children}</View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PaymentRow({ payment, isLast }: { payment: PaymentRecord; isLast: boolean }) {
  const tier = tierFromDescription(payment.description);
  const statusColor = payment.status === "paid" ? TEAL : payment.status === "failed" ? "#e24b4a" : AMBER;
  const statusLabel =
    payment.status === "paid" ? "Paid" : payment.status === "failed" ? "Failed" : payment.status;

  return (
    <View style={[styles.payRow, !isLast && styles.rowBorder]}>
      <PlanIcon tier={tier} size={32} />
      <View style={styles.payMid}>
        <Text style={styles.payTitle}>{payment.description}</Text>
        <Text style={styles.payDate}>{formatDate(payment.date)}</Text>
      </View>
      <View style={styles.payRight}>
        <Text style={styles.payAmount}>₹{payment.amount.toLocaleString("en-IN")}</Text>
        <View style={[styles.paidBadge, { backgroundColor: `${statusColor}18` }]}>
          <Text style={[styles.paidBadgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {payment.invoiceUrl ? (
          <Pressable onPress={() => void Linking.openURL(payment.invoiceUrl!)} hitSlop={8}>
            <Text style={styles.receiptLink}>Receipt</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TimelineEntryRow({
  entry,
  isCurrent,
  showLine,
  indent,
  compact,
}: {
  entry: PlanHistoryEntry;
  isCurrent: boolean;
  showLine: boolean;
  indent?: boolean;
  compact?: boolean;
}) {
  const badge = entryStatusBadge(entry, isCurrent);
  const price = TIER_MONTHLY[entry.tier];

  return (
    <View style={[styles.timelineRow, indent && styles.timelineIndent, compact && styles.timelineRowCompact]}>
      <View style={styles.timelineRail}>
        <View
          style={[
            styles.timelineDot,
            isCurrent && { backgroundColor: TEAL, borderColor: TEAL },
          ]}
        />
        {showLine ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <Text style={styles.timelineTitle}>
          {entry.tier} Plan{isCurrent ? " (current)" : ""}
        </Text>
        <Text style={styles.timelineMeta}>
          {reasonLabel(entry.reason)} · {formatDate(entry.startDate)}
        </Text>
      </View>
      <View style={styles.timelineRight}>
        <View style={[styles.entryBadge, { borderColor: badge.color }]}>
          <Text style={[styles.entryBadgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
        {price > 0 ? (
          <Text style={styles.timelinePrice}>₹{price.toLocaleString("en-IN")}</Text>
        ) : (
          <Text style={styles.timelinePrice}>Free</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroTitleBlock: { flex: 1, gap: 8 },
  heroPlanName: { fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: 0.3 },
  statusPill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusPillText: { fontSize: 11, fontWeight: "700" },
  heroBillingRight: { alignItems: "flex-end" },
  heroBillingLabel: { fontSize: 10, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  heroBillingDate: { fontSize: 12, color: "#e2e8e4", fontWeight: "600", marginTop: 2 },
  heroSub: { fontSize: 12, color: MUTED, marginTop: 10, marginBottom: 14 },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 14,
  },
  heroStat: { flex: 1, alignItems: "center" },
  heroStatVal: { fontSize: 14, fontWeight: "700", color: "#fff" },
  heroStatLabel: { fontSize: 10, color: MUTED, marginTop: 4, textAlign: "center" },
  heroActions: { flexDirection: "row", gap: 8 },
  btnPrimary: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnPrimaryText: { fontSize: 13, fontWeight: "700" },
  btnGhost: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnGhostFull: { flex: 1 },
  btnGhostText: { fontSize: 13, fontWeight: "600" },
  statGrid: { marginBottom: 12 },
  modalEntry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  statCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  statCardVal: { fontSize: 13, fontWeight: "700", color: "#fff", textAlign: "center" },
  statCardLabel: { fontSize: 9, color: MUTED, marginTop: 4, textAlign: "center" },
  section: { marginBottom: 12 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "rgba(226,232,228,0.35)",
    fontWeight: "600",
  },
  sectionLink: { fontSize: 12, color: TEAL, fontWeight: "600" },
  expandTitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  expandLink: { fontSize: 13, fontWeight: "700", color: TEAL },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#0d1612",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    maxHeight: "82%",
    paddingBottom: 24,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginTop: 10,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  modalHeaderText: { flex: 1, paddingRight: 12 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#fff" },
  modalSubtitle: { fontSize: 12, color: MUTED, marginTop: 4 },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  modalScroll: { maxHeight: 480 },
  modalScrollContent: { padding: 16, paddingTop: 12 },
  modalListCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    overflow: "hidden",
  },
  listCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    overflow: "hidden",
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  planIcon: { alignItems: "center", justifyContent: "center", marginRight: 10 },
  planIconLetter: { fontSize: 14, fontWeight: "800" },
  payRow: { flexDirection: "row", alignItems: "center", padding: 12 },
  payMid: { flex: 1 },
  payTitle: { fontSize: 13, color: "#e2e8e4", fontWeight: "600" },
  payDate: { fontSize: 11, color: MUTED, marginTop: 2 },
  payRight: { alignItems: "flex-end", gap: 4 },
  payAmount: { fontSize: 14, fontWeight: "700", color: "#fff" },
  paidBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  paidBadgeText: { fontSize: 10, fontWeight: "700" },
  receiptLink: { fontSize: 10, color: TEAL },
  timelineRow: { flexDirection: "row", padding: 12, alignItems: "flex-start" },
  timelineRowCompact: { paddingVertical: 10 },
  timelineIndent: { paddingLeft: 24, backgroundColor: "rgba(0,0,0,0.15)" },
  timelineRail: { width: 20, alignItems: "center", marginRight: 10 },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(226,232,228,0.25)",
    borderWidth: 1,
    borderColor: "rgba(226,232,228,0.35)",
  },
  timelineLine: {
    width: 1,
    flex: 1,
    minHeight: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 4,
  },
  timelineBody: { flex: 1, paddingRight: 8 },
  timelineTitle: { fontSize: 13, fontWeight: "600", color: "#e2e8e4" },
  timelineMeta: { fontSize: 11, color: MUTED, marginTop: 2 },
  timelineRight: { alignItems: "flex-end", gap: 4 },
  entryBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  entryBadgeText: { fontSize: 9, fontWeight: "700" },
  timelinePrice: { fontSize: 12, fontWeight: "600", color: "#fff" },
  bottomRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  bottomBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    paddingVertical: 14,
  },
  bottomBtnText: { fontSize: 12, fontWeight: "600", color: "#e2e8e4" },
});
