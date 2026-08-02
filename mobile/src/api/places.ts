import { apiClient } from "./client";

export type GymPlace = {
  place_id: string;
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
};

export type SearchGymPlacesParams = {
  q: string;
  lat?: number;
  lng?: number;
  limit?: number;
};

export const searchGymPlaces = async ({ q, lat, lng, limit = 8 }: SearchGymPlacesParams): Promise<GymPlace[]> => {
  const { data } = await apiClient.get<{ items: GymPlace[] }>("/api/places/gyms/search", {
    params: {
      q,
      lat,
      lng,
      limit,
    },
  });
  return data.items ?? [];
};
