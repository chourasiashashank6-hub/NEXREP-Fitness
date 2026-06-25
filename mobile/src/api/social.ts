import { apiClient } from "./client";

export type FriendshipStatus = "none" | "pending_sent" | "pending_received" | "friends";
export type ReportReason = "harassment" | "spam" | "inappropriate_content" | "fake_profile" | "other";
export type ReportContext = "profile" | "message" | "thread";

export type SocialUserProfile = {
  user_id: number;
  name: string;
  initials: string;
  profile_photo_url?: string | null;
  friendship_status: FriendshipStatus;
  mutual_friends_count: number;
};

export type PendingSocialUserProfile = SocialUserProfile & {
  requested_at?: string | null;
};

export const searchSocialUsers = async (q: string, limit = 20): Promise<SocialUserProfile[]> => {
  const { data } = await apiClient.get<{ items: SocialUserProfile[] }>("/api/social/users/search", {
    params: { q, limit },
  });
  return data.items ?? [];
};

export const getFriends = async (): Promise<SocialUserProfile[]> => {
  const { data } = await apiClient.get<{ items: SocialUserProfile[] }>("/api/social/friends");
  return data.items ?? [];
};

export const getFriendRequests = async (): Promise<{
  incoming: PendingSocialUserProfile[];
  outgoing: PendingSocialUserProfile[];
}> => {
  const { data } = await apiClient.get<{
    incoming: PendingSocialUserProfile[];
    outgoing: PendingSocialUserProfile[];
  }>("/api/social/friend-requests");
  return {
    incoming: data.incoming ?? [],
    outgoing: data.outgoing ?? [],
  };
};

export const sendFriendRequest = async (userId: number): Promise<SocialUserProfile> => {
  const { data } = await apiClient.post<{ request: SocialUserProfile; status: FriendshipStatus }>(
    "/api/social/friend-requests",
    { user_id: userId },
  );
  return data.request;
};

export const cancelFriendRequest = async (userId: number) => {
  const { data } = await apiClient.delete<{ cancelled: boolean; user_id: number }>(`/api/social/friend-requests/${userId}`);
  return data;
};

export const acceptFriendRequest = async (userId: number): Promise<SocialUserProfile> => {
  const { data } = await apiClient.post<{ friend: SocialUserProfile; status: FriendshipStatus }>(
    `/api/social/friend-requests/${userId}/accept`,
  );
  return data.friend;
};

export const declineFriendRequest = async (userId: number) => {
  const { data } = await apiClient.post<{ declined: boolean; user_id: number }>(
    `/api/social/friend-requests/${userId}/decline`,
  );
  return data;
};

export const removeFriend = async (userId: number) => {
  const { data } = await apiClient.delete<{ removed: boolean; user_id: number }>(`/api/social/friends/${userId}`);
  return data;
};

export const blockSocialUser = async (userId: number) => {
  const { data } = await apiClient.post<{ blocked: boolean; user_id: number }>("/api/social/block", { user_id: userId });
  return data;
};

export const submitUserReport = async (payload: {
  reported_user_id: number;
  reason: ReportReason;
  context: ReportContext;
  reference_id?: number | null;
  details?: string | null;
}) => {
  const { data } = await apiClient.post<{
    report: {
      id: number;
      reported_user_id: number;
      reason: ReportReason;
      context: ReportContext;
      reference_id?: number | null;
      created_at?: string | null;
      status: "open" | "reviewed" | "actioned";
    };
    also_block: {
      prompt: boolean;
      user_id: number;
      message: string;
    };
  }>("/api/social/reports", payload);
  return data;
};
