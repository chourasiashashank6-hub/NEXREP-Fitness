/**
 * Fetches admin-uploaded body type photos from backend.
 * Falls back to SVG illustrations when no photo is set.
 * Caches in AsyncStorage for 30 min.
 */
import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resolveApiBaseUrl } from "../api/client";

const CACHE_KEY = "bodyTypeImages_v1";
const CACHE_TTL = 1000 * 60 * 30;

export type ImageMap = Record<string, string | null>;
interface CacheEntry {
  data: ImageMap;
  ts: number;
}

function resolveImageUrls(data: ImageMap): ImageMap {
  const base = resolveApiBaseUrl().replace(/\/$/, "");
  const out: ImageMap = {};
  for (const [key, path] of Object.entries(data)) {
    out[key] = path ? `${base}${path}` : null;
  }
  return out;
}

export function useBodyTypeImages() {
  const [images, setImages] = useState<ImageMap>({});
  const [loading, setLoading] = useState(true);

  const fetchImages = useCallback(async (force = false) => {
    try {
      if (!force) {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const entry: CacheEntry = JSON.parse(raw);
          if (Date.now() - entry.ts < CACHE_TTL) {
            setImages(entry.data);
            setLoading(false);
            return;
          }
        }
      }
      const res = await fetch(`${resolveApiBaseUrl()}/body-type-images`);
      if (!res.ok) throw new Error("fetch failed");
      const data: ImageMap = await res.json();
      const resolved = resolveImageUrls(data);
      setImages(resolved);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data: resolved, ts: Date.now() }));
    } catch (e) {
      console.warn("Body type images unavailable, using SVG fallbacks:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const refresh = () => fetchImages(true);
  const getImage = (key: string): string | null => images[key] ?? null;

  return { getImage, loading, refresh };
}
