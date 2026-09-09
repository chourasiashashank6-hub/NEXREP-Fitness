import axios from "axios";
import i18n from "../i18n";
import { useConnectivityStore } from "../store/connectivityStore";
import { devLog } from "./devLog";

export type UserFacingError = {
  title: string;
  body: string;
  canRetry: boolean;
  waking?: boolean;
};

export function isTimeoutError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    if (err.code === "ECONNABORTED") return true;
    if (!err.response && /timeout/i.test(String(err.message))) return true;
  }
  return false;
}

export function isNetworkError(err: unknown): boolean {
  if (axios.isAxiosError(err) && !err.response) return true;
  if (err instanceof Error && /network error|failed to fetch|err_network|load failed/i.test(err.message)) {
    return true;
  }
  return false;
}

/** Map any error to safe user-facing copy. Developer detail goes to console only. */
export function toUserMessage(err: unknown, fallbackKey = "offline.errors.generic"): UserFacingError {
  devLog("[toUserMessage]", err);

  const { isOnline } = useConnectivityStore.getState();

  if (!isOnline || (isNetworkError(err) && !isOnline)) {
    return {
      title: i18n.t("offline.errors.offlineTitle"),
      body: i18n.t("offline.errors.offlineBody"),
      canRetry: true,
    };
  }

  if (isTimeoutError(err) || (isNetworkError(err) && isOnline)) {
    return {
      title: i18n.t("offline.errors.wakingTitle"),
      body: i18n.t("offline.errors.wakingBody"),
      canRetry: false,
      waking: true,
    };
  }

  if (axios.isAxiosError(err) && err.response && err.response.status >= 500) {
    return {
      title: i18n.t("offline.errors.serverTitle"),
      body: i18n.t("offline.errors.serverBody"),
      canRetry: true,
    };
  }

  return {
    title: i18n.t("offline.errors.genericTitle"),
    body: i18n.t(fallbackKey),
    canRetry: true,
  };
}
