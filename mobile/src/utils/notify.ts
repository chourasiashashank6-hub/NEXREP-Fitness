import { Alert, Platform } from "react-native";

/** Alert is unreliable on some Expo web builds; ensure the user always sees feedback. */
export function notifyUser(title: string, message: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
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
    return JSON.stringify(detail);
  }
  return "";
}
