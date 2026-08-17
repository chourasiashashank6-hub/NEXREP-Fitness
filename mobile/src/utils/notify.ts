import axios from "axios";
import { Alert, Platform } from "react-native";

/** Alert is unreliable on some Expo web builds; ensure the user always sees feedback. */
export function notifyUser(title: string, message: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Confirmation dialogs — Alert.alert with buttons is a no-op on Expo web. */
export function confirmUser(title: string, message: string, confirmLabel = "OK"): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.confirm === "function") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

export function formatApiDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: string }).msg);
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (detail && typeof detail === "object") {
    if ("message" in detail && typeof (detail as { message: unknown }).message === "string") {
      return (detail as { message: string }).message;
    }
    return JSON.stringify(detail);
  }
  return "";
}

export function apiErrorMessage(error: unknown, fallback: string, notFoundMessage?: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const detailText = formatApiDetail(error.response?.data?.detail);
    if (status === 404) {
      if (notFoundMessage) return notFoundMessage;
      if (detailText && detailText !== "Not Found") return detailText;
    }
    if (detailText) return detailText;
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
