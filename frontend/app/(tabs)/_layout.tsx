import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/src/lib/theme";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
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
          title: "Map",
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
          tabBarButtonTestID: "tab-map",
        }}
      />
      <Tabs.Screen
        name="routes"
        options={{
          title: "Routes",
          tabBarIcon: ({ color, size }) => <Ionicons name="git-branch" size={size} color={color} />,
          tabBarButtonTestID: "tab-routes",
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: "Report",
          tabBarIcon: ({ color, size }) => <Ionicons name="megaphone" size={size} color={color} />,
          tabBarButtonTestID: "tab-report",
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
    </Tabs>
  );
}
