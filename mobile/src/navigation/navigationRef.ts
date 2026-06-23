import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

type NotificationRoute = {
  root: keyof RootStackParamList;
  params?: Record<string, unknown>;
};

type NotificationData = {
  screen?: unknown;
  deep_link?: unknown;
  thread_id?: unknown;
  dm_conversation_id?: unknown;
  challenge_id?: unknown;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const pendingRoutes: NotificationRoute[] = [];

const notificationRoutes: Record<string, NotificationRoute> = {
  SocialPendingRequests: {
    root: "Main",
    params: {
      screen: "Social",
      params: {
        screen: "SocialPendingRequests",
      },
    },
  },
  "nexrep://social/pending-requests": {
    root: "Main",
    params: {
      screen: "Social",
      params: {
        screen: "SocialPendingRequests",
      },
    },
  },
};

function threadRoute(threadId: number): NotificationRoute {
  return {
    root: "Main",
    params: {
      screen: "Social",
      params: {
        screen: "SocialThreadDetail",
        params: { threadId },
      },
    },
  };
}

function chatRoute(params: { threadId?: number; dmConversationId?: number }): NotificationRoute {
  return {
    root: "Main",
    params: {
      screen: "Social",
      params: {
        screen: "SocialChat",
        params,
      },
    },
  };
}

function challengeRoute(challengeId: number): NotificationRoute {
  return {
    root: "Main",
    params: {
      screen: "Social",
      params: {
        screen: "SocialChallengeDetail",
        params: { challengeId },
      },
    },
  };
}

function routeFromNotificationData(data: NotificationData | null | undefined): NotificationRoute | null {
  const screen = typeof data?.screen === "string" ? data.screen : null;
  const deepLink = typeof data?.deep_link === "string" ? data.deep_link : null;
  if (screen === "SocialChat") {
    const threadId = Number(data?.thread_id);
    const dmConversationId = Number(data?.dm_conversation_id);
    if (Number.isFinite(threadId) && threadId > 0) return chatRoute({ threadId });
    if (Number.isFinite(dmConversationId) && dmConversationId > 0) return chatRoute({ dmConversationId });
    return null;
  }
  if (screen === "SocialThreadDetail") {
    const threadId = Number(data?.thread_id);
    return Number.isFinite(threadId) && threadId > 0 ? threadRoute(threadId) : null;
  }
  if (screen === "SocialChallengeDetail") {
    const challengeId = Number(data?.challenge_id);
    return Number.isFinite(challengeId) && challengeId > 0 ? challengeRoute(challengeId) : null;
  }
  const challengeMatch = deepLink?.match(/^nexrep:\/\/social\/challenges\/(\d+)$/);
  if (challengeMatch) {
    return challengeRoute(Number(challengeMatch[1]));
  }
  const threadChatMatch = deepLink?.match(/^nexrep:\/\/social\/threads\/(\d+)\/chat$/);
  if (threadChatMatch) {
    return chatRoute({ threadId: Number(threadChatMatch[1]) });
  }
  const dmMatch = deepLink?.match(/^nexrep:\/\/social\/messages\/(\d+)$/);
  if (dmMatch) {
    return chatRoute({ dmConversationId: Number(dmMatch[1]) });
  }
  const match = deepLink?.match(/^nexrep:\/\/social\/threads\/(\d+)$/);
  if (match) {
    return threadRoute(Number(match[1]));
  }
  return (screen && notificationRoutes[screen]) || (deepLink && notificationRoutes[deepLink]) || null;
}

function navigateRoute(route: NotificationRoute) {
  if (navigationRef.isReady()) {
    (navigationRef.navigate as any)(route.root, route.params);
    return;
  }
  pendingRoutes.push(route);
}

export function flushPendingNotificationNavigation() {
  while (navigationRef.isReady() && pendingRoutes.length > 0) {
    const route = pendingRoutes.shift();
    if (route) {
      (navigationRef.navigate as any)(route.root, route.params);
    }
  }
}

export function navigateFromNotificationData(data: NotificationData | null | undefined): boolean {
  const route = routeFromNotificationData(data);
  if (!route) return false;
  navigateRoute(route);
  return true;
}
