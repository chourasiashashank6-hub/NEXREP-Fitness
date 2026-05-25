import axios from "axios";
import { Platform } from "react-native";
import { signOutSession } from "../services/authService";
import { useAuthStore } from "../store/authStore";

const envApiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").trim();

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

/** Private IPv4 ranges (typical home Wi‑Fi), excluding loopback. */
function isPrivateLanIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Web: if the page is opened on localhost/127.0.0.1 OR on a LAN IP (192.168.x.x, 10.x.x.x, …) but
 * EXPO_PUBLIC_API_URL still points at loopback, rewrite the API host to the **page** hostname so the
 * browser hits your dev machine (127.0.0.1 from the phone would mean the phone itself → Network Error).
 * Otherwise use EXPO_PUBLIC_API_URL as-is (tunnels, public hosts, API already on LAN/ngrok).
 */
export function resolveApiBaseUrl(): string {
  if (!envApiUrl) {
    throw new Error("EXPO_PUBLIC_API_URL is not set. Copy mobile/.env.example to mobile/.env");
  }
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return envApiUrl;
  }

  const pageHost = window.location.hostname;
  const pageIsLoopback = isLoopbackHostname(pageHost);
  const pageIsPrivateLan = isPrivateLanIpv4(pageHost);

  try {
    const u = new URL(envApiUrl);
    const apiIsLoopback = isLoopbackHostname(u.hostname);
    const port = u.port || (u.protocol === "https:" ? "443" : "8000");

    if (apiIsLoopback && (pageIsLoopback || pageIsPrivateLan)) {
      const proto = pageIsLoopback ? u.protocol : window.location.protocol === "https:" ? "https:" : "http:";
      return `${proto}//${pageHost}:${port}`;
    }

    return envApiUrl;
  } catch {
    return `http://${pageHost}:8000`;
  }
}

/** Default for most API calls; AI coach routes override with COACH_API_TIMEOUT_MS. */
export const DEFAULT_API_TIMEOUT_MS = 20000;

/** Groq/Gemini coach insight can exceed the default when the server tries fallbacks. */
export const COACH_API_TIMEOUT_MS = 120000;

export const apiClient = axios.create({
  baseURL: envApiUrl,
  timeout: DEFAULT_API_TIMEOUT_MS,
});

function getRequestAuthorization(config: unknown): string | undefined {
  const c = config as { headers?: Record<string, string> & { get?: (k: string) => string | undefined } };
  const h = c?.headers;
  if (!h) return undefined;
  if (typeof h.get === "function") {
    return h.get("Authorization") ?? h.get("authorization");
  }
  return h.Authorization ?? h.authorization;
}

apiClient.interceptors.request.use((config) => {
  config.baseURL = resolveApiBaseUrl();
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    if (status !== 401 && status !== 403) {
      return Promise.reject(error);
    }
    const url = String(error?.config?.url ?? "");
    const isAuthRoute =
      url.includes("/login") ||
      url.includes("/signup") ||
      url.includes("/auth/firebase-login") ||
      url.includes("/auth/sync-password");
    const hadBearer = Boolean(getRequestAuthorization(error?.config));
    if (!isAuthRoute && hadBearer) {
      await signOutSession();
    }
    return Promise.reject(error);
  }
);
