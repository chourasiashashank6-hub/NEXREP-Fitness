import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { getProfile } from "../../api/user";
import { TIER_COLORS, TIER_ICONS } from "../../constants/tierColors";
import { useSubscriptionStore } from "../../store/subscriptionStore";
import type { PlanHistoryEntry, PlanStatus, PlanTier, PaymentRecord } from "../../types/subscription";
import { daysUntil, formatDate } from "../../utils/dateFormat";
import { logicalRow, textAlignEnd, textAlignStart } from "../../utils/rtl";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../../theme/colors";

const ORANGE = "#D85A30";
const MUTED = "#BBBBBB";
const GOLD = "#FFD700";

const TIER_MONTHLY: Record<PlanTier, number> = {
  FREE: 0,
  PRO: 999,
  ELITE: 1999,
};

type TimelineItem =
  | { kind: "entry"; entry: PlanHistoryEntry; isCurrent: boolean }
  | { kind: "collapsed"; count: number; dateIso: string; tier: PlanTier };

function monthYear(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function reasonLabel(reason: PlanHistoryEntry["reason"], t: TFunction): string {
  const map: Record<PlanHistoryEntry["reason"], string> = {
    initial: t("subscription.reasons.initial"),
    upgrade: t("subscription.reasons.upgrade"),
    downgrade: t("subscription.reasons.downgrade"),
    renewal: t("subscription.reasons.renewal"),
    cancelled: t("subscription.reasons.cancelled"),
    expired: t("subscription.reasons.expired"),
  };
  return map[reason] ?? reason;
}

function entryStatusBadge(entry: PlanHistoryEntry, isCurrent: boolean, t: TFunction): { label: string; color: string } {
  if (isCurrent && entry.reason !== "cancelled") {
    return { label: t("subscription.status.active"), color: GREEN };
  }
  if (entry.reason === "cancelled") {
    return { label: t("subscription.status.cancelled"), color: ORANGE };
  }
  if (entry.reason === "downgrade") {
    return { label: t("subscription.reasons.downgrade"), color: GOLD };
  }
  if (entry.reason === "upgrade") {
    return { label: t("subscription.reasons.upgrade"), color: GREEN };
  }
  return { label: reasonLabel(entry.reason, t), color: MUTED };
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

type PlanOverviewCardProps = {
  onManagePress?: () => void;
  manageDisabled?: boolean;
  compact?: boolean;
  /** When false, FREE tier users see no card (e.g. on plan picker). */
  showFreeTier?: boolean;
  showSectionLabel?: boolean;
};

export function PlanOverviewCard({
  onManagePress,
  manageDisabled,
  compact,
  showFreeTier = false,
  showSectionLabel = true,
}: PlanOverviewCardProps) {
  const { t } = useTranslation();
  const subscription = useSubscriptionStore((s) => s.subscription);
  const [memberSince, setMemberSince] = useState("");

  useEffect(() => {
    let alive = true;
    void getProfile()
      .then((profile) => {
        if (!alive) return;
        const createdAt = typeof profile.createdAt === "string" ? profile.createdAt : "";
        setMemberSince(createdAt ? monthYear(createdAt) : monthYear(new Date().toISOString()));
      })
      .catch(() => {
        if (alive) setMemberSince(monthYear(new Date().toISOString()));
      });
    return () => {
      alive = false;
    };
  }, []);

  const tier: PlanTier = subscription?.tier ?? "FREE";
  if (!subscription) return null;
  if (tier === "FREE" && !showFreeTier) return null;

  const tierColors = TIER_COLORS[tier];
  const status: PlanStatus = subscription.status ?? "active";
  const isFree = tier === "FREE";
  const nextBilling = !isFree ? formatDate(subscription.currentPeriodEnd) : null;

  return (
    <View style={[styles.block, compact && styles.blockCompact]}>
      {showSectionLabel ? (
        <Text style={styles.sectionEyebrow}>{t("subscription.planPicker.planOverviewSection")}</Text>
      ) : null}
      <View style={[styles.hero, { backgroundColor: tierColors.cardBg, borderColor: tierColors.cardBorder }]}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroTierIcon}>{TIER_ICONS[tier]}</Text>
            <Text style={[styles.heroPlanName, { color: tierColors.titleColor }]}>
              {t("subscription.overview.planName", { tier: isFree ? t("subscription.overview.free") : tier })}
            </Text>
            <View style={[styles.statusPill, { backgroundColor: tierColors.badgeBg }]}>
              <Text
                style={[styles.statusPillText, { color: tierColors.badgeText }]}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {status === "active"
                  ? t("subscription.status.active")
                  : status === "trial"
                    ? t("subscription.status.trial")
                    : status === "cancelled"
                      ? t("subscription.status.cancelled")
                      : t("subscription.status.pastDue")}
              </Text>
            </View>
          </View>
          {nextBilling ? (
            <View style={styles.heroBillingRight}>
              <Text style={[styles.heroBillingLabel, { color: tierColors.mutedText }]}>
                {t("subscription.overview.nextBilling")}
              </Text>
              <Text style={[styles.heroBillingDate, { color: tierColors.titleColor }]}>{nextBilling}</Text>
              <Text style={[styles.heroBillingDays, { color: tierColors.titleColor }]}>
                {t("subscription.overview.daysUntilBilling", { days: daysUntil(subscription.currentPeriodEnd) })}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.heroPriceStrip}>
          <View>
            <Text style={styles.heroStatLabel}>{t("subscription.overview.memberSince")}</Text>
            <Text style={styles.heroStatVal}>{memberSince || "—"}</Text>
          </View>
          <Text style={styles.heroPriceText}>
            {!isFree ? `₹${subscription.priceINR.toLocaleString("en-IN")}` : "₹0"}
            <Text style={styles.heroPriceUnit}>
              {!isFree && subscription.billingCycle === "yearly"
                ? t("subscription.overview.yearlyPeriod")
                : t("subscription.overview.monthlyPeriod")}
            </Text>
          </Text>
        </View>

        {tier === "ELITE" ? (
          <Text style={[styles.topTierNote, { color: tierColors.mutedText }]}>
            {t("subscription.overview.topTierNote")}
          </Text>
        ) : null}

        {onManagePress ? (
          <Pressable
            style={[styles.manageBtn, { backgroundColor: tierColors.buttonBg }, manageDisabled && styles.manageBtnDisabled]}
            onPress={onManagePress}
            disabled={manageDisabled}
          >
            <Text style={[styles.manageBtnText, { color: tierColors.buttonText }]}>
              {t("subscription.overview.manageBilling")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

type SubscriptionHistorySectionProps = {
  showSectionLabel?: boolean;
};

export function SubscriptionHistorySection({ showSectionLabel = true }: SubscriptionHistorySectionProps) {
  const { t } = useTranslation();
  const payments = useSubscriptionStore((s) => s.payments);
  const planHistory = useSubscriptionStore((s) => s.planHistory);

  const [paymentsModalVisible, setPaymentsModalVisible] = useState(false);
  const [timelineModalVisible, setTimelineModalVisible] = useState(false);
  const [timelineModalDate, setTimelineModalDate] = useState<string | null>(null);

  const timelineItems = useMemo(() => (planHistory.length > 1 ? prepareTimeline(planHistory) : []), [planHistory]);
  const hasTimeline = timelineItems.length > 0;
  const timelineModalEntries = useMemo(() => {
    if (!timelineModalDate) return [];
    return planHistory
      .filter((e) => e.reason === "cancelled" && e.startDate.slice(0, 10) === timelineModalDate)
      .reverse();
  }, [planHistory, timelineModalDate]);

  return (
    <>
      <View style={styles.block}>
        {showSectionLabel ? (
          <Text style={styles.sectionEyebrow}>{t("subscription.planPicker.historySection")}</Text>
        ) : null}
        <View style={styles.linksCard}>
          <Pressable style={styles.linkRow} onPress={() => setPaymentsModalVisible(true)}>
            <View style={styles.linkIconTile}>
              <Text style={styles.linkEmoji}>🧾</Text>
            </View>
            <Text style={styles.linkTitle}>{t("subscription.overview.billingHistory")}</Text>
            <Text style={styles.linkAction}>
              {t("subscription.overview.seeAllPayments", {
                count: payments.length,
                plural: payments.length === 1 ? "" : "s",
              })}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.linkRow, styles.linkRowLast]}
            onPress={() => setTimelineModalVisible(true)}
            disabled={!hasTimeline}
          >
            <View style={styles.linkIconTile}>
              <Text style={styles.linkEmoji}>📅</Text>
            </View>
            <Text style={styles.linkTitle}>{t("subscription.overview.planTimeline")}</Text>
            <Text style={[styles.linkAction, !hasTimeline && styles.linkActionDisabled]}>
              {hasTimeline ? t("subscription.overview.view") : t("subscription.overview.noEvents")}
            </Text>
          </Pressable>
        </View>
      </View>

      <BillingSheetModal
        visible={paymentsModalVisible}
        title={t("subscription.overview.allPayments")}
        subtitle={t("subscription.overview.paymentCount", {
          count: payments.length,
          plural: payments.length === 1 ? "" : "s",
        })}
        onClose={() => setPaymentsModalVisible(false)}
      >
        {payments.length === 0 ? (
          <View style={styles.emptyModal}>
            <Text style={styles.emptyModalText}>{t("subscription.planPicker.noPaymentsYet")}</Text>
          </View>
        ) : (
          payments.map((p, i) => <PaymentRow key={p.id} payment={p} isLast={i === payments.length - 1} />)
        )}
      </BillingSheetModal>

      <BillingSheetModal
        visible={timelineModalVisible}
        title={t("subscription.overview.planTimeline")}
        subtitle={t("subscription.overview.planEventCount", {
          count: planHistory.length,
          plural: planHistory.length === 1 ? "" : "s",
        })}
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
                    <Text style={styles.timelineTitle}>
                      {t("subscription.overview.collapsedCancelled", { count: item.count })}
                    </Text>
                    <Pressable onPress={() => setTimelineModalDate(item.dateIso)} hitSlop={8}>
                      <Text style={styles.expandLink}>{t("subscription.overview.expand")}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.timelineMeta}>{formatDate(item.dateIso)}</Text>
                </View>
                <View style={[styles.entryBadge, { borderColor: MUTED }]}>
                  <Text style={[styles.entryBadgeText, { color: MUTED }]}>{t("subscription.status.cancelled")}</Text>
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
        title={t("subscription.overview.cancelledEntries")}
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
    </>
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
              <Ionicons name="close" size={22} color={TEXT} />
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

function PlanIcon({ tier, size = 36 }: { tier: PlanTier; size?: number }) {
  const letter = tier === "FREE" ? "F" : tier === "PRO" ? "P" : "E";
  const tierColors = TIER_COLORS[tier];
  return (
    <View
      style={[
        styles.planIcon,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tierColors.cardBg },
      ]}
    >
      <Text style={[styles.planIconLetter, { color: tierColors.titleColor }]}>{letter}</Text>
    </View>
  );
}

function PaymentRow({ payment, isLast }: { payment: PaymentRecord; isLast: boolean }) {
  const { t } = useTranslation();
  const tier = tierFromDescription(payment.description);
  const statusColor = payment.status === "paid" ? GREEN : payment.status === "failed" ? ORANGE : GOLD;
  const statusLabel =
    payment.status === "paid"
      ? t("subscription.overview.paid")
      : payment.status === "failed"
        ? t("subscription.overview.failed")
        : payment.status;

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
            <Text style={styles.receiptLink}>{t("subscription.overview.receipt")}</Text>
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
  compact,
}: {
  entry: PlanHistoryEntry;
  isCurrent: boolean;
  showLine: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const badge = entryStatusBadge(entry, isCurrent, t);
  const price = TIER_MONTHLY[entry.tier];

  return (
    <View style={[styles.timelineRow, compact && styles.timelineRowCompact]}>
      <View style={styles.timelineRail}>
        <View
          style={[styles.timelineDot, isCurrent && { backgroundColor: GREEN, borderColor: GREEN }]}
        />
        {showLine ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <Text style={styles.timelineTitle}>
          {t("subscription.overview.planName", { tier: entry.tier })}
          {isCurrent ? t("subscription.overview.currentSuffix") : ""}
        </Text>
        <Text style={styles.timelineMeta}>
          {reasonLabel(entry.reason, t)} · {formatDate(entry.startDate)}
        </Text>
      </View>
      <View style={styles.timelineRight}>
        <View style={[styles.entryBadge, { borderColor: badge.color }]}>
          <Text
            style={[styles.entryBadgeText, { color: badge.color }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {badge.label}
          </Text>
        </View>
        {price > 0 ? (
          <Text style={styles.timelinePrice}>₹{price.toLocaleString("en-IN")}</Text>
        ) : (
          <Text style={styles.timelinePrice}>{t("subscription.overview.freePrice")}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 14 },
  blockCompact: { marginBottom: 12 },
  sectionEyebrow: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginBottom: 8,
    textAlign: textAlignStart,
  },
  hero: { borderRadius: 16, padding: 14, borderWidth: 1.5 },
  heroTop: { flexDirection: logicalRow, justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  heroTitleBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: logicalRow,
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  heroTierIcon: { fontSize: 16 },
  heroPlanName: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: textAlignStart,
  },
  statusPill: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, maxWidth: "100%" },
  statusPillText: { fontSize: 9, lineHeight: 11, fontWeight: "900", textAlign: "center" },
  heroBillingRight: { alignItems: textAlignEnd === "right" ? "flex-end" : "flex-start", flexShrink: 1 },
  heroBillingLabel: { fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, textAlign: textAlignEnd },
  heroBillingDate: { fontSize: 11, fontWeight: "900", marginTop: 2 },
  heroBillingDays: { fontSize: 11, fontWeight: "900", marginTop: 2 },
  heroPriceStrip: {
    flexDirection: logicalRow,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: WHITE,
    marginTop: 16,
  },
  heroStatVal: { fontSize: 12, fontWeight: "900", color: TEXT, marginTop: 3 },
  heroStatLabel: { fontSize: 9, color: MUTED, fontWeight: "800" },
  heroPriceText: { color: TEXT, fontSize: 13, fontWeight: "900" },
  heroPriceUnit: { color: MUTED, fontSize: 11, fontWeight: "700" },
  topTierNote: { textAlign: "center", fontSize: 11, marginTop: 10, fontWeight: "800" },
  manageBtn: { marginTop: 12, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  manageBtnDisabled: { opacity: 0.5 },
  manageBtnText: { fontSize: 11, fontWeight: "900" },
  linksCard: { backgroundColor: BG, borderRadius: 16, padding: 8, borderWidth: 1, borderColor: BORDER },
  linkRow: {
    flexDirection: logicalRow,
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  linkRowLast: { borderBottomWidth: 0 },
  linkIconTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN_LIGHT,
  },
  linkEmoji: { fontSize: 16 },
  linkTitle: {
    flex: 1,
    minWidth: 0,
    color: TEXT,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
    textAlign: textAlignStart,
  },
  linkAction: {
    color: GREEN,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "900",
    textAlign: textAlignEnd,
    flexShrink: 1,
  },
  linkActionDisabled: { color: MUTED },
  emptyModal: { padding: 20, alignItems: "center" },
  emptyModalText: { color: MUTED, fontSize: 13, fontWeight: "700", textAlign: "center" },
  expandTitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  expandLink: { fontSize: 13, fontWeight: "900", color: GREEN },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "82%",
    paddingBottom: 24,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    marginTop: 10,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: logicalRow,
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalHeaderText: { flex: 1, paddingEnd: 12 },
  modalTitle: { fontSize: 17, fontWeight: "900", color: TEXT },
  modalSubtitle: { fontSize: 12, color: MUTED, marginTop: 4 },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BG,
  },
  modalScroll: { maxHeight: 480 },
  modalScrollContent: { padding: 16, paddingTop: 12 },
  modalListCard: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 12, overflow: "hidden" },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  planIcon: { alignItems: "center", justifyContent: "center", marginEnd: 10 },
  planIconLetter: { fontSize: 14, fontWeight: "900" },
  payRow: { flexDirection: logicalRow, alignItems: "center", padding: 12 },
  payMid: { flex: 1, minWidth: 0 },
  payTitle: { fontSize: 13, color: TEXT, fontWeight: "800", textAlign: textAlignStart },
  payDate: { fontSize: 11, color: MUTED, marginTop: 2 },
  payRight: { alignItems: textAlignEnd === "right" ? "flex-end" : "flex-start", gap: 4, flexShrink: 1 },
  payAmount: { fontSize: 14, fontWeight: "900", color: TEXT },
  paidBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 120 },
  paidBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: "900", textAlign: "center" },
  receiptLink: { fontSize: 10, color: GREEN, fontWeight: "900" },
  timelineRow: { flexDirection: logicalRow, padding: 12, alignItems: "flex-start" },
  timelineRowCompact: { paddingVertical: 10 },
  timelineRail: { width: 20, alignItems: "center", marginEnd: 10 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: MUTED, borderWidth: 1, borderColor: MUTED },
  timelineLine: { width: 1, flex: 1, minHeight: 20, backgroundColor: BORDER, marginVertical: 4 },
  timelineBody: { flex: 1, minWidth: 0, paddingEnd: 8 },
  timelineTitle: { fontSize: 13, fontWeight: "900", color: TEXT, textAlign: textAlignStart },
  timelineMeta: { fontSize: 11, color: MUTED, marginTop: 2, textAlign: textAlignStart },
  timelineRight: {
    alignItems: textAlignEnd === "right" ? "flex-end" : "flex-start",
    gap: 4,
    flexShrink: 1,
    maxWidth: "42%",
  },
  entryBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, maxWidth: "100%" },
  entryBadgeText: { fontSize: 9, lineHeight: 11, fontWeight: "900", textAlign: "center" },
  timelinePrice: { fontSize: 12, fontWeight: "800", color: TEXT },
});
