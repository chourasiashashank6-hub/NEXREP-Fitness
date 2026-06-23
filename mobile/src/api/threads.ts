import { apiClient } from "./client";
import type { SocialUserProfile } from "./social";
import type { StackSummaryItem } from "./supplementStacks";
import type { ChatMessage } from "./messages";

export type ThreadStatus = "active" | "completed" | "cancelled";
export type ThreadMemberRole = "host" | "member";
export type ThreadMemberStatus = "invited" | "joined" | "declined";
export type ThreadBucket = "active" | "invited" | "past" | "all";

export type ThreadMember = Pick<SocialUserProfile, "user_id" | "name" | "initials"> & {
  role: ThreadMemberRole;
  status: ThreadMemberStatus;
  joined_at?: string | null;
};

export type GymThread = {
  id: number;
  host_user_id: number;
  title: string;
  gym_name: string;
  gym_place_id?: string | null;
  scheduled_time: string;
  status: ThreadStatus;
  max_members: number;
  created_at?: string | null;
  expires_at: string;
  member_count: number;
  going_count: number;
  muted: boolean;
  current_user_role?: ThreadMemberRole | null;
  current_user_status?: ThreadMemberStatus | null;
  is_host: boolean;
  member_preview: ThreadMember[];
  members?: ThreadMember[];
  stack_summary?: StackSummaryItem[];
  referral?: ThreadReferral | null;
};

export type ThreadReferral = {
  code: string;
  description?: string | null;
  discount_text?: string | null;
  viewed_count: number;
  copied_count: number;
};

export type ThreadFormPayload = {
  title: string;
  gym: {
    name: string;
    place_id?: string | null;
  };
  scheduled_time: string;
  max_members?: number;
  invite_user_ids?: number[];
};

export type ThreadUpdatePayload = Partial<Pick<ThreadFormPayload, "title" | "gym" | "scheduled_time">>;

export const listThreads = async (bucket: ThreadBucket): Promise<GymThread[]> => {
  const { data } = await apiClient.get<{ items: GymThread[] }>("/api/social/threads", { params: { bucket } });
  return data.items ?? [];
};

export const getThread = async (threadId: number): Promise<GymThread> => {
  const { data } = await apiClient.get<{ thread: GymThread }>(`/api/social/threads/${threadId}`);
  return data.thread;
};

export const createThread = async (payload: ThreadFormPayload): Promise<GymThread> => {
  const { data } = await apiClient.post<{ thread: GymThread }>("/api/social/threads", payload);
  return data.thread;
};

export const updateThread = async (threadId: number, payload: ThreadUpdatePayload): Promise<GymThread> => {
  const { data } = await apiClient.patch<{ thread: GymThread }>(`/api/social/threads/${threadId}`, payload);
  return data.thread;
};

export const cancelThread = async (threadId: number): Promise<GymThread> => {
  const { data } = await apiClient.post<{ thread: GymThread }>(`/api/social/threads/${threadId}/cancel`);
  return data.thread;
};

export const inviteThreadFriends = async (threadId: number, userIds: number[]): Promise<GymThread> => {
  const { data } = await apiClient.post<{ thread: GymThread }>(`/api/social/threads/${threadId}/invite`, {
    user_ids: userIds,
  });
  return data.thread;
};

export const acceptThreadInvite = async (threadId: number): Promise<GymThread> => {
  const { data } = await apiClient.post<{ thread: GymThread }>(`/api/social/threads/${threadId}/accept`);
  return data.thread;
};

export const declineThreadInvite = async (threadId: number) => {
  const { data } = await apiClient.post<{ declined: boolean; thread_id: number }>(`/api/social/threads/${threadId}/decline`);
  return data;
};

export const leaveThread = async (threadId: number) => {
  const { data } = await apiClient.post<{ left: boolean; thread_id: number }>(`/api/social/threads/${threadId}/leave`);
  return data;
};

export const removeThreadMember = async (threadId: number, userId: number) => {
  const { data } = await apiClient.delete<{ removed: boolean; thread_id: number; user_id: number }>(
    `/api/social/threads/${threadId}/members/${userId}`,
  );
  return data;
};

export const muteThread = async (threadId: number) => {
  const { data } = await apiClient.post<{ muted: boolean; thread_id: number }>(`/api/social/threads/${threadId}/mute`);
  return data;
};

export const unmuteThread = async (threadId: number) => {
  const { data } = await apiClient.delete<{ muted: boolean; thread_id: number }>(`/api/social/threads/${threadId}/mute`);
  return data;
};

export const upsertThreadReferral = async (
  threadId: number,
  payload: { code: string; description?: string | null; discount_text?: string | null },
): Promise<GymThread> => {
  const { data } = await apiClient.put<{ thread: GymThread }>(`/api/social/threads/${threadId}/referral`, payload);
  return data.thread;
};

export const removeThreadReferral = async (threadId: number): Promise<GymThread> => {
  const { data } = await apiClient.delete<{ thread: GymThread }>(`/api/social/threads/${threadId}/referral`);
  return data.thread;
};

export const incrementThreadReferralView = async (threadId: number): Promise<ThreadReferral> => {
  const { data } = await apiClient.post<{ referral: ThreadReferral }>(`/api/social/threads/${threadId}/referral/view`);
  return data.referral;
};

export const incrementThreadReferralCopy = async (threadId: number): Promise<ThreadReferral> => {
  const { data } = await apiClient.post<{ referral: ThreadReferral }>(`/api/social/threads/${threadId}/referral/copy`);
  return data.referral;
};

export const shareThreadReferral = async (threadId: number): Promise<ChatMessage> => {
  const { data } = await apiClient.post<{ message: ChatMessage }>(`/api/social/threads/${threadId}/referral/share`);
  return data.message;
};
