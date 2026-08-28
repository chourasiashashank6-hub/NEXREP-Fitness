import { apiClient } from "./client";
import { localDateIso } from "../utils/localDate";
import type { SocialUserProfile } from "./social";

export type SquadStatus = "active" | "cancelled";
export type SquadMemberStatus = "invited" | "joined" | "declined" | "left";
export type SquadMemberRole = "creator" | "member";

export type SquadMemberDaily =
  | { visibility: "private" }
  | {
      visibility: "shared";
      workout_logged: boolean;
      meals_logged: boolean;
      complete: boolean;
    };

export type GymSquadMember = {
  user: Pick<SocialUserProfile, "user_id" | "name" | "initials" | "profile_photo_url">;
  role: SquadMemberRole;
  status: SquadMemberStatus;
  share_status: boolean;
  joined_at?: string | null;
  daily: SquadMemberDaily | null;
};

export type GymSquad = {
  id: number;
  name: string;
  creator: Pick<SocialUserProfile, "user_id" | "name" | "initials" | "profile_photo_url">;
  max_members: number;
  member_count: number;
  status: SquadStatus;
  created_at?: string | null;
  viewer_status?: SquadMemberStatus | null;
  viewer_is_creator?: boolean;
  viewer_share_status?: boolean;
  squad_streak?: number;
  log_date?: string;
  members?: GymSquadMember[];
};

export type SquadCreatePayload = {
  name: string;
  invite_user_ids?: number[];
  max_members?: number;
};

const localDateParam = () => localDateIso();

export async function listSquads(bucket: "active" | "invited"): Promise<{ items: GymSquad[]; log_date: string }> {
  const { data } = await apiClient.get<{ items: GymSquad[]; log_date: string }>("/api/social/squads", {
    params: { bucket, local_date: localDateParam() },
  });
  return data;
}

export async function getSquad(squadId: number): Promise<GymSquad> {
  const { data } = await apiClient.get<{ squad: GymSquad }>(`/api/social/squads/${squadId}`, {
    params: { local_date: localDateParam() },
  });
  return data.squad;
}

export async function createSquad(payload: SquadCreatePayload): Promise<GymSquad> {
  const { data } = await apiClient.post<{ squad: GymSquad }>("/api/social/squads", payload);
  return data.squad;
}

export async function inviteSquadFriends(squadId: number, userIds: number[]): Promise<GymSquad> {
  const { data } = await apiClient.post<{ squad: GymSquad }>(`/api/social/squads/${squadId}/invite`, {
    user_ids: userIds,
  });
  return data.squad;
}

export async function acceptSquadInvite(squadId: number): Promise<GymSquad> {
  const { data } = await apiClient.post<{ squad: GymSquad }>(`/api/social/squads/${squadId}/accept`);
  return data.squad;
}

export async function declineSquadInvite(squadId: number) {
  const { data } = await apiClient.post<{ declined: boolean; squad_id: number }>(`/api/social/squads/${squadId}/decline`);
  return data;
}

export async function leaveSquad(squadId: number) {
  const { data } = await apiClient.post<{ left: boolean; squad_id: number }>(`/api/social/squads/${squadId}/leave`);
  return data;
}

export async function updateSquadShareStatus(squadId: number, shareStatus: boolean): Promise<GymSquad> {
  const { data } = await apiClient.put<{ squad: GymSquad }>(`/api/social/squads/${squadId}/share`, {
    share_status: shareStatus,
  });
  return data.squad;
}

export async function cancelSquad(squadId: number): Promise<GymSquad> {
  const { data } = await apiClient.post<{ squad: GymSquad }>(`/api/social/squads/${squadId}/cancel`);
  return data.squad;
}
