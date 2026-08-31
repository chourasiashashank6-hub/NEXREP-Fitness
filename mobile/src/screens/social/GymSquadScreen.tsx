import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { acceptSquadInvite, declineSquadInvite, listSquads, type GymSquad } from "../../api/gymSquads";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import { apiErrorMessage, notifyUser } from "../../utils/notify";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

export default function GymSquadScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { hasFeatureAccess } = useFeatureAccess();
  const canCreate = hasFeatureAccess("gym_squads_create");
  const [active, setActive] = useState<GymSquad[]>([]);
  const [invites, setInvites] = useState<GymSquad[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [activeRes, inviteRes] = await Promise.all([listSquads("active"), listSquads("invited")]);
      setActive(activeRes.items ?? []);
      setInvites(inviteRes.items ?? []);
    } catch (error) {
      notifyUser(
        t("common.error"),
        apiErrorMessage(error, t("social.squads.alerts.loadFailed"), t("social.squads.alerts.unavailable")),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const respondInvite = async (squad: GymSquad, action: "accept" | "decline") => {
    setBusyId(squad.id);
    try {
      if (action === "accept") {
        const updated = await acceptSquadInvite(squad.id);
        setInvites((current) => current.filter((item) => item.id !== squad.id));
        setActive((current) => [updated, ...current]);
        navigation.navigate("SocialGymSquadDetail", { squadId: updated.id });
      } else {
        await declineSquadInvite(squad.id);
        setInvites((current) => current.filter((item) => item.id !== squad.id));
      }
    } catch (error) {
      notifyUser(t("common.error"), apiErrorMessage(error, t("social.squads.alerts.actionFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const renderSquadRow = (squad: GymSquad, onPress: () => void) => (
    <Pressable key={squad.id} style={styles.card} onPress={onPress}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{squad.name}</Text>
        <Text style={styles.cardMeta}>
          {t("social.squads.memberCount", { count: squad.member_count, max: squad.max_members })}
        </Text>
      </View>
      {typeof squad.squad_streak === "number" && squad.squad_streak > 0 ? (
        <Text style={styles.streak}>{t("social.squads.streak", { count: squad.squad_streak })}</Text>
      ) : null}
    </Pressable>
  );

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("social.squads.title")}</Text>
        {canCreate ? (
          <Pressable style={styles.createButton} onPress={() => navigation.navigate("SocialGymSquadCreate")}>
            <Text style={styles.createText}>{t("social.squads.create")}</Text>
          </Pressable>
        ) : (
          <View style={styles.createSpacer} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {invites.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t("social.squads.invites")}</Text>
              {invites.map((squad) => (
                <View key={squad.id} style={styles.inviteCard}>
                  <Text style={styles.cardTitle}>{squad.name}</Text>
                  <Text style={styles.inviteBy}>
                    {t("social.squads.invitedBy", { name: squad.creator.name })}
                  </Text>
                  <View style={styles.inviteActions}>
                    <Pressable
                      style={[styles.acceptBtn, busyId === squad.id && styles.disabledBtn]}
                      disabled={busyId === squad.id}
                      onPress={() => void respondInvite(squad, "accept")}
                    >
                      <Text style={styles.acceptText}>{t("social.squads.accept")}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.declineBtn, busyId === squad.id && styles.disabledBtn]}
                      disabled={busyId === squad.id}
                      onPress={() => void respondInvite(squad, "decline")}
                    >
                      <Text style={styles.declineText}>{t("social.squads.decline")}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("social.squads.active")}</Text>
            {active.length === 0 ? (
              <Text style={styles.empty}>{t("social.squads.empty")}</Text>
            ) : (
              active.map((squad) =>
                renderSquadRow(squad, () => navigation.navigate("SocialGymSquadDetail", { squadId: squad.id })),
              )
            )}
          </View>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  backButton: { paddingVertical: 8, paddingRight: 12 },
  backText: { color: GREEN, fontWeight: "800", fontSize: 14 },
  title: { color: TEXT, fontSize: 20, fontWeight: "900", flex: 1, textAlign: "center" },
  createButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  createText: { color: GREEN, fontWeight: "800", fontSize: 12 },
  createSpacer: { width: 72 },
  loader: { marginTop: 24 },
  content: { paddingBottom: 24, gap: 16 },
  section: { gap: 10 },
  sectionLabel: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  empty: { color: MUTED, fontSize: 13, fontWeight: "700" },
  card: { backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 6 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardTitle: { color: TEXT, fontSize: 16, fontWeight: "900", flex: 1 },
  cardMeta: { color: MUTED, fontSize: 11, fontWeight: "700" },
  streak: { color: GREEN, fontSize: 12, fontWeight: "800" },
  inviteCard: { backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 10 },
  inviteBy: { color: MUTED, fontSize: 12, fontWeight: "700" },
  inviteActions: { flexDirection: "row", gap: 8 },
  acceptBtn: { flex: 1, backgroundColor: GREEN, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  acceptText: { color: WHITE, fontWeight: "800", fontSize: 13 },
  declineBtn: { flex: 1, backgroundColor: BG, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  declineText: { color: MUTED, fontWeight: "800", fontSize: 13 },
  disabledBtn: { opacity: 0.6 },
});
