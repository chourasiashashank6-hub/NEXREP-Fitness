import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { getSquad, leaveSquad, updateSquadShareStatus, type GymSquad, type GymSquadMember } from "../../api/gymSquads";
import { ScreenContainer } from "../../components/ScreenContainer";
import { UserAvatar } from "../../components/UserAvatar";
import type { SocialStackParamList } from "../../navigation/types";
import { apiErrorMessage, confirmUser, notifyUser } from "../../utils/notify";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

const ORANGE = "#D85A30";
function memberStatusLabel(member: GymSquadMember, t: (key: string) => string) {
  if (!member.daily) return "";
  if (member.daily.visibility === "private") return t("social.squads.statusPrivate");
  const parts: string[] = [];
  if (member.daily.workout_logged) parts.push(t("social.squads.workoutDone"));
  if (member.daily.meals_logged) parts.push(t("social.squads.mealsDone"));
  if (parts.length === 0) return t("social.squads.statusPending");
  if (member.daily.complete) return t("social.squads.statusComplete");
  return parts.join(" · ");
}

export default function GymSquadDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<SocialStackParamList, "SocialGymSquadDetail">>();
  const squadId = route.params.squadId;
  const [squad, setSquad] = useState<GymSquad | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareBusy, setShareBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSquad(await getSquad(squadId));
    } catch (error) {
      notifyUser(
        t("common.error"),
        apiErrorMessage(error, t("social.squads.alerts.loadFailed"), t("social.squads.alerts.unavailable")),
      );
    } finally {
      setLoading(false);
    }
  }, [squadId, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleShare = async (value: boolean) => {
    if (!squad) return;
    setShareBusy(true);
    try {
      const updated = await updateSquadShareStatus(squad.id, value);
      setSquad(updated);
    } catch (error) {
      notifyUser(t("common.error"), apiErrorMessage(error, t("social.squads.alerts.shareFailed")));
    } finally {
      setShareBusy(false);
    }
  };

  const handleLeave = async () => {
    const confirmed = await confirmUser(t("social.squads.leaveTitle"), t("social.squads.leaveBody"), t("social.squads.leaveConfirm"));
    if (!confirmed) return;
    try {
      await leaveSquad(squadId);
      navigation.goBack();
    } catch (error) {
      notifyUser(t("common.error"), apiErrorMessage(error, t("social.squads.alerts.actionFailed")));
    }
  };

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{t("common.back")}</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {squad?.name ?? t("social.squads.title")}
        </Text>
        <View style={styles.createSpacer} />
      </View>

      {loading || !squad ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroCard}>
            <Text style={styles.heroMeta}>
              {t("social.squads.memberCount", { count: squad.member_count, max: squad.max_members })}
            </Text>
            {typeof squad.squad_streak === "number" ? (
              <Text style={styles.streak}>{t("social.squads.streak", { count: squad.squad_streak })}</Text>
            ) : null}
            <View style={styles.shareRow}>
              <View style={styles.shareCopy}>
                <Text style={styles.shareTitle}>{t("social.squads.shareTitle")}</Text>
                <Text style={styles.shareSub}>{t("social.squads.shareSub")}</Text>
              </View>
              <Switch
                value={Boolean(squad.viewer_share_status)}
                onValueChange={(value) => void toggleShare(value)}
                disabled={shareBusy || squad.viewer_status !== "joined"}
                trackColor={{ false: BORDER, true: GREEN_LIGHT }}
                thumbColor={squad.viewer_share_status ? GREEN : WHITE}
              />
            </View>
          </View>

          <Text style={styles.sectionLabel}>{t("social.squads.roster")}</Text>
          {(squad.members ?? []).map((member) => (
            <View key={member.user.user_id} style={styles.memberRow}>
              <UserAvatar
                name={member.user.name}
                initials={member.user.initials}
                photoUrl={member.user.profile_photo_url}
                size={40}
              />
              <View style={styles.memberCopy}>
                <Text style={styles.memberName}>{member.user.name}</Text>
                <Text style={styles.memberStatus}>{memberStatusLabel(member, t)}</Text>
              </View>
              {member.daily?.visibility === "shared" && member.daily.complete ? (
                <Text style={styles.doneBadge}>{t("social.squads.done")}</Text>
              ) : null}
            </View>
          ))}

          {!squad.viewer_is_creator && squad.viewer_status === "joined" ? (
            <Pressable style={styles.leaveBtn} onPress={handleLeave}>
              <Text style={styles.leaveText}>{t("social.squads.leaveConfirm")}</Text>
            </Pressable>
          ) : null}
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
  createSpacer: { width: 48 },
  loader: { marginTop: 24 },
  content: { paddingBottom: 24, gap: 12 },
  heroCard: { backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 10 },
  heroMeta: { color: MUTED, fontSize: 12, fontWeight: "700" },
  streak: { color: GREEN, fontSize: 14, fontWeight: "900" },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  shareCopy: { flex: 1, gap: 2 },
  shareTitle: { color: TEXT, fontSize: 14, fontWeight: "800" },
  shareSub: { color: MUTED, fontSize: 11, fontWeight: "700", lineHeight: 15 },
  sectionLabel: { color: MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 4 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  memberCopy: { flex: 1, gap: 2 },
  memberName: { color: TEXT, fontSize: 14, fontWeight: "800" },
  memberStatus: { color: MUTED, fontSize: 11, fontWeight: "700" },
  doneBadge: { color: GREEN, fontSize: 11, fontWeight: "900" },
  leaveBtn: { marginTop: 8, alignSelf: "center", paddingVertical: 8 },
  leaveText: { color: ORANGE, fontSize: 13, fontWeight: "800" },
});
