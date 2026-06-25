import { apiClient } from "./client";

export type FeedEventType = "pr" | "streak_milestone" | "thread_joined";
export type FeedReactionType = "flame" | "clap";

export type FeedUser = {
  user_id: number;
  name: string;
  initials: string;
  profile_photo_url?: string | null;
};

export type FeedEventPayload = {
  lift_id?: number;
  exercise_id?: number;
  exercise_name?: string;
  weight_kg?: number;
  reps?: number;
  estimated_1rm_kg?: number;
  date?: string | null;
  current_streak?: number;
  personal_best_streak?: number;
  is_multiple_of_7?: boolean;
  is_new_personal_best?: boolean;
  source?: string;
  source_id?: number | null;
  milestone_date?: string;
  thread_id?: number;
  thread_title?: string;
  gym_name?: string;
  scheduled_time?: string | null;
};

export type FeedReactionCounts = Record<FeedReactionType, number>;

export type FeedEvent = {
  id: number;
  user: FeedUser;
  type: FeedEventType;
  payload: FeedEventPayload;
  visibility: "friends" | "private";
  created_at?: string | null;
  reaction_counts: FeedReactionCounts;
  viewer_reactions: FeedReactionType[];
};

export type FeedPage = {
  items: FeedEvent[];
  next_before_id: number | null;
};

export const listFeed = async (params: { before_id?: number; limit?: number } = {}): Promise<FeedPage> => {
  const { data } = await apiClient.get<FeedPage>("/api/social/feed", { params });
  return {
    items: data.items ?? [],
    next_before_id: data.next_before_id ?? null,
  };
};

export const reactToFeedEvent = async (eventId: number, type: FeedReactionType): Promise<FeedEvent> => {
  const { data } = await apiClient.post<{ event: FeedEvent }>(`/api/social/feed/${eventId}/reactions`, { type });
  return data.event;
};
