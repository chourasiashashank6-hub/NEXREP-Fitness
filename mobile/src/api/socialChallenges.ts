import { apiClient } from "./client";
import type { SocialUserProfile } from "./social";

export type ChallengeType = "streak_battle" | "workout_count";
export type ChallengeStatus = "active" | "completed" | "cancelled";
export type ChallengeParticipantStatus = "invited" | "joined" | "declined" | "left";

export type LeaderboardEntry = {
  rank: number;
  user: Pick<SocialUserProfile, "user_id" | "name" | "initials" | "profile_photo_url">;
  workouts_this_week: number;
  current_streak: number;
  score: number;
};

export type LeaderboardResponse = {
  items: LeaderboardEntry[];
  week_start: string;
  next_reset_at: string;
  viewer_settings: { opted_in: boolean };
  unlock_required_count: number;
  unlocked: boolean;
};

export type ChallengeStanding = {
  rank: number;
  user: Pick<SocialUserProfile, "user_id" | "name" | "initials" | "profile_photo_url">;
  progress: number;
  status: ChallengeParticipantStatus;
  joined_at?: string | null;
  target_reached_at?: string | null;
};

export type SquadChallenge = {
  id: number;
  creator: Pick<SocialUserProfile, "user_id" | "name" | "initials" | "profile_photo_url">;
  type: ChallengeType;
  title: string;
  target: number;
  start_date: string;
  end_date: string;
  status: ChallengeStatus;
  winner?: Pick<SocialUserProfile, "user_id" | "name" | "initials" | "profile_photo_url"> | null;
  created_at?: string | null;
  viewer_status?: ChallengeParticipantStatus | null;
  viewer_is_creator?: boolean;
  standings?: ChallengeStanding[];
};

export type ChallengeCreatePayload = {
  type: ChallengeType;
  title: string;
  target: number;
  duration_days: number;
  invite_user_ids?: number[];
};

export const getLeaderboard = async (): Promise<LeaderboardResponse> => {
  const { data } = await apiClient.get<LeaderboardResponse>("/api/social/leaderboard");
  return data;
};

export const updateLeaderboardSettings = async (optedIn: boolean) => {
  const { data } = await apiClient.put<{ leaderboard: { opted_in: boolean } }>("/api/social/leaderboard/settings", {
    opted_in: optedIn,
  });
  return data.leaderboard;
};

export const createChallenge = async (payload: ChallengeCreatePayload): Promise<SquadChallenge> => {
  const { data } = await apiClient.post<{ challenge: SquadChallenge }>("/api/social/challenges", payload);
  return data.challenge;
};

export const listChallenges = async (bucket: "active" | "invited"): Promise<SquadChallenge[]> => {
  const { data } = await apiClient.get<{ items: SquadChallenge[] }>("/api/social/challenges", { params: { bucket } });
  return data.items ?? [];
};

export const getChallengeHistory = async (): Promise<SquadChallenge[]> => {
  const { data } = await apiClient.get<{ items: SquadChallenge[] }>("/api/social/challenges/history");
  return data.items ?? [];
};

export const getChallengeStandings = async (challengeId: number): Promise<SquadChallenge> => {
  const { data } = await apiClient.get<{ challenge: SquadChallenge }>(`/api/social/challenges/${challengeId}/standings`);
  return data.challenge;
};

export const inviteChallengeFriends = async (challengeId: number, userIds: number[]): Promise<SquadChallenge> => {
  const { data } = await apiClient.post<{ challenge: SquadChallenge }>(`/api/social/challenges/${challengeId}/invite`, {
    user_ids: userIds,
  });
  return data.challenge;
};

export const acceptChallengeInvite = async (challengeId: number): Promise<SquadChallenge> => {
  const { data } = await apiClient.post<{ challenge: SquadChallenge }>(`/api/social/challenges/${challengeId}/accept`);
  return data.challenge;
};

export const declineChallengeInvite = async (challengeId: number) => {
  const { data } = await apiClient.post<{ declined: boolean; challenge_id: number }>(`/api/social/challenges/${challengeId}/decline`);
  return data;
};

export const leaveChallenge = async (challengeId: number) => {
  const { data } = await apiClient.post<{ left: boolean; challenge_id: number }>(`/api/social/challenges/${challengeId}/leave`);
  return data;
};
