import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { navigateFromNotificationData } from "./navigationRef";

export default function NotificationDeepLinkHandler() {
  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse | null | undefined) => {
      const data = response?.notification.request.content.data;
      navigateFromNotificationData(data);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    void Notifications.getLastNotificationResponseAsync()
      .then(handleResponse)
      .catch(() => undefined);

    return () => subscription.remove();
  }, []);

  return null;
}
