import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { getUnreadCounts } from "../api/messages";
import { getFriendRequests } from "../api/social";
import { listThreads } from "../api/threads";
import { ScreenContainer } from "../components/ScreenContainer";
import { SwipeTabPager } from "../components/SwipeTabPager";
import FriendsScreen from "../screens/social/FriendsScreen";
import SocialHomeScreen from "../screens/social/SocialHomeScreen";
import LeaderboardScreen from "../screens/social/LeaderboardScreen";
import UserSearchScreen from "../screens/social/UserSearchScreen";
import ThreadsScreen from "../screens/social/ThreadsScreen";
import ThreadDetailScreen from "../screens/social/ThreadDetailScreen";
import ThreadFormScreen from "../screens/social/ThreadFormScreen";
import ChatsScreen from "../screens/social/ChatsScreen";
import ChatScreen from "../screens/social/ChatScreen";
import ChallengeCreateScreen from "../screens/social/ChallengeCreateScreen";
import ChallengeDetailScreen from "../screens/social/ChallengeDetailScreen";
import GymSquadScreen from "../screens/social/GymSquadScreen";
import GymSquadCreateScreen from "../screens/social/GymSquadCreateScreen";
import GymSquadDetailScreen from "../screens/social/GymSquadDetailScreen";
import type { SocialHubTab, SocialStackParamList } from "./types";
import { subscribeToSocialUnreadChanges } from "../utils/socialUnreadEvents";

const Stack = createNativeStackNavigator<SocialStackParamList>();

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const BG = "#F7F6F3";
const MUTED = "#6F766F";
const BORDER = "#ECEAE5";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";

function tabToIndex(tab?: SocialHubTab): number {
  if (tab === "threads") return 1;
  if (tab === "chats") return 2;
  return 0;
}

function SocialBrandHeader() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [incomingFriendRequests, setIncomingFriendRequests] = useState(0);

  const loadFriendBadge = useCallback(async () => {
    try {
      const requests = await getFriendRequests();
      setIncomingFriendRequests(requests.incoming.length);
    } catch {
      // Keep last visible count.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadFriendBadge();
    }, [loadFriendBadge]),
  );

  return (
    <View style={styles.brandHeader}>
      <View style={styles.brandTitleRow}>
        <Text style={styles.brandHeaderText}>{t("social.header.title")}</Text>
        <Ionicons name="people-outline" size={19} color={GREEN} style={styles.brandHeaderIcon} />
      </View>
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("social.header.findPeople")}
          style={styles.headerIconBtn}
          onPress={() => navigation.navigate("SocialFriends")}
        >
          <Ionicons name="person-add-outline" size={20} color={TEXT} />
          {incomingFriendRequests > 0 ? (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{incomingFriendRequests}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("social.header.search")}
          style={styles.headerIconBtn}
          onPress={() => navigation.navigate("SocialUserSearch")}
        >
          <Ionicons name="search-outline" size={20} color={TEXT} />
        </Pressable>
      </View>
    </View>
  );
}

function SocialSectionTabs({
  activeTabIndex,
  onTabPress,
}: {
  activeTabIndex: number;
  onTabPress: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
  const [pendingJoinRequests, setPendingJoinRequests] = useState(0);
  const [threadInvites, setThreadInvites] = useState(0);
  const unreadRequestId = useRef(0);

  const loadBadges = useCallback(async () => {
    const requestId = unreadRequestId.current + 1;
    unreadRequestId.current = requestId;
    try {
      const [counts, invitedThreads] = await Promise.all([getUnreadCounts(), listThreads("invited")]);
      if (requestId !== unreadRequestId.current) return;
      const joinRequests = counts.pending_join_requests ?? 0;
      const dmUnread = (counts.dms ?? []).reduce((sum, item) => sum + (item.unread_count ?? 0), 0);
      const threadUnread = (counts.threads ?? []).reduce((sum, item) => sum + (item.unread_count ?? 0), 0);
      setPendingJoinRequests(joinRequests);
      setThreadInvites(invitedThreads.length);
      setChatUnreadTotal(dmUnread + threadUnread);
    } catch {
      // Keep the last visible count if the network request fails.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadBadges();
    }, [loadBadges]),
  );

  useEffect(() => {
    void loadBadges();
    const unsubscribe = subscribeToSocialUnreadChanges(() => {
      void loadBadges();
    });
    const id = setInterval(() => {
      void loadBadges();
    }, 30000);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [loadBadges]);

  const tabs: Array<{ index: number; tab: SocialHubTab; label: string }> = [
    { index: 0, tab: "home", label: t("social.nav.home") },
    { index: 1, tab: "threads", label: t("social.nav.threads") },
    { index: 2, tab: "chats", label: t("social.nav.chats") },
  ];

  return (
    <View style={styles.hubChrome}>
      <SocialBrandHeader />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {tabs.map((tab) => {
          const selected = tab.index === activeTabIndex;
          return (
            <Pressable
              key={tab.tab}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.tab, selected ? styles.tabActive : null]}
              onPress={() => onTabPress(tab.index)}
            >
              <Text style={[styles.tabText, selected ? styles.tabTextActive : null]}>{tab.label}</Text>
              {tab.tab === "chats" && chatUnreadTotal > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{chatUnreadTotal}</Text>
                </View>
              ) : null}
              {tab.tab === "threads" && (pendingJoinRequests > 0 || threadInvites > 0) ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pendingJoinRequests + threadInvites}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SocialHubScreen({ forcedTab }: { forcedTab?: SocialHubTab }) {
  const route = useRoute<RouteProp<SocialStackParamList, "SocialHome" | "SocialMessages">>();
  const paramTab = forcedTab ?? (route.name === "SocialMessages" ? "chats" : route.params?.tab);
  const [tabIndex, setTabIndex] = useState(() => tabToIndex(paramTab));

  useEffect(() => {
    if (paramTab) {
      setTabIndex(tabToIndex(paramTab));
    }
  }, [paramTab]);

  return (
    <ScreenContainer bg={BG} scroll={false} contentStyle={styles.hubContent}>
      <SocialSectionTabs activeTabIndex={tabIndex} onTabPress={setTabIndex} />
      <SwipeTabPager
        pageIndex={tabIndex}
        onPageIndexChange={setTabIndex}
        lazyFromIndex={1}
        style={styles.hubPager}
      >
        <SocialHomeScreen embedded />
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.hubPageContent}
        >
          <ThreadsScreen />
        </ScrollView>
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.hubPageContent}
        >
          <ChatsScreen />
        </ScrollView>
      </SwipeTabPager>
    </ScreenContainer>
  );
}

function SocialHomeRouteScreen() {
  return <SocialHubScreen />;
}

function SocialMessagesRouteScreen() {
  return <SocialHubScreen forcedTab="chats" />;
}

function SocialStackBackHeader() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  return (
    <View style={styles.stackBackHeader}>
      <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>{t("common.back")}</Text>
      </Pressable>
    </View>
  );
}

function LeaderboardRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialBrandHeader />
      <LeaderboardScreen />
    </ScreenContainer>
  );
}

function FriendsRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialStackBackHeader />
      <FriendsScreen />
    </ScreenContainer>
  );
}

function PendingRequestsRouteScreen() {
  return (
    <ScreenContainer bg={BG}>
      <SocialStackBackHeader />
      <FriendsScreen initialView="pending" />
    </ScreenContainer>
  );
}

export default function SocialNavigator() {
  return (
    <Stack.Navigator initialRouteName="SocialHome" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SocialHome" component={SocialHomeRouteScreen} />
      <Stack.Screen name="SocialLeaderboard" component={LeaderboardRouteScreen} />
      <Stack.Screen name="SocialFriends" component={FriendsRouteScreen} />
      <Stack.Screen name="SocialPendingRequests" component={PendingRequestsRouteScreen} />
      <Stack.Screen name="SocialUserSearch" component={UserSearchScreen} />
      <Stack.Screen name="SocialThreadDetail" component={ThreadDetailScreen} />
      <Stack.Screen name="SocialThreadCreate">{() => <ThreadFormScreen mode="create" />}</Stack.Screen>
      <Stack.Screen name="SocialThreadEdit">{() => <ThreadFormScreen mode="edit" />}</Stack.Screen>
      <Stack.Screen name="SocialMessages" component={SocialMessagesRouteScreen} />
      <Stack.Screen name="SocialChat" component={ChatScreen} />
      <Stack.Screen name="SocialChallengeCreate" component={ChallengeCreateScreen} />
      <Stack.Screen name="SocialChallengeDetail" component={ChallengeDetailScreen} />
      <Stack.Screen name="SocialGymSquads" component={GymSquadScreen} />
      <Stack.Screen name="SocialGymSquadCreate" component={GymSquadCreateScreen} />
      <Stack.Screen name="SocialGymSquadDetail" component={GymSquadDetailScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  stackBackHeader: {
    marginBottom: 8,
  },
  backButton: {
    alignSelf: "flex-start",
    backgroundColor: GREEN_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: "900",
  },
  brandHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  brandTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  brandHeaderText: {
    color: TEXT,
    fontSize: 25,
    fontWeight: "800",
  },
  brandHeaderIcon: {
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  headerIconBtn: {
    alignItems: "center",
    backgroundColor: WHITE,
    borderColor: BORDER,
    borderRadius: 12,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  headerBadge: {
    alignItems: "center",
    backgroundColor: "#B42318",
    borderRadius: 999,
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    position: "absolute",
    right: -4,
    top: -4,
  },
  headerBadgeText: {
    color: WHITE,
    fontSize: 9,
    fontWeight: "900",
  },
  tabs: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingRight: 4,
  },
  tabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 16,
  },
  hubChrome: {
    flexGrow: 0,
    flexShrink: 0,
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
    flexShrink: 0,
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
  hubContent: {
    flex: 1,
    minHeight: 0,
    paddingBottom: 16,
  },
  hubPager: {
    flex: 1,
    minHeight: 0,
  },
  hubPageContent: {
    paddingBottom: 24,
  },
});
