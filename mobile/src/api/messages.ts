import { apiClient } from "./client";

export type MessageType = "text" | "location" | "referral" | "workout_share" | "stack_share" | "system";

export type MessageUser = {
  user_id: number;
  name: string;
  initials: string;
  profile_photo_url?: string | null;
};

export type ChatMessage = {
  id: number;
  thread_id?: number | null;
  dm_conversation_id?: number | null;
  sender: MessageUser;
  reply_to_message_id?: number | null;
  reply_to?: {
    id: number;
    sender: MessageUser | null;
    type: MessageType;
    body?: string | null;
    deleted: boolean;
  } | null;
  type: MessageType;
  body?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  deleted: boolean;
  is_own: boolean;
};

export type DMConversation = {
  id: number;
  created_at?: string | null;
  other_user: MessageUser | null;
  muted: boolean;
  last_read_message_id?: number | null;
  unread_count: number;
  last_message?: ChatMessage | null;
};

export type ThreadChatConversation = {
  kind: "thread";
  thread_id: number;
  title: string;
  gym_name: string;
  scheduled_time?: string | null;
  status: string;
  muted: boolean;
  last_read_message_id?: number | null;
  unread_count: number;
  last_message?: ChatMessage | null;
};

export type DMChatConversation = DMConversation & { kind: "dm" };

export type ChatConversation = DMChatConversation | ThreadChatConversation;

export type UnreadCounts = {
  total: number;
  pending_join_requests?: number;
  threads: Array<{ thread_id: number; unread_count: number }>;
  dms: Array<{ dm_conversation_id: number; unread_count: number }>;
};

type ConversationParams = {
  thread_id?: number;
  dm_conversation_id?: number;
};

export const fetchMessages = async (params: ConversationParams & { before_id?: number; limit?: number }) => {
  const { data } = await apiClient.get<{ items: ChatMessage[] }>("/api/social/messages", { params });
  return data.items ?? [];
};

export const sendMessage = async (
  payload: ConversationParams & {
    body?: string;
    type?: MessageType;
    metadata?: Record<string, unknown>;
    reply_to_message_id?: number | null;
  },
) => {
  const { data } = await apiClient.post<{ message: ChatMessage }>("/api/social/messages", payload);
  return data.message;
};

export const markConversationRead = async (payload: ConversationParams & { last_read_message_id: number }) => {
  const { data } = await apiClient.post<{ read: boolean; last_read_message_id: number }>("/api/social/messages/read", payload);
  return data;
};

export const getUnreadCounts = async () => {
  const { data } = await apiClient.get<UnreadCounts>("/api/social/messages/unread-counts");
  return data;
};

export const editMessage = async (messageId: number, body: string) => {
  const { data } = await apiClient.patch<{ message: ChatMessage }>(`/api/social/messages/${messageId}`, { body });
  return data.message;
};

export const deleteMessage = async (messageId: number) => {
  const { data } = await apiClient.delete<{ deleted: boolean; message_id: number }>(`/api/social/messages/${messageId}`);
  return data;
};

export const muteConversation = async (payload: ConversationParams) => {
  const { data } = await apiClient.post<{ muted: boolean; thread_id?: number; dm_conversation_id?: number }>(
    "/api/social/messages/mute",
    payload,
  );
  return data;
};

export const unmuteConversation = async (params: ConversationParams) => {
  const { data } = await apiClient.delete<{ muted: boolean; thread_id?: number; dm_conversation_id?: number }>(
    "/api/social/messages/mute",
    { params },
  );
  return data;
};

export const startOrGetDMConversation = async (userId: number) => {
  const { data } = await apiClient.post<{ conversation: DMConversation }>("/api/social/messages/dm-conversations", {
    user_id: userId,
  });
  return data.conversation;
};

export const listDMConversations = async () => {
  const { data } = await apiClient.get<{ items: DMConversation[] }>("/api/social/messages/dm-conversations");
  return data.items ?? [];
};

export const listConversations = async () => {
  const { data } = await apiClient.get<{ items: ChatConversation[] }>("/api/social/messages/conversations");
  return data.items ?? [];
};
