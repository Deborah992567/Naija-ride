import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/lib/auth";

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
      router.replace("/(tabs)");
    }
  }, [user, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="route/[id]" options={{ presentation: "card", animation: "slide_from_right" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

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
