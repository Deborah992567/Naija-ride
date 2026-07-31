// Map screen: sticky header with search + filter chips, live map fills the rest, FAB to report.
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import LiveMap from "@/src/components/LiveMap";
import FilterChips from "@/src/components/FilterChips";
import CrowdBars from "@/src/components/CrowdBars";
import CitySwitcher from "@/src/components/CitySwitcher";
import { api, type Report, type Route } from "@/src/lib/api";
import { colors, radii, spacing, vehicleMeta } from "@/src/lib/theme";
import { formatRelative } from "@/src/lib/time";
import { formatWalkingDistance, getWalkingRoute, type GeoPoint, type WalkingRoute } from "@/src/lib/walking";
import { CAMPUS_DESTINATIONS, type CampusDestination } from "@/src/lib/destinations";

const FILTERS = [
  { key: "all", label: "All", icon: "apps" as const },
  { key: "bus", label: "Bus", icon: "bus" as const },
  { key: "danfo", label: "Danfo", icon: "bus-outline" as const },
  { key: "keke", label: "Keke", icon: "bicycle" as const },
  { key: "shuttle", label: "Shuttle", icon: "school" as const },
];

type Journey = {
  destination: CampusDestination;
  route: Route;
  pickup: Route["stops"][number];
  dropoff: Route["stops"][number];
  toPickup: WalkingRoute;
  fromDropoff: WalkingRoute;
  rideMinutes: number | null;
};

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState("all");
  const [city, setCity] = useState("all");
  const [search, setSearch] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Report | null>(null);
  const [walkingRoute, setWalkingRoute] = useState<WalkingRoute | null>(null);
  const [walkingTo, setWalkingTo] = useState<string | null>(null);
  const [walkingLoading, setWalkingLoading] = useState(false);
  const [walkingError, setWalkingError] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerQuery, setPlannerQuery] = useState("");
  const [journey, setJourney] = useState<Journey | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  const [arrivalTime, setArrivalTime] = useState("08:00");

  const refresh = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([
        api.listRoutes(city === "all" ? undefined : { city }),
        api.liveVehicles(filter === "all" ? undefined : filter, 60),
      ]);
      setRoutes(r);
      setVehicles(v);
    } catch (e) {
      console.warn("refresh failed", e);
    } finally {
      setLoading(false);
    }
  }, [filter, city]);

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
    let list = routes;
    if (city !== "all") list = list.filter((r) => r.city === city);
    if (filter !== "all") list = list.filter((r) => r.vehicle_type === filter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.stops.some((s) => s.name.toLowerCase().includes(q)),
    );
  }, [routes, city, filter, search]);

  const filteredVehicles = useMemo(
    () => (filter === "all" ? vehicles : vehicles.filter((v) => v.vehicle_type === filter)),
    [vehicles, filter],
  );

  async function walkToNearestStop() {
    const stops = filteredRoutes.flatMap((route) => route.stops);
    if (!stops.length) return;
    setWalkingLoading(true);
    setWalkingError(null);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Allow location to get walking directions.");
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const from: GeoPoint = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      const closest = stops.reduce((best, stop) => {
        const bestDistance = Math.hypot(best.lat - from.latitude, best.lng - from.longitude);
        const distance = Math.hypot(stop.lat - from.latitude, stop.lng - from.longitude);
        return distance < bestDistance ? stop : best;
      });
      const route = await getWalkingRoute(from, { latitude: closest.lat, longitude: closest.lng });
      setWalkingRoute(route);
      setWalkingTo(closest.name);
    } catch (error) {
      setWalkingRoute(null);
      setWalkingTo(null);
      setWalkingError(error instanceof Error ? error.message : "Could not get walking directions.");
    } finally {
      setWalkingLoading(false);
    }
  }

  async function planJourney(destination: CampusDestination) {
    const campusRoutes = routes.filter((route) => route.city === "Campus" && route.stops.length >= 2);
    const availableRoutes = campusRoutes.length ? campusRoutes : routes.filter((route) => route.stops.length >= 2);
    if (!availableRoutes.length) {
      setJourneyError("No shuttle route is available yet.");
      return;
    }
    setJourneyLoading(true);
    setJourneyError(null);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Allow location to plan your journey.");
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const from: GeoPoint = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      const closestStop = (stops: Route["stops"], point: GeoPoint) =>
        stops.reduce((best, stop) =>
          Math.hypot(stop.lat - point.latitude, stop.lng - point.longitude) < Math.hypot(best.lat - point.latitude, best.lng - point.longitude)
            ? stop
            : best,
        );
      const route = availableRoutes.reduce((best, candidate) => {
        const candidateDropoff = closestStop(candidate.stops, destination);
        const bestDropoff = closestStop(best.stops, destination);
        return Math.hypot(candidateDropoff.lat - destination.latitude, candidateDropoff.lng - destination.longitude) < Math.hypot(bestDropoff.lat - destination.latitude, bestDropoff.lng - destination.longitude)
          ? candidate
          : best;
      });
      const pickup = closestStop(route.stops, from);
      const dropoff = closestStop(route.stops, destination);
      const [toPickup, fromDropoff, eta] = await Promise.all([
        getWalkingRoute(from, { latitude: pickup.lat, longitude: pickup.lng }),
        getWalkingRoute({ latitude: dropoff.lat, longitude: dropoff.lng }, destination),
        api.eta(route.route_id, route.stops.indexOf(dropoff)).catch(() => null),
      ]);
      setJourney({ destination, route, pickup, dropoff, toPickup, fromDropoff, rideMinutes: eta?.eta_minutes ?? null });
      setWalkingRoute(null);
      setWalkingTo(null);
      setPlannerOpen(false);
    } catch (error) {
      setJourneyError(error instanceof Error ? error.message : "Could not plan this journey.");
    } finally {
      setJourneyLoading(false);
    }
  }

  const plannerDestinations = CAMPUS_DESTINATIONS.filter((destination) =>
    `${destination.name} ${destination.area}`.toLowerCase().includes(plannerQuery.toLowerCase()),
  );

  return (
    <View style={styles.root}>
      <LiveMap
        region={region}
        vehicles={filteredVehicles}
        routes={filteredRoutes}
        walkingRoute={walkingRoute?.coordinates}
        walkingRoutes={journey ? [journey.toPickup.coordinates, journey.fromDropoff.coordinates] : undefined}
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
        <CitySwitcher value={city} onChange={setCity} />
        <FilterChips items={FILTERS} value={filter} onChange={setFilter} testIDPrefix="map-filter" />
      </SafeAreaView>

      {/* Live counter pill */}
      <View style={[styles.livePill, { top: insets.top + 156 }]} pointerEvents="none">
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

      <View style={[styles.walkWrap, { top: insets.top + 204 }]}>
        {walkingRoute && walkingTo ? (
          <TouchableOpacity style={styles.walkResult} onPress={() => { setWalkingRoute(null); setWalkingTo(null); }} testID="walking-route-clear">
            <Ionicons name="walk" size={18} color="#2563EB" />
            <Text style={styles.walkResultText}>Walk {formatWalkingDistance(walkingRoute.distanceMeters)} · {Math.max(1, Math.round(walkingRoute.durationSeconds / 60))} min to {walkingTo}</Text>
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.walkButton} onPress={walkToNearestStop} disabled={walkingLoading} testID="walking-route-button">
            {walkingLoading ? <ActivityIndicator size="small" color="#2563EB" /> : <Ionicons name="walk" size={18} color="#2563EB" />}
            <Text style={styles.walkButtonText}>{walkingLoading ? "Finding walking route…" : "Walk to nearest stop"}</Text>
          </TouchableOpacity>
        )}
        {walkingError ? <Text style={styles.walkError}>{walkingError}</Text> : null}
      </View>

      <View style={[styles.planWrap, { bottom: insets.bottom + 94 }]}>
        {journey ? (
          <TouchableOpacity style={styles.journeyCard} onPress={() => setPlannerOpen(true)} testID="journey-summary-button">
            <View style={styles.journeyIcon}><Ionicons name="navigate" size={18} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.journeyTitle}>To {journey.destination.name}</Text>
              <Text style={styles.journeySub}>Walk → {journey.route.name.replace("UNILAG Campus ", "")} → walk · ₦{journey.route.fare ?? "—"}</Text>
            </View>
            <Ionicons name="chevron-up" size={18} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.planButton} onPress={() => { setJourneyError(null); setPlannerOpen(true); }} testID="journey-planner-button">
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={styles.planButtonText}>Plan a journey</Text>
          </TouchableOpacity>
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
        style={[styles.fab, { bottom: insets.bottom + 164 }]}
        onPress={() => router.push("/(tabs)/report")}
        testID="report-fab-button"
        activeOpacity={0.9}
      >
        <Ionicons name="megaphone" size={24} color="#fff" />
      </TouchableOpacity>

      <JourneyPlanner
        visible={plannerOpen}
        destinations={plannerDestinations}
        query={plannerQuery}
        onQueryChange={setPlannerQuery}
        onClose={() => setPlannerOpen(false)}
        onSelect={planJourney}
        loading={journeyLoading}
        error={journeyError}
        journey={journey}
        onClearJourney={() => { setJourney(null); setPlannerOpen(false); }}
        arrivalTime={arrivalTime}
        onArrivalTimeChange={setArrivalTime}
      />
    </View>
  );
}

