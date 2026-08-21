/** Session-scoped in-memory cache — cleared on log events via activityDataRefreshStore. */

export const SESSION_DATA_STALE_MS = 45_000;

type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function getSessionCache<T>(key: string, maxAgeMs = SESSION_DATA_STALE_MS): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > maxAgeMs) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setSessionCache<T>(key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

export function invalidateSessionCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
