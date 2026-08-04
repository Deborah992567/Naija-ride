import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/lib/auth";
import { colors } from "@/src/lib/theme";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isDriver = user?.role === "driver";
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle: {
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 8,
          backgroundColor: "#fff",
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          tabBarButtonTestID: "tab-map",
        }}
      />
      <Tabs.Screen
        name="ride"
        options={{
          title: "Ride",
          href: isDriver ? null : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="car" size={size} color={color} />,
          tabBarButtonTestID: "tab-ride",
        }}
      />
      <Tabs.Screen
        name="drive"
        options={{
          title: "Drive",
          href: isDriver ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="car-sport" size={size} color={color} />,
          tabBarButtonTestID: "tab-drive",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
          tabBarButtonTestID: "tab-profile",
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          href: user?.is_admin === 1 ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="shield" size={size} color={color} />,
          tabBarButtonTestID: "tab-admin",
        }}
      />
    </Tabs>
  );
}
