import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { getSquad, listSquads, type GymSquad, type GymSquadMember } from "../../api/gymSquads";
import { UserAvatar } from "../UserAvatar";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import { GREEN, GREEN_LIGHT, TEXT, MUTED, BORDER, WHITE } from "../../theme/colors";

const TERTIARY = "#9BA39D";
function memberStatusLabel(member: GymSquadMember, t: (key: string) => string) {
  if (!member.daily) return "";
  if (member.daily.visibility === "private") return t("social.squads.statusPrivate");
  if (member.daily.complete) return t("social.squads.statusComplete");
  const parts: string[] = [];
  if (member.daily.workout_logged) parts.push(t("social.squads.workoutDone"));
  if (member.daily.meals_logged) parts.push(t("social.squads.mealsDone"));
  if (parts.length === 0) return t("social.squads.statusPending");
  return parts.join(" · ");
}

type SquadCardProps = {
  squad: GymSquad;
  onPress: () => void;
};

function SquadCard({ squad, onPress }: SquadCardProps) {
  const { t } = useTranslation();
  const joinedMembers = (squad.members ?? []).filter((member) => member.status === "joined");

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>{squad.name}</Text>
          <Text style={styles.cardMeta}>
            {t("social.squads.memberCount", { count: squad.member_count, max: squad.max_members })}
          </Text>
        </View>
        {typeof squad.squad_streak === "number" && squad.squad_streak > 0 ? (
          <Text style={styles.streak}>{t("social.squads.streak", { count: squad.squad_streak })}</Text>
        ) : null}
      </View>
      <View style={styles.roster}>
        {joinedMembers.slice(0, 4).map((member) => (
          <View key={member.user.user_id} style={styles.memberRow}>
            <UserAvatar
              name={member.user.name}
              initials={member.user.initials}
              profilePhotoUrl={member.user.profile_photo_url}
              style={styles.avatar}
              textStyle={styles.avatarText}
            />
            <View style={styles.memberCopy}>
              <Text style={styles.memberName} numberOfLines={1}>
                {member.user.name}
              </Text>
              <Text style={styles.memberStatus} numberOfLines={1}>
                {memberStatusLabel(member, t)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

type HomeSquadCardProps = {
  squads: GymSquad[];
  loading: boolean;
};

export function HomeSquadCard({ squads, loading }: HomeSquadCardProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { hasFeatureAccess } = useFeatureAccess();
  const canCreate = hasFeatureAccess("gym_squads_create");
  const canJoin = hasFeatureAccess("gym_squads_join");

  if (loading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("social.home.squadTitle")}</Text>
        <ActivityIndicator color={GREEN} style={styles.loader} />
      </View>
    );
  }

  if (squads.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("social.home.squadTitle")}</Text>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("social.home.squadEmptyTitle")}</Text>
          <Text style={styles.emptyBody}>{t("social.home.squadEmptyBody")}</Text>
          <View style={styles.emptyActions}>
            {canCreate ? (
              <Pressable style={styles.primaryButton} onPress={() => navigation.navigate("SocialGymSquadCreate")}>
                <Text style={styles.primaryButtonText}>{t("social.squads.create")}</Text>
              </Pressable>
            ) : null}
            {canJoin ? (
              <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("SocialGymSquads")}>
                <Text style={styles.secondaryButtonText}>{t("social.home.squadBrowse")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const visible = squads.slice(0, 3);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("social.home.squadTitle")}</Text>
        {squads.length > 3 ? (
          <Pressable onPress={() => navigation.navigate("SocialGymSquads")}>
            <Text style={styles.seeAll}>{t("social.home.squadSeeAll")}</Text>
          </Pressable>
        ) : null}
      </View>
      {visible.map((squad) => (
        <SquadCard key={squad.id} squad={squad} onPress={() => navigation.navigate("SocialGymSquadDetail", { squadId: squad.id })} />
      ))}
    </View>
  );
}

export async function loadHomeSquads(): Promise<GymSquad[]> {
  const { items } = await listSquads("active");
  const detailed = await Promise.all((items ?? []).slice(0, 3).map((squad) => getSquad(squad.id)));
  return detailed;
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: { color: TEXT, fontSize: 18, fontWeight: "900" },
  seeAll: { color: GREEN, fontSize: 12, fontWeight: "900" },
  loader: { marginVertical: 16 },
  emptyCard: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
  },
  emptyTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 6, textAlign: "center" },
  emptyBody: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: 14, textAlign: "center" },
  emptyActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  primaryButton: { backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  primaryButtonText: { color: WHITE, fontSize: 13, fontWeight: "900" },
  secondaryButton: { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryButtonText: { color: GREEN, fontSize: 13, fontWeight: "900" },
  card: {
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  cardHeader: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between", marginBottom: 12 },
  cardTitleWrap: { flex: 1, minWidth: 0 },
  cardTitle: { color: TEXT, fontSize: 16, fontWeight: "900", marginBottom: 3 },
  cardMeta: { color: MUTED, fontSize: 12, fontWeight: "700" },
  streak: { color: GREEN, fontSize: 12, fontWeight: "900" },
  roster: { gap: 8 },
  memberRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  avatar: { alignItems: "center", backgroundColor: GREEN_LIGHT, borderRadius: 17, height: 34, justifyContent: "center", width: 34 },
  avatarText: { color: GREEN, fontSize: 11, fontWeight: "900" },
  memberCopy: { flex: 1, minWidth: 0 },
  memberName: { color: TEXT, fontSize: 13, fontWeight: "900" },
  memberStatus: { color: TERTIARY, fontSize: 11, fontWeight: "700", marginTop: 2 },
});
