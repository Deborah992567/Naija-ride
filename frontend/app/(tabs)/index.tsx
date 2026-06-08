// Map screen: sticky header with search + filter chips, live map fills the rest, FAB to report.
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import LiveMap from "@/src/components/LiveMap";
import FilterChips from "@/src/components/FilterChips";
import CrowdBars from "@/src/components/CrowdBars";
import { api, type Report, type Route } from "@/src/lib/api";
import { colors, radii, spacing, vehicleMeta } from "@/src/lib/theme";
import { formatRelative } from "@/src/lib/time";

const FILTERS = [
  { key: "all", label: "All", icon: "apps" as const },
  { key: "bus", label: "Bus", icon: "bus" as const },
  { key: "danfo", label: "Danfo", icon: "bus-outline" as const },
  { key: "keke", label: "Keke", icon: "bicycle" as const },
  { key: "shuttle", label: "Shuttle", icon: "school" as const },
];

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Report | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([
        api.listRoutes(),
        api.liveVehicles(filter === "all" ? undefined : filter, 60),
      ]);
      setRoutes(r);
      setVehicles(v);
    } catch (e) {
      console.warn("refresh failed", e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Initial region — center of seeded routes (Lagos)
  const region = useMemo(() => {
    if (routes.length && routes[0].stops.length) {
      const stops = routes.flatMap((r) => r.stops);
      const lat = stops.reduce((a, s) => a + s.lat, 0) / stops.length;
      const lng = stops.reduce((a, s) => a + s.lng, 0) / stops.length;
      return { latitude: lat, longitude: lng, latitudeDelta: 0.15, longitudeDelta: 0.15 };
    }
    return { latitude: 6.5244, longitude: 3.3792, latitudeDelta: 0.15, longitudeDelta: 0.15 };
  }, [routes]);

  const filteredRoutes = useMemo(() => {
    const list = filter === "all" ? routes : routes.filter((r) => r.vehicle_type === filter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.stops.some((s) => s.name.toLowerCase().includes(q)),
    );
  }, [routes, filter, search]);

  const filteredVehicles = useMemo(
    () => (filter === "all" ? vehicles : vehicles.filter((v) => v.vehicle_type === filter)),
    [vehicles, filter],
  );

  return (
    <View style={styles.root}>
      <LiveMap
        region={region}
        vehicles={filteredVehicles}
        routes={filteredRoutes}
        onMarkerPress={(v) => setSelected(v)}
      />

      {/* Sticky header overlay */}
      <SafeAreaView edges={["top"]} style={styles.headerWrap} pointerEvents="box-none">
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search routes or stops"
              placeholderTextColor={colors.textSecondary}
              style={styles.searchInput}
              testID="map-search-input"
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch("")} testID="map-search-clear">
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <FilterChips items={FILTERS} value={filter} onChange={setFilter} testIDPrefix="map-filter" />
      </SafeAreaView>

      {/* Live counter pill */}
      <View style={[styles.livePill, { top: insets.top + 130 }]} pointerEvents="none">
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <View style={styles.pulse} />
            <Text style={styles.liveText} testID="live-vehicles-count">
              {filteredVehicles.length} live • last 60min
            </Text>
          </>
        )}
      </View>

      {/* Selected vehicle bottom sheet */}
      {selected ? (
        <VehicleSheet report={selected} onClose={() => setSelected(null)} onSeeRoute={() => {
          setSelected(null);
          router.push(`/route/${selected.route_id}`);
        }} />
      ) : (
        <View style={[styles.scrollHint, { bottom: insets.bottom + 88 }]} pointerEvents="none">
          <Ionicons name="information-circle" size={14} color={colors.textPrimary} />
          <Text style={styles.scrollHintText}>Tap a vehicle marker for details & ETA</Text>
        </View>
      )}

      {/* Report FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 88 }]}
        onPress={() => router.push("/(tabs)/report")}
        testID="report-fab-button"
        activeOpacity={0.9}
      >
        <Ionicons name="megaphone" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

function VehicleSheet({ report, onClose, onSeeRoute }: { report: Report; onClose: () => void; onSeeRoute: () => void }) {
  const insets = useSafeAreaInsets();
  const meta = vehicleMeta[report.vehicle_type] || vehicleMeta.bus;
  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.handle} />
      <View style={styles.sheetHeader}>
        <View style={[styles.sheetIcon, { backgroundColor: meta.color }]}>
          <Ionicons name={meta.icon} size={22} color={report.vehicle_type === "danfo" ? "#1A1A1A" : "#fff"} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetTitle}>{meta.label} sighted</Text>
          <Text style={styles.sheetSub}>by {report.user_name || "Anonymous"} · {formatRelative(report.created_at)}</Text>
        </View>
        <TouchableOpacity onPress={onClose} testID="vehicle-sheet-close" style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      <View style={styles.sheetGrid}>
        {report.crowd_level && (
          <View style={styles.sheetCell}>
            <CrowdBars level={report.crowd_level} />
            <Text style={styles.sheetCellLabel}>{report.crowd_level}</Text>
          </View>
        )}
        {report.delay_minutes != null && (
          <View style={styles.sheetCell}>
            <Text style={[styles.sheetCellValue, { color: colors.delayed }]}>+{report.delay_minutes}m</Text>
            <Text style={styles.sheetCellLabel}>delay</Text>
          </View>
        )}
        {report.fare != null && (
          <View style={styles.sheetCell}>
            <Text style={styles.sheetCellValue}>₦{report.fare}</Text>
            <Text style={styles.sheetCellLabel}>fare</Text>
          </View>
        )}
      </View>
      {report.note ? <Text style={styles.note}>“{report.note}”</Text> : null}
      <TouchableOpacity style={styles.viewRouteBtn} onPress={onSeeRoute} testID="vehicle-sheet-route">
        <Text style={styles.viewRouteText}>View route & ETA</Text>
        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.input,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    height: 48,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, paddingVertical: 0 },
  livePill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  liveText: { color: colors.textPrimary, fontSize: 12, fontWeight: "700" },
  scrollHint: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scrollHintText: { color: colors.textPrimary, fontSize: 12, fontWeight: "600" },
  fab: {
    position: "absolute",
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 60,
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  handle: { width: 44, height: 5, borderRadius: 2.5, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: colors.textPrimary },
  sheetSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  sheetGrid: { flexDirection: "row", gap: 12, marginTop: 16 },
  sheetCell: {
    flex: 1,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: 12,
    alignItems: "center",
    gap: 6,
  },
  sheetCellValue: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  sheetCellLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "700", textTransform: "capitalize" },
  note: { color: colors.textPrimary, fontStyle: "italic", marginTop: 14, fontSize: 14 },
  viewRouteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: radii.pill,
    marginTop: 16,
  },
  viewRouteText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