function JourneyPlanner({ visible, destinations, query, onQueryChange, onClose, onSelect, loading, error, journey, onClearJourney, arrivalTime, onArrivalTimeChange }: { visible: boolean; destinations: CampusDestination[]; query: string; onQueryChange: (value: string) => void; onClose: () => void; onSelect: (destination: CampusDestination) => void; loading: boolean; error: string | null; journey: Journey | null; onClearJourney: () => void; arrivalTime: string; onArrivalTimeChange: (time: string) => void }) {
  const totalWalkMinutes = journey ? Math.max(1, Math.round((journey.toPickup.durationSeconds + journey.fromDropoff.durationSeconds) / 60)) : 0;
  const rideMinutes = journey ? journey.rideMinutes ?? Math.max(3, Math.abs(journey.route.stops.indexOf(journey.dropoff) - journey.route.stops.indexOf(journey.pickup)) * 3) : 0;
  const leaveBy = journey ? getLeaveBy(arrivalTime, totalWalkMinutes + rideMinutes + 5) : null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.plannerSheet}>
          <View style={styles.handle} />
          <View style={styles.plannerHeader}>
            <View><Text style={styles.plannerTitle}>{journey ? "Your journey" : "Where are you going?"}</Text><Text style={styles.plannerSub}>{journey ? "Your walk–ride–walk plan" : "Choose a UNILAG destination"}</Text></View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="journey-planner-close"><Ionicons name="close" size={20} color={colors.textPrimary} /></TouchableOpacity>
          </View>
          {journey ? (
            <View style={styles.itinerary}>
              <ItineraryStep icon="walk" label={`Walk to ${journey.pickup.name}`} detail={`${formatWalkingDistance(journey.toPickup.distanceMeters)} · ${Math.max(1, Math.round(journey.toPickup.durationSeconds / 60))} min`} />
              <ItineraryStep icon="bus" label={`Ride ${journey.route.name}`} detail={`${journey.pickup.name} → ${journey.dropoff.name}${journey.rideMinutes != null ? ` · vehicle ETA ${journey.rideMinutes} min` : " · live ETA unavailable"}`} />
              <ItineraryStep icon="walk" label={`Walk to ${journey.destination.name}`} detail={`${formatWalkingDistance(journey.fromDropoff.distanceMeters)} · ${Math.max(1, Math.round(journey.fromDropoff.durationSeconds / 60))} min`} />
              <View style={styles.totalRow}><Text style={styles.totalText}>Walking {totalWalkMinutes} min</Text><Text style={styles.totalText}>Fare ₦{journey.route.fare ?? "—"}</Text></View>
              <View style={styles.arrivalCard}>
                <Text style={styles.arrivalLabel}>I need to arrive by</Text>
                <View style={styles.timeRow}>{["08:00", "10:00", "12:00", "14:00", "16:00"].map((time) => <TouchableOpacity key={time} onPress={() => onArrivalTimeChange(time)} style={[styles.timeChip, arrivalTime === time && styles.timeChipActive]} testID={`arrival-time-${time.replace(":", "-")}`}><Text style={[styles.timeChipText, arrivalTime === time && styles.timeChipTextActive]}>{time}</Text></TouchableOpacity>)}</View>
                <View style={styles.leaveByRow}><Ionicons name="alarm" size={18} color={leaveBy?.leaveNow ? colors.delayed : colors.primary} /><View style={{ flex: 1 }}><Text style={[styles.leaveByTitle, { color: leaveBy?.leaveNow ? colors.delayed : colors.primaryDark }]}>{leaveBy?.leaveNow ? "Leave now" : `Leave by ${leaveBy?.time}`}</Text><Text style={styles.leaveBySub}>{leaveBy?.leaveNow ? `Your journey needs about ${totalWalkMinutes + rideMinutes + 5} min, including a 5 min buffer.` : `Includes ${totalWalkMinutes + rideMinutes + 5} min for walking, ride and a 5 min buffer.`}</Text></View></View>
              </View>
              <TouchableOpacity style={styles.clearJourneyBtn} onPress={onClearJourney} testID="journey-clear-button"><Text style={styles.clearJourneyText}>Clear journey</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.destinationSearch}><Ionicons name="search" size={18} color={colors.textSecondary} /><TextInput value={query} onChangeText={onQueryChange} placeholder="Search faculty, hostel or library" placeholderTextColor={colors.textSecondary} style={styles.destinationInput} testID="journey-destination-search" /></View>
              <ScrollView contentContainerStyle={styles.destinationList} showsVerticalScrollIndicator={false}>
                {destinations.map((destination) => <TouchableOpacity key={destination.id} style={styles.destinationRow} onPress={() => onSelect(destination)} disabled={loading} testID={`journey-destination-${destination.id}`}><View style={styles.destinationIcon}><Ionicons name={destination.icon} size={18} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.destinationName}>{destination.name}</Text><Text style={styles.destinationArea}>{destination.area}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textSecondary} /></TouchableOpacity>)}
              </ScrollView>
            </>
          )}
          {loading ? <View style={styles.planning}><ActivityIndicator color={colors.primary} /><Text style={styles.planningText}>Finding your best walk–ride–walk journey…</Text></View> : null}
          {error ? <Text style={styles.plannerError}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

function getLeaveBy(arrivalTime: string, travelMinutes: number) {
  const [hours, minutes] = arrivalTime.split(":").map(Number);
  const arrival = new Date();
  arrival.setHours(hours, minutes, 0, 0);
  if (arrival.getTime() < Date.now()) arrival.setDate(arrival.getDate() + 1);
  const leave = new Date(arrival.getTime() - travelMinutes * 60 * 1000);
  const leaveNow = leave.getTime() <= Date.now();
  return { leaveNow, time: leave.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
}

function ItineraryStep({ icon, label, detail }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail: string }) {
  return <View style={styles.itineraryStep}><View style={styles.stepIcon}><Ionicons name={icon} size={17} color="#2563EB" /></View><View style={{ flex: 1 }}><Text style={styles.stepLabel}>{label}</Text><Text style={styles.stepDetail}>{detail}</Text></View></View>;
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
  walkWrap: { position: "absolute", alignSelf: "center", alignItems: "center", maxWidth: "88%" },
  walkButton: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: "#BFDBFE", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  walkButtonText: { color: "#1D4ED8", fontSize: 12, fontWeight: "800" },
  walkResult: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#EFF6FF", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: "#93C5FD" },
  walkResultText: { color: "#1E3A8A", fontSize: 12, fontWeight: "800", flexShrink: 1 },
  walkError: { color: colors.delayed, fontSize: 11, fontWeight: "700", marginTop: 6, textAlign: "center", backgroundColor: "rgba(255,255,255,0.92)", paddingHorizontal: 8, borderRadius: 6 },
  planWrap: { position: "absolute", left: 16, right: 92 },
  planButton: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, shadowColor: colors.primary, shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  planButtonText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  journeyCard: { minHeight: 56, backgroundColor: "#fff", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: radii.lg, padding: 10, flexDirection: "row", alignItems: "center", gap: 9, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  journeyIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  journeyTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: "900" },
  journeySub: { color: colors.textSecondary, fontSize: 10, fontWeight: "700", marginTop: 2 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.38)" },
  plannerSheet: { minHeight: 410, maxHeight: "80%", backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 26 },
  plannerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  plannerTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: "900" },
  plannerSub: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 2 },
  destinationSearch: { height: 50, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  destinationInput: { flex: 1, color: colors.textPrimary, fontSize: 14, paddingVertical: 0 },
  destinationList: { paddingTop: 10, paddingBottom: 12 },
  destinationRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  destinationIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryLight },
  destinationName: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" },
  destinationArea: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  planning: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, padding: 13, borderRadius: radii.lg, backgroundColor: colors.primaryLight },
  planningText: { color: colors.primaryDark, fontSize: 12, fontWeight: "800" },
  plannerError: { color: colors.delayed, fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 12 },
  itinerary: { gap: 10 },
  itineraryStep: { flexDirection: "row", gap: 12, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.card },
  stepIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#EFF6FF" },
  stepLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: "800" },
  stepDetail: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 4 },
  totalText: { color: colors.primaryDark, fontSize: 13, fontWeight: "900" },
  arrivalCard: { padding: 12, borderRadius: radii.lg, backgroundColor: colors.primaryLight, gap: 10 },
  arrivalLabel: { color: colors.primaryDark, fontSize: 12, fontWeight: "800" },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  timeChip: { paddingVertical: 7, paddingHorizontal: 9, borderRadius: radii.pill, backgroundColor: "#fff", borderWidth: 1, borderColor: "#BBE7D0" },
  timeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  timeChipText: { color: colors.primaryDark, fontSize: 11, fontWeight: "800" },
  timeChipTextActive: { color: "#fff" },
  leaveByRow: { flexDirection: "row", gap: 9, alignItems: "flex-start", borderTopWidth: 1, borderTopColor: "#BDE5D0", paddingTop: 10 },
  leaveByTitle: { fontSize: 14, fontWeight: "900" },
  leaveBySub: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 2 },
  clearJourneyBtn: { alignItems: "center", paddingVertical: 12, marginTop: 2 },
  clearJourneyText: { color: colors.delayed, fontSize: 13, fontWeight: "800" },
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
