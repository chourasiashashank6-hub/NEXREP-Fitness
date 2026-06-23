import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { getUnreadCounts } from "../api/messages";
import { ScreenContainer } from "../components/ScreenContainer";
import FriendsScreen from "../screens/social/FriendsScreen";
import SocialHomeScreen from "../screens/social/SocialHomeScreen";
import LeaderboardScreen from "../screens/social/LeaderboardScreen";
import UserSearchScreen from "../screens/social/UserSearchScreen";
import ThreadsScreen from "../screens/social/ThreadsScreen";
import ThreadDetailScreen from "../screens/social/ThreadDetailScreen";
import ThreadFormScreen from "../screens/social/ThreadFormScreen";
import MessagesScreen from "../screens/social/MessagesScreen";
import ChatScreen from "../screens/social/ChatScreen";
import ChallengeCreateScreen from "../screens/social/ChallengeCreateScreen";
import ChallengeDetailScreen from "../screens/social/ChallengeDetailScreen";
import type { SocialStackParamList } from "./types";

const Stack = createNativeStackNavigator<SocialStackParamList>();

const GREEN = "#0F6E56";
const BG = "#F7F6F3";
const MUTED = "#6F766F";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";

type SocialRouteName = keyof Pick<
  SocialStackParamList,
  "SocialHome" | "SocialLeaderboard" | "SocialFriends" | "SocialThreads" | "SocialMessages"
>;

function SocialSectionTabs({ active }: { active: SocialRouteName }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [unreadTotal, setUnreadTotal] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      getUnreadCounts()
        .then((counts) => {
          if (alive) setUnreadTotal(counts.total ?? 0);
        })
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const tabs: Array<{ route: SocialRouteName; label: string }> = [
    { route: "SocialHome", label: t("social.nav.home") },
    { route: "SocialLeaderboard", label: t("social.nav.leaderboard") },
    { route: "SocialFriends", label: t("social.nav.friends") },
    { route: "SocialThreads", label: t("social.nav.threads") },
    { route: "SocialMessages", label: t("social.nav.messages") },
  ];
  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => {
        const selected = tab.route === active;
        return (
          <Pressable
            key={tab.route}
            accessibilityRole="button"
            style={[styles.tab, selected ? styles.tabActive : null]}
            onPress={() => navigation.navigate(tab.route)}
          >
            <Text style={[styles.tabText, selected ? styles.tabTextActive : null]}>{tab.label}</Text>
            {tab.route === "SocialMessages" && unreadTotal > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadTotal}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function SocialHomeRouteScreen() {
  return <SocialHomeScreen tabs={<SocialSectionTabs active="SocialHome" />} />;
}

function ThreadsRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialSectionTabs active="SocialThreads" />
      <ThreadsScreen />
    </ScreenContainer>
  );
}

function LeaderboardRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialSectionTabs active="SocialLeaderboard" />
      <LeaderboardScreen />
    </ScreenContainer>
  );
}

function MessagesRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialSectionTabs active="SocialMessages" />
      <MessagesScreen />
    </ScreenContainer>
  );
}

function FriendsRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialSectionTabs active="SocialFriends" />
      <FriendsScreen />
    </ScreenContainer>
  );
}

function PendingRequestsRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialSectionTabs active="SocialFriends" />
      <FriendsScreen initialView="pending" />
    </ScreenContainer>
  );
}

export default function SocialNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SocialHome" component={SocialHomeRouteScreen} />
      <Stack.Screen name="SocialLeaderboard" component={LeaderboardRouteScreen} />
      <Stack.Screen name="SocialFriends" component={FriendsRouteScreen} />
      <Stack.Screen name="SocialPendingRequests" component={PendingRequestsRouteScreen} />
      <Stack.Screen name="SocialUserSearch" component={UserSearchScreen} />
      <Stack.Screen name="SocialThreads" component={ThreadsRouteScreen} />
      <Stack.Screen name="SocialThreadDetail" component={ThreadDetailScreen} />
      <Stack.Screen name="SocialThreadCreate">{() => <ThreadFormScreen mode="create" />}</Stack.Screen>
      <Stack.Screen name="SocialThreadEdit">{() => <ThreadFormScreen mode="edit" />}</Stack.Screen>
      <Stack.Screen name="SocialMessages" component={MessagesRouteScreen} />
      <Stack.Screen name="SocialChat" component={ChatScreen} />
      <Stack.Screen name="SocialChallengeCreate" component={ChallengeCreateScreen} />
      <Stack.Screen name="SocialChallengeDetail" component={ChallengeDetailScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    gap: 6,
  },
  tabActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  tabText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  tabTextActive: {
    color: WHITE,
  },
  badge: {
    alignItems: "center",
    backgroundColor: "#B42318",
    borderRadius: 999,
    minWidth: 19,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  badgeText: {
    color: WHITE,
    fontSize: 10,
    fontWeight: "900",
  },
});
