import type { PlanId } from "../constants/plans";

export type RootStackParamList = {
  Main: undefined | { screen?: string };
  AdminStack: undefined;
  Auth: undefined;
  Onboarding: undefined;
  ActiveWorkoutSession: { planId: number };
  GuidedWarmupSession: undefined;
  AICameraWorkoutSession: { planId: number };
  AITrainerCalibration: { planId?: number } | undefined;
  WorkoutCompletion: {
    elapsedSec: number;
    clientKcal: number;
    serverKcal?: number;
    volumeKg: number;
    setsCompleted: number;
    streakIncremented: boolean;
  };
  DailyGamePlan: undefined;
  ProgressPhotoCapture: { angle?: "front" | "side" } | undefined;
};

export type OnboardingStackParamList = {
  Screen1Personal: undefined;
  Screen2Goal: undefined;
  Screen3Activity: undefined;
  Screen4Diet: undefined;
  Screen5BodyComp: undefined;
  Screen6Setup: undefined;
  Results: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Workout: { view?: "log" | "planner" } | undefined;
  Calories: { view?: "log" | "planner" } | undefined;
  Coach: undefined;
  Social: undefined;
  Profile: undefined;
};

export type ProfileStackParamList = {
  ProfileMain: undefined;
  Settings: undefined;
  MySupplementStack: undefined;
  NotificationPreferences: undefined;
  Subscription: undefined;
  ManageSubscription: { userId: string };
  PlanPicker: undefined;
  Payment: { planId: PlanId; displayPrice: number; isYearly: boolean };
  PaymentSuccess: { planName: string; paymentId: string };
  FastingPreferences: undefined;
  TransformationTimeline: undefined;
};

export type SocialStackParamList = {
  SocialHome: undefined;
  SocialLeaderboard: undefined;
  SocialFriends: { initialView?: "friends" | "pending" } | undefined;
  SocialPendingRequests: undefined;
  SocialUserSearch: undefined;
  SocialThreads: undefined;
  SocialChats: undefined;
  SocialThreadDetail: { threadId: number };
  SocialThreadCreate: undefined;
  SocialThreadEdit: { threadId: number };
  SocialMessages: undefined;
  SocialChat: { threadId?: number; dmConversationId?: number; title?: string };
  SocialChallengeCreate: undefined;
  SocialChallengeDetail: { challengeId: number };
  SocialGymSquads: undefined;
  SocialGymSquadCreate: undefined;
  SocialGymSquadDetail: { squadId: number };
};
