import { resolveApiBaseUrl } from "./client";
import { useAdminStore } from "../store/adminStore";

function adminBase(): string {
  return `${resolveApiBaseUrl()}/api/admin`;
}

function parseAdminError(status: number, body: string): string {
  if (!body) {
    return status === 401 ? "Session expired. Please sign in again." : `${status} request failed`;
  }
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === "string") {
      if (status === 401 && parsed.detail.toLowerCase().includes("invalid admin token")) {
        return "Session expired. Please sign in again.";
      }
      return parsed.detail;
    }
    if (Array.isArray(parsed.detail)) {
      return parsed.detail.map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg: string }).msg) : String(d))).join("\n");
    }
  } catch {
    /* not JSON */
  }
  return body;
}

async function adminFetch(path: string, options: RequestInit = {}) {
  const token = useAdminStore.getState().token;
  const res = await fetch(`${adminBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const isLoginAttempt = path === "/auth/login";
    if (res.status === 401 && token && !isLoginAttempt) {
      useAdminStore.getState().logout();
    }
    throw new Error(parseAdminError(res.status, text));
  }
  return res.json();
}

function toQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const adminApi = {
  login: (email: string, password: string) =>
    adminFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  me: () => adminFetch("/auth/me"),

  overview: () => adminFetch("/overview"),

  userGrowth: (days = 30) => adminFetch(`/users/growth?days=${days}`),

  subscriptionSummary: () => adminFetch("/subscriptions/summary"),

  subscriptionHistory: (params?: { plan_id?: string; status?: string; limit?: number; offset?: number }) =>
    adminFetch(`/subscriptions/history${toQuery(params)}`),

  revenueMonthly: (months = 12) => adminFetch(`/revenue/monthly?months=${months}`),

  aiSummary: (days = 30) => adminFetch(`/ai/summary?days=${days}`),

  aiDaily: (days = 30) => adminFetch(`/ai/daily?days=${days}`),

  aiTopUsers: (days = 30, limit = 20) => adminFetch(`/ai/top-users?days=${days}&limit=${limit}`),

  aiUserHistory: (userId: number, days = 30) => adminFetch(`/ai/user/${userId}?days=${days}`),

  listUsers: (params?: { search?: string; plan_id?: string; limit?: number; offset?: number }) =>
    adminFetch(`/users${toQuery(params)}`),

  userDetail: (userId: number) => adminFetch(`/users/${userId}/detail`),

  costAlerts: (thresholdInr = 500, days = 7) =>
    adminFetch(`/ai/cost-alerts?threshold_inr=${thresholdInr}&days=${days}`),
};
