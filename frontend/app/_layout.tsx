import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, roleHome, useAuth } from "@/src/lib/auth";
import { loadMapLibre } from "@/src/lib/maplibre";

SplashScreen.preventAutoHideAsync();

function NavGuard() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "onboarding";
    if (!user && !inAuth && !inOnboarding) {
      router.replace("/onboarding");
    } else if (user && (inAuth || inOnboarding)) {
      router.replace(roleHome(user));
    }
  }, [user, loading, segments, router]);

  // Deep-link from a tapped push notification to the relevant screen.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const dest =
        data.delivery_id != null
          ? "/delivery"
          : data.booking_id != null
            ? "/moving"
            : data.ride_id != null || data.trip_id != null
              ? roleHome(user)
              : data.verification_status != null
                ? "/verify-driver"
                : roleHome(user);
      if (dest) router.push(dest);
    });
    return () => sub.remove();
  }, [user, router]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  useEffect(() => {
    loadMapLibre().catch(() => {});
  }, []);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <NavGuard />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
