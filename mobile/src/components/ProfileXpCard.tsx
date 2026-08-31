import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { resolveApiBaseUrl } from "../api/client";
import {
  fetchFriendsXpLeaderboard,
  fetchXpSummary,
  type XpLeaderboardRow,
  type XpSummary,
} from "../api/xp";
import { useXpRefreshStore } from "../store/xpRefreshStore";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../theme/colors";

const MUTED = "#BBBBBB";
const GOLD = "#D97706";
const GOLD_LIGHT = "#FEF3C7";
const TRACK = "#E5E4E0";

const numFmt = (n: number) => Math.round(n).toLocaleString();
const LEADERBOARD_PREVIEW_COUNT = 3;

function LeaderboardRow({ row, youLabel }: { row: XpLeaderboardRow; youLabel: string }) {
  return (
    <View style={[styles.leaderboardRow, row.is_self && styles.leaderboardRowSelf]}>
      <Text style={styles.leaderboardRank}>#{row.rank}</Text>
      <Text style={styles.leaderboardName} numberOfLines={1}>
        {row.is_self ? youLabel : row.display_name}
      </Text>
      <Text style={styles.leaderboardXp}>{numFmt(row.season_xp)} XP</Text>
    </View>
  );
}

const EMPTY_XP_SUMMARY: XpSummary = {
  total_xp: 0,
  level: 1,
  xp_into_level: 0,
  xp_to_next_level: 150,
  comeback_sessions_remaining: 0,
  season: null,
};

