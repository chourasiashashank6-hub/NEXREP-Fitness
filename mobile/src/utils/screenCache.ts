import AsyncStorage from "@react-native-async-storage/async-storage";

type CacheEnvelope<T> = {
  savedAt: number;
  data: T;
};

export async function readScreenCache<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== "number" || parsed.data == null) return null;
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export async function writeScreenCache<T>(key: string, data: T): Promise<void> {
  const envelope: CacheEnvelope<T> = { savedAt: Date.now(), data };
  await AsyncStorage.setItem(key, JSON.stringify(envelope));
}
