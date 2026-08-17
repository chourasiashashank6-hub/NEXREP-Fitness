import { apiClient } from "./client";

export type ProgressPhotoAngle = "front" | "side";

export type BackedUpProgressPhoto = {
  id: number;
  taken_at: string;
  angle: ProgressPhotoAngle;
  storage_path: string;
  created_at?: string | null;
};

export async function listBackedUpProgressPhotos(): Promise<BackedUpProgressPhoto[]> {
  const { data } = await apiClient.get<{ items: BackedUpProgressPhoto[] }>("/api/progress-photos");
  return data.items ?? [];
}

export async function uploadProgressPhotoBackup(payload: {
  base64: string;
  mimeType?: string;
  takenAt: string;
  angle: ProgressPhotoAngle;
}): Promise<BackedUpProgressPhoto> {
  const { data } = await apiClient.post<{ photo: BackedUpProgressPhoto }>("/api/progress-photos", {
    base64: payload.base64,
    mime_type: payload.mimeType ?? "image/jpeg",
    taken_at: payload.takenAt,
    angle: payload.angle,
  });
  return data.photo;
}

export async function deleteBackedUpProgressPhoto(photoId: number): Promise<void> {
  await apiClient.delete(`/api/progress-photos/${photoId}`);
}