export function ProfileXpCard() {
  const { t } = useTranslation();
  const xpRefreshVersion = useXpRefreshStore((state) => state.version);
  const [summary, setSummary] = useState<XpSummary>(EMPTY_XP_SUMMARY);
  const [leaderboard, setLeaderboard] = useState<XpLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [leaderboardModalOpen, setLeaderboardModalOpen] = useState(false);
  const lastLoadAt = useRef(0);
  const apiBase = useMemo(() => resolveApiBaseUrl(), []);

  const loadXp = useCallback(async () => {
    setLoading((prev) => (lastLoadAt.current === 0 ? true : prev));
    setLoadError(null);
    try {
      const [xp, board] = await Promise.all([
        fetchXpSummary(),
        fetchFriendsXpLeaderboard().catch(() => ({ items: [] as XpLeaderboardRow[] })),
      ]);
      setSummary(xp);
      setLeaderboard(board.items ?? []);
      lastLoadAt.current = Date.now();
    } catch (error) {
      if (lastLoadAt.current === 0) {
        setSummary(EMPTY_XP_SUMMARY);
        setLeaderboard([]);
      }
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setLoadError(t("profile.xp.notDeployed", { base: apiBase }));
      } else {
        setLoadError(t("profile.xp.loadFailed", { base: apiBase }));
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, t]);

  useFocusEffect(
    useCallback(() => {
      void loadXp();
    }, [loadXp]),
  );

  useEffect(() => {
    if (xpRefreshVersion === 0) return;
    void loadXp();
  }, [xpRefreshVersion, loadXp]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadXp();
    });
    return () => sub.remove();
  }, [loadXp]);

  const progressPct = useMemo(() => {
    if (summary.xp_to_next_level == null || summary.xp_to_next_level <= 0) {
      return summary.xp_to_next_level == null ? 100 : 0;
    }
    return Math.max(0, Math.min(100, Math.round((summary.xp_into_level / summary.xp_to_next_level) * 100)));
  }, [summary]);

  const previewLeaderboard = useMemo(
    () => leaderboard.slice(0, LEADERBOARD_PREVIEW_COUNT),
    [leaderboard],
  );
  const hasMoreLeaderboard = leaderboard.length > LEADERBOARD_PREVIEW_COUNT;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>{t("profile.xp.title")}</Text>

      {loading && !loadError ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <>
          {loadError ? <Text style={styles.loadError}>{loadError}</Text> : null}

          <View style={styles.heroRow}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeLabel}>{t("profile.xp.level")}</Text>
              <Text style={styles.levelBadgeValue}>{summary.level}</Text>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.totalXp}>{t("profile.xp.totalXp", { xp: numFmt(summary.total_xp) })}</Text>
              {summary.xp_to_next_level != null ? (
                <Text style={styles.nextLevel}>
                  {t("profile.xp.nextLevel", {
                    current: numFmt(summary.xp_into_level),
                    total: numFmt(summary.xp_to_next_level),
                  })}
                </Text>
              ) : (
                <Text style={styles.nextLevel}>{t("profile.xp.maxLevel")}</Text>
              )}
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>

          {summary.comeback_sessions_remaining > 0 ? (
            <View style={styles.comebackPill}>
              <Text style={styles.comebackText}>
                {t("profile.xp.comebackBonus", { count: summary.comeback_sessions_remaining })}
              </Text>
            </View>
          ) : null}

          {summary.season ? (
            <View style={styles.seasonRow}>
              <Text style={styles.seasonName}>{summary.season.name}</Text>
              <Text style={styles.seasonXp}>{t("profile.xp.seasonXp", { xp: numFmt(summary.season.season_xp) })}</Text>
            </View>
          ) : null}

          <Text style={styles.leaderboardTitle}>{t("profile.xp.friendsLeaderboard")}</Text>
          {leaderboard.length === 0 ? (
            <Text style={styles.leaderboardEmpty}>{t("profile.xp.leaderboardEmpty")}</Text>
          ) : (
            <>
              <View style={styles.leaderboardList}>
                {previewLeaderboard.map((row) => (
                  <LeaderboardRow key={row.user_id} row={row} youLabel={t("profile.xp.you")} />
                ))}
              </View>
              {hasMoreLeaderboard ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.viewAllRow}
                  onPress={() => setLeaderboardModalOpen(true)}
                >
                  <Text style={styles.viewAllText}>{t("profile.xp.viewAll")}</Text>
                  <Text style={styles.viewAllChevron}>›</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </>
      )}

      <Modal
        visible={leaderboardModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLeaderboardModalOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setLeaderboardModalOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeaderRow}>
              <Pressable style={styles.modalCloseBtn} onPress={() => setLeaderboardModalOpen(false)} hitSlop={10}>
                <Text style={styles.modalCloseText}>‹</Text>
              </Pressable>
              <Text style={styles.modalTitle}>{t("profile.xp.friendsLeaderboard")}</Text>
              <View style={styles.modalCloseBtn} />
            </View>
            <ScrollView contentContainerStyle={styles.modalList} showsVerticalScrollIndicator={false}>
              {leaderboard.map((row) => (
                <LeaderboardRow key={`modal-${row.user_id}`} row={row} youLabel={t("profile.xp.you")} />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: BG, borderRadius: 16, padding: 14, marginBottom: 14 },
  sectionLabel: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginBottom: 12 },
  loader: { marginVertical: 8 },
  loadError: { color: MUTED, fontSize: 11, fontWeight: "700", marginBottom: 10 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  levelBadge: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  levelBadgeLabel: { color: "#D1FAE5", fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  levelBadgeValue: { color: WHITE, fontSize: 26, fontWeight: "900", marginTop: 2 },
  heroCopy: { flex: 1 },
  totalXp: { color: TEXT, fontSize: 16, fontWeight: "900" },
  nextLevel: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 4 },
  progressTrack: {
    height: 8,
    borderRadius: 99,
    backgroundColor: TRACK,
    overflow: "hidden",
    marginBottom: 10,
  },
  progressFill: { height: 8, borderRadius: 99, backgroundColor: GREEN },
  comebackPill: {
    alignSelf: "flex-start",
    backgroundColor: GOLD_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  comebackText: { color: GOLD, fontSize: 11, fontWeight: "800" },
  seasonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  seasonName: { color: TEXT, fontSize: 13, fontWeight: "800", flex: 1, marginRight: 8 },
  seasonXp: { color: GREEN, fontSize: 12, fontWeight: "900" },
  leaderboardTitle: { color: MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 0.6, marginBottom: 8 },
  leaderboardEmpty: { color: MUTED, fontSize: 12, fontWeight: "700" },
  leaderboardList: { gap: 6 },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: WHITE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  leaderboardRowSelf: { backgroundColor: GREEN_LIGHT, borderColor: "#CFE8DC" },
  leaderboardRank: { color: MUTED, fontSize: 12, fontWeight: "900", width: 28 },
  leaderboardName: { color: TEXT, fontSize: 13, fontWeight: "800", flex: 1 },
  leaderboardXp: { color: GREEN, fontSize: 12, fontWeight: "900" },
  viewAllRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  viewAllText: { color: GREEN, fontSize: 12, fontWeight: "800" },
  viewAllChevron: { color: GREEN, fontSize: 18, fontWeight: "900", lineHeight: 18 },
  modalBackdrop: { backgroundColor: "rgba(0,0,0,0.32)", flex: 1, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "82%",
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  modalHandle: {
    alignSelf: "center",
    backgroundColor: TRACK,
    borderRadius: 999,
    height: 4,
    marginBottom: 12,
    width: 44,
  },
  modalHeaderRow: { alignItems: "center", flexDirection: "row", marginBottom: 12 },
  modalCloseBtn: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  modalCloseText: { color: TEXT, fontSize: 28, fontWeight: "300", lineHeight: 28 },
  modalTitle: { color: TEXT, flex: 1, fontSize: 15, fontWeight: "900", textAlign: "center" },
  modalList: { gap: 6, paddingBottom: 8 },
});
