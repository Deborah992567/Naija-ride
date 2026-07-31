// Push notification setup — registers the device's Expo push token with the
// backend so route followers can get notified about new reports.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "./api";

export function isPushSupported(): boolean {
  return Platform.OS !== "web";
}

async function getPushToken(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const token = await getPushToken();
  if (!token) return null;
  try {
    await api.registerPushToken(token);
  } catch {
    // Non-fatal: the user can still use the app without push.
  }
  return token;
}
