// Push notifications — requests permission, mints an Expo push token, and
// registers it with the backend so server-side notify() can deliver to this device.
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registering: Promise<string | null> | null = null;

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (registering) return registering;

  registering = (async () => {
    try {
      const current = await Notifications.getPermissionsAsync();
      let status = current.status;
      if (status !== "granted") {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }
      if (status !== "granted") return null;

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#008751",
        });
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      if (!tokenData?.data) return null;

      await api.registerPushToken(tokenData.data);
      return tokenData.data;
    } catch (error) {
      console.warn("Push registration failed:", error);
      return null;
    }
  })();

  return registering;
}
