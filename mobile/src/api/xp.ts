import { apiClient } from "./client";

export type XpSeasonSummary = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  season_xp: number;
};

export type XpSummary = {
  total_xp: number;
  level: number;
  xp_into_level: number;
  xp_to_next_level: number | null;
  comeback_sessions_remaining: number;
  season: XpSeasonSummary | null;
};

export type XpLeaderboardRow = {
  rank: number;
  user_id: number;
  display_name: string;
  season_xp: number;
  is_self: boolean;
};

export async function fetchXpSummary(): Promise<XpSummary> {
  const { data } = await apiClient.get<XpSummary>("/api/xp/me");
  return data;
}

export async function fetchFriendsXpLeaderboard(): Promise<{ items: XpLeaderboardRow[] }> {
  const { data } = await apiClient.get<{ items: XpLeaderboardRow[] }>("/api/xp/leaderboard/friends");
  return data;
}
