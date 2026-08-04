// Notifications: in-app alert inbox (rides, safety, wallet, promos, referrals).
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type Notification } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

const CATEGORY_ICONS: Record<string, { icon: "car" | "shield" | "wallet" | "pricetag" | "gift" | "information-circle"; color: string }> = {
  ride: { icon: "car", color: colors.primary },
  safety: { icon: "shield", color: colors.delayed },
  wallet: { icon: "wallet", color: colors.secondaryDark },
  coupon: { icon: "pricetag", color: colors.primary },
  referral: { icon: "gift", color: colors.secondaryDark },
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotifications(await api.myNotifications());
    } catch {
      setNotifications([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const open = useCallback(async (n: Notification) => {
    if (!n.read) {
      setNotifications((prev) =>
        prev?.map((x) => (x.notification_id === n.notification_id ? { ...x, read: true } : x)) ?? prev,
      );
      await api.markNotificationRead(n.notification_id).catch(() => {});
    }
  }, []);

  const markAll = useCallback(async () => {
    await api.markAllNotificationsRead().catch(() => {});
    setNotifications((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null);
  }, []);

  const unread = useMemo(() => notifications?.filter((n) => !n.read).length ?? 0, [notifications]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="notifications-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={markAll} hitSlop={10} disabled={unread === 0} testID="notifications-mark-all" style={{ opacity: unread === 0 ? 0.4 : 1 }}>
          <Text style={styles.markAllText}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      {notifications === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-off-outline" size={40} color={colors.border} />
          <Text style={styles.emptyText}>No notifications yet.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.notification_id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => {
            const meta = CATEGORY_ICONS[item.category] ?? { icon: "information-circle", color: colors.primary };
            return (
              <TouchableOpacity
                onPress={() => open(item)}
                style={[styles.row, !item.read && styles.rowUnread]}
                activeOpacity={0.8}
                testID={`notification-${item.notification_id}`}
              >
                <View style={[styles.iconWrap, { backgroundColor: meta.color }]}>
                  <Ionicons name={meta.icon} size={17} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleRow}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text style={styles.rowTime}>{timeAgo(item.created_at)}</Text>
                  </View>
                  <Text style={styles.rowBody}>{item.body}</Text>
                </View>
                {!item.read ? <View style={styles.unreadDot} /> : null}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  headerTitle: { flex: 1, color: colors.textPrimary, fontSize: 18, fontWeight: "900" },
  markAllText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 60 },
  emptyText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 60, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 14,
  },
  rowUnread: { backgroundColor: colors.primaryLight, borderColor: "#C4E8D2" },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: "900" },
  rowTime: { color: colors.textSecondary, fontSize: 10, fontWeight: "700" },
  rowBody: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 3, lineHeight: 17 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 },
});
