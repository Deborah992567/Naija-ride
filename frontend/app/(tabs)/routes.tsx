// Routes list — searchable, filterable by vehicle type, with follow pins.
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, TextInput, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import FilterChips from "@/src/components/FilterChips";
import { api, type Route } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { loadFollowsFromServer, toggleFollow } from "@/src/lib/favorites";
import { colors, radii, spacing, vehicleMeta } from "@/src/lib/theme";

const FILTERS = [
  { key: "all", label: "All Cities", icon: "globe" as const },
  { key: "Lagos", label: "Lagos" },
  { key: "Abuja", label: "Abuja" },
  { key: "Port Harcourt", label: "Port Harcourt" },
  { key: "Campus", label: "Campus" },
];

export default function RoutesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [cityFilter, setCityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, ids] = await Promise.all([api.listRoutes(), loadFollowsFromServer()]);
      setRoutes(r);
      setFollowing(ids);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = routes;
    if (cityFilter !== "all") list = list.filter((r) => r.city === cityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) => r.name.toLowerCase().includes(q) || r.stops.some((s) => s.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [routes, cityFilter, search]);

  async function onToggleFollow(routeId: string) {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    setFollowing((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
    await toggleFollow(routeId);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Routes</Text>
        <Text style={styles.subtitle}>{routes.length} routes across Nigeria & campuses</Text>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search routes or stops"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
            testID="routes-search-input"
          />
        </View>
      </View>

      <FilterChips items={FILTERS} value={cityFilter} onChange={setCityFilter} testIDPrefix="routes-filter" />

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.route_id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="bus" size={48} color={colors.border} />
              <Text style={styles.emptyTitle}>No routes found</Text>
              <Text style={styles.emptyText}>Try a different city or search term.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RouteCard
              route={item}
              followed={following.has(item.route_id)}
              onPress={() => router.push(`/route/${item.route_id}`)}
              onToggleFollow={() => onToggleFollow(item.route_id)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function RouteCard({ route, followed, onPress, onToggleFollow }: { route: Route; followed: boolean; onPress: () => void; onToggleFollow: () => void }) {
  const meta = vehicleMeta[route.vehicle_type] || vehicleMeta.bus;
  const origin = route.stops[0]?.name || "—";
  const dest = route.stops[route.stops.length - 1]?.name || "—";
  return (
    <View style={styles.card} testID={`route-card-${route.route_id}`}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <View style={styles.cardHeader}>
          <View style={[styles.badge, { backgroundColor: meta.color }]}>
            <Ionicons name={meta.icon} size={14} color={route.vehicle_type === "danfo" ? "#1A1A1A" : "#fff"} />
            <Text style={[styles.badgeText, { color: route.vehicle_type === "danfo" ? "#1A1A1A" : "#fff" }]}>{meta.label}</Text>
          </View>
          <View style={styles.cityChip}>
            <Ionicons name="location" size={12} color={colors.textSecondary} />
            <Text style={styles.cityText}>{route.city}</Text>
          </View>
          {route.fare != null && <Text style={styles.fare}>₦{route.fare}</Text>}
        </View>
        <Text style={styles.routeName} numberOfLines={1}>{route.name}</Text>
        <View style={styles.timeline}>
          <View style={styles.dotGreen} />
          <Text style={styles.stopText} numberOfLines={1}>{origin}</Text>
        </View>
        <View style={styles.timelineLine} />
        <View style={styles.timeline}>
          <View style={styles.dotYellow} />
          <Text style={styles.stopText} numberOfLines={1}>{dest}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>{route.stops.length} stops</Text>
        <View style={styles.footerActions}>
          <TouchableOpacity
            onPress={onToggleFollow}
            style={[styles.pinBtn, followed && styles.pinBtnActive]}
            testID={`route-pin-${route.route_id}`}
          >
            <Ionicons
              name={followed ? "notifications" : "notifications-outline"}
              size={15}
              color={followed ? "#fff" : colors.textPrimary}
            />
            <Text style={[styles.pinText, followed && styles.pinTextActive]}>{followed ? "Following" : "Follow"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onPress} style={styles.viewBtn} testID={`route-view-${route.route_id}`}>
            <Text style={styles.viewBtnText}>View ETAs</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 6 },
  title: { fontSize: 30, fontWeight: "900", color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    height: 48,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, paddingVertical: 0 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 100 },
  empty: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: colors.textPrimary, marginTop: 8 },
  emptyText: { fontSize: 13, color: colors.textSecondary },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  cityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.input,
  },
  cityText: { fontSize: 11, color: colors.textSecondary, fontWeight: "700" },
  fare: { marginLeft: "auto", fontSize: 14, fontWeight: "900", color: colors.primary },
  routeName: { fontSize: 18, fontWeight: "800", color: colors.textPrimary, marginBottom: 12 },
  timeline: { flexDirection: "row", alignItems: "center", gap: 10 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  dotYellow: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.secondaryDark },
  stopText: { flex: 1, fontSize: 14, color: colors.textPrimary, fontWeight: "600" },
  timelineLine: { width: 2, height: 14, backgroundColor: colors.border, marginLeft: 4, marginVertical: 2 },
  cardFooter: { flexDirection: "row", alignItems: "center", marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  footerText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  footerActions: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 10 },
  pinBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.input },
  pinBtnActive: { backgroundColor: colors.primary },
  pinText: { color: colors.textPrimary, fontSize: 12, fontWeight: "800" },
  pinTextActive: { color: "#fff" },
  viewBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  viewBtnText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
});
