import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

export type ProgressPhotoAngle = "front" | "side";

export type LocalProgressPhoto = {
  id: string;
  localUri: string;
  takenAt: string;
  angle: ProgressPhotoAngle;
  backedUp?: boolean;
  serverId?: number;
  storagePath?: string;
};

const STORAGE_KEY = "@nexrep/progress_photos_v1";

function photoDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error("Document directory unavailable");
  return `${base}progress_photos/`;
}

async function ensurePhotoDir(): Promise<string> {
  const dir = photoDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

async function readIndex(): Promise<LocalProgressPhoto[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalProgressPhoto[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(items: LocalProgressPhoto[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function listLocalProgressPhotos(): Promise<LocalProgressPhoto[]> {
  const items = await readIndex();
  const valid: LocalProgressPhoto[] = [];
  for (const item of items) {
    const info = await FileSystem.getInfoAsync(item.localUri);
    if (info.exists) valid.push(item);
  }
  if (valid.length !== items.length) {
    await writeIndex(valid);
  }
  return valid.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export async function saveLocalProgressPhoto(params: {
  sourceUri: string;
  angle: ProgressPhotoAngle;
  takenAt?: string;
}): Promise<LocalProgressPhoto> {
  const dir = await ensurePhotoDir();
  const id = `pp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const destUri = `${dir}${id}.jpg`;
  await FileSystem.copyAsync({ from: params.sourceUri, to: destUri });
  const row: LocalProgressPhoto = {
    id,
    localUri: destUri,
    takenAt: params.takenAt ?? new Date().toISOString(),
    angle: params.angle,
  };
  const items = await readIndex();
  items.unshift(row);
  await writeIndex(items);
  return row;
}

export async function markLocalProgressPhotoBackedUp(
  localId: string,
  server: { id: number; storagePath: string },
): Promise<LocalProgressPhoto | null> {
  const items = await readIndex();
  const idx = items.findIndex((item) => item.id === localId);
  if (idx < 0) return null;
  items[idx] = {
    ...items[idx],
    backedUp: true,
    serverId: server.id,
    storagePath: server.storagePath,
  };
  await writeIndex(items);
  return items[idx];
}

export async function deleteLocalProgressPhoto(localId: string): Promise<void> {
  const items = await readIndex();
  const target = items.find((item) => item.id === localId);
  if (target) {
    await FileSystem.deleteAsync(target.localUri, { idempotent: true }).catch(() => undefined);
  }
  await writeIndex(items.filter((item) => item.id !== localId));
}

export async function readLocalProgressPhotoBase64(localUri: string): Promise<string> {
  return FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
}
