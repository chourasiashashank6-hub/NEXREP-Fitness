import { apiClient } from "./client";
import type { MessageUser } from "./messages";

export type SupplementCategory = "protein" | "creatine" | "preworkout" | "bcaa" | "multivitamin" | "other";
export type StackTimingType = "time_of_day" | "relative_to_workout" | "custom_text";

export type SupplementStackItem = {
  id: number;
  user_id: number;
  category: SupplementCategory;
  product_name: string;
  quantity_note?: string | null;
  timing_type: StackTimingType;
  timing_value?: string | null;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SupplementStackPayload = {
  category: SupplementCategory;
  product_name: string;
  quantity_note?: string | null;
  timing_type: StackTimingType;
  timing_value?: string | null;
  sort_order?: number;
};

export type StackSummaryItem = {
  category: SupplementCategory;
  count: number;
};

export type ThreadStackMember = {
  user: MessageUser & { role?: string };
  shared: boolean;
  items: SupplementStackItem[];
};

export const getMySupplementStack = async () => {
  const { data } = await apiClient.get<{ visible: boolean; items: SupplementStackItem[] }>("/api/social/supplement-stacks/me");
  return { visible: data.visible, items: data.items ?? [] };
};

export const addSupplementStackItem = async (payload: SupplementStackPayload) => {
  const { data } = await apiClient.post<{ item: SupplementStackItem }>("/api/social/supplement-stacks/items", payload);
  return data.item;
};

export const updateSupplementStackItem = async (itemId: number, payload: SupplementStackPayload) => {
  const { data } = await apiClient.patch<{ item: SupplementStackItem }>(`/api/social/supplement-stacks/items/${itemId}`, payload);
  return data.item;
};

export const removeSupplementStackItem = async (itemId: number) => {
  const { data } = await apiClient.delete<{ deleted: boolean; item_id: number }>(`/api/social/supplement-stacks/items/${itemId}`);
  return data;
};

export const reorderSupplementStack = async (itemIds: number[]) => {
  const { data } = await apiClient.post<{ items: SupplementStackItem[] }>("/api/social/supplement-stacks/reorder", {
    item_ids: itemIds,
  });
  return data.items ?? [];
};

export const setSupplementStackVisibility = async (visible: boolean) => {
  const { data } = await apiClient.patch<{ visible: boolean }>("/api/social/supplement-stacks/visibility", { visible });
  return data.visible;
};

export const getFriendSupplementStack = async (userId: number) => {
  const { data } = await apiClient.get<{ user: MessageUser; visible: boolean; items: SupplementStackItem[] }>(
    `/api/social/supplement-stacks/users/${userId}`,
  );
  return { user: data.user, visible: data.visible, items: data.items ?? [] };
};

export const getThreadStackSummary = async (threadId: number) => {
  const { data } = await apiClient.get<{ thread_id: number; items: StackSummaryItem[] }>(
    `/api/social/supplement-stacks/threads/${threadId}/summary`,
  );
  return data.items ?? [];
};

export const getThreadStackDetails = async (threadId: number) => {
  const { data } = await apiClient.get<{ thread_id: number; members: ThreadStackMember[] }>(
    `/api/social/supplement-stacks/threads/${threadId}/details`,
  );
  return data.members ?? [];
};
