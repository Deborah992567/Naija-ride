// Home dashboard: quick actions into the platform services.
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

type Service = { key: string; title: string; subtitle: string; icon: "car" | "car-sport" | "cube" | "home"; route: string; primary: boolean };

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const firstName = user?.name?.split(" ")[0] || "there";
  const isDriver = user?.role === "driver" && user?.is_admin !== 1;
  const isAdmin = user?.is_admin === 1 || user?.role === "admin";

  const SERVICES: Service[] = isDriver
    ? [
        { key: "drive", title: "Drive", subtitle: "Turn on, get jobs, earn", icon: "car-sport" as const, route: "/(tabs)/drive", primary: true },
        { key: "ride", title: "Ride as passenger", subtitle: "Switch over and hail a ride", icon: "car" as const, route: "/(tabs)/ride", primary: false },
        { key: "delivery", title: "Delivery", subtitle: "Send parcels door-to-door", icon: "cube" as const, route: "/delivery", primary: false },
        { key: "moving", title: "Moving", subtitle: "Home & office moves", icon: "home" as const, route: "/moving", primary: false },
      ]
    : [
        { key: "ride", title: "Ride", subtitle: "Hail a ride in seconds", icon: "car" as const, route: "/(tabs)/ride", primary: true },
        { key: "drive", title: "Become a driver", subtitle: "Turn on and earn", icon: "car-sport" as const, route: "/(tabs)/drive", primary: false },
        { key: "delivery", title: "Delivery", subtitle: "Send parcels door-to-door", icon: "cube" as const, route: "/delivery", primary: false },
        { key: "moving", title: "Moving", subtitle: "Home & office moves", icon: "home" as const, route: "/moving", primary: false },
      ];

  useFocusEffect(
    useCallback(() => {
      api.unreadCount().then((r) => setUnread(r.count)).catch(() => setUnread(0));
    }, []),
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Text style={styles.eyebrow}>Naija Ride</Text>
          <TouchableOpacity onPress={() => router.push("/notifications")} hitSlop={10} testID="home-notifications">
            <View style={styles.bellWrap}>
              <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
              {unread > 0 ? (
                <View style={styles.bellBadge} testID="home-notifications-badge">
                  <Text style={styles.bellBadgeText}>{unread > 99 ? "99+" : unread}</Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>Hello, {firstName} 👋</Text>
        <Text style={styles.subtitle}>Where would you like to go today?</Text>

        {isDriver || isAdmin ? (
          <TouchableOpacity
            style={styles.roleBanner}
            onPress={() => router.push(isAdmin ? "/(tabs)/admin" : "/(tabs)/drive")}
            testID="home-role-banner"
          >
            <View style={styles.roleIcon}>
              <Ionicons name={isAdmin ? "shield-checkmark" : "car-sport"} size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roleTitle}>{isAdmin ? "Admin console" : "Driver dashboard"}</Text>
              <Text style={styles.roleSubtitle}>
                {isAdmin ? "Review drivers, payouts, orders and tickets" : "Your jobs, earnings and documents — tap to open"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.grid}>
          {SERVICES.map((service) => (
            <TouchableOpacity
              key={service.key}
              style={[styles.card, service.primary && styles.cardPrimary]}
              onPress={() => router.push(service.route as never)}
              activeOpacity={0.85}
              testID={`home-${service.key}`}
            >
              <View style={[styles.iconWrap, service.primary && styles.iconWrapPrimary]}>
                <Ionicons name={service.icon} size={26} color={service.primary ? "#fff" : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, service.primary && styles.cardTitlePrimary]}>{service.title}</Text>
                <Text style={styles.cardSubtitle}>{service.subtitle}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={service.primary ? "#fff" : colors.textSecondary}
              />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.soonCard}>
          <Ionicons name="wallet" size={20} color={colors.secondary} />
          <Text style={styles.soonText}>
            Track orders, pay with your wallet, and get support — all in one place.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2 },
  bellWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  bellBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.delayed,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  bellBadgeText: { color: "#fff", fontSize: 9, fontWeight: "900" },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: "900", marginTop: 6 },
  subtitle: { color: colors.textSecondary, fontSize: 14, fontWeight: "600", marginTop: 4 },
  roleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.lg,
    backgroundColor: colors.primaryDark,
    borderRadius: radii.lg,
    padding: 14,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  roleTitle: { color: "#fff", fontSize: 14, fontWeight: "900" },
  roleSubtitle: { color: "#D1FAE5", fontSize: 11, fontWeight: "600", marginTop: 2, lineHeight: 15 },
  grid: { gap: spacing.md, marginTop: spacing.xl },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  cardPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryLight,
  },
  iconWrapPrimary: { backgroundColor: "rgba(255,255,255,0.18)" },
  cardTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "900" },
  cardTitlePrimary: { color: "#fff" },
  cardSubtitle: { color: colors.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 2 },
  soonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: "#FFF8E1",
    borderWidth: 1,
    borderColor: "#FCE588",
  },
  soonText: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: "700", lineHeight: 18 },
});
