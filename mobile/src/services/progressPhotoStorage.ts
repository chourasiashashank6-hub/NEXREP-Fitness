import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { resolveApiBaseUrl } from "../api/client";
import {
  listBackedUpProgressPhotos,
  uploadProgressPhotoBackup,
  type BackedUpProgressPhoto,
} from "../api/progressPhotos";

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

export type ProgressPhotoListEntry = LocalProgressPhoto & {
  displayUri: string;
  source: "local" | "remote" | "both";
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

function remotePhotoUri(storagePath: string): string {
  const base = resolveApiBaseUrl().replace(/\/$/, "");
  return `${base}${storagePath}`;
}

function remoteToListEntry(remote: BackedUpProgressPhoto): ProgressPhotoListEntry {
  const uri = remotePhotoUri(remote.storage_path);
  return {
    id: `remote_${remote.id}`,
    localUri: uri,
    displayUri: uri,
    takenAt: remote.taken_at,
    angle: remote.angle,
    backedUp: true,
    serverId: remote.id,
    storagePath: remote.storage_path,
    source: "remote",
  };
}

/** Upload any local photos not yet backed up to the server. */
export async function syncUnbackedProgressPhotosToServer(): Promise<void> {
  const items = await listLocalProgressPhotos();
  for (const item of items) {
    if (item.backedUp) continue;
    try {
      const base64 = await readLocalProgressPhotoBase64(item.localUri);
      const remote = await uploadProgressPhotoBackup({
        base64,
        takenAt: item.takenAt,
        angle: item.angle,
      });
      await markLocalProgressPhotoBackedUp(item.id, {
        id: remote.id,
        storagePath: remote.storage_path,
      });
    } catch {
      // Offline or upload failed — keep local copy only.
    }
  }
}

/** Local cache merged with server backups (server is authoritative for cloud-only rows). */
export async function listMergedProgressPhotos(): Promise<ProgressPhotoListEntry[]> {
  await syncUnbackedProgressPhotosToServer().catch(() => undefined);

  const locals = await listLocalProgressPhotos();
  let remotes: BackedUpProgressPhoto[] = [];
  try {
    remotes = await listBackedUpProgressPhotos();
  } catch {
    // Offline — show local cache only.
  }

  const localByServerId = new Map(
    locals.filter((item) => item.serverId != null).map((item) => [item.serverId as number, item]),
  );
  const merged: ProgressPhotoListEntry[] = locals.map((item) => ({
    ...item,
    displayUri: item.localUri,
    source: item.backedUp ? "both" : "local",
  }));

  for (const remote of remotes) {
    if (localByServerId.has(remote.id)) continue;
    merged.push(remoteToListEntry(remote));
  }

  return merged.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}
