import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api, type Route } from "@/src/lib/api";
import { colors, radii, spacing, vehicleMeta } from "@/src/lib/theme";
import { getDeviceId } from "@/src/lib/device";

const CAPACITY = [
  { seats: 8, label: "Many seats", crowd: "empty" as const },
  { seats: 4, label: "A few seats", crowd: "moderate" as const },
  { seats: 1, label: "Last seat", crowd: "packed" as const },
  { seats: 0, label: "Full", crowd: "packed" as const },
];

const LIVE_INTERVAL_MS = 120000;

export default function DriveScreen() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState(CAPACITY[1]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const liveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRoutes = useCallback(async () => {
    try {
      const items = await api.listRoutes({ city: "Campus" });
      setRoutes(items);
      setRouteId(items[0]?.route_id ?? null);
      setStatus(null);
    } catch {
      setStatus("Could not load routes. Pull down and try again.");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadRoutes().finally(() => setLoading(false));
  }, [loadRoutes]);

  useEffect(() => {
    return () => {
      if (liveTimer.current) clearInterval(liveTimer.current);
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadRoutes().finally(() => setRefreshing(false));
  }, [loadRoutes]);

  const route = useMemo(() => routes.find((item) => item.route_id === routeId) ?? null, [routes, routeId]);

  const getPosition = useCallback(async () => {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") throw new Error("Allow location so students can find your shuttle.");
    return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  }, []);

  const publish = useCallback(async () => {
    if (!route) return;
    const location = await getPosition();
    const deviceId = await getDeviceId();
    await api.submitReport({
      route_id: route.route_id,
      type: "onboard",
      vehicle_type: route.vehicle_type,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      crowd_level: capacity.crowd,
      device_id: deviceId,
      note: `Driver update · ${capacity.seats === 0 ? "Vehicle is full" : `${capacity.seats} seat${capacity.seats === 1 ? "" : "s"} available`}`,
    });
    setLastUpdate(new Date());
  }, [route, capacity, getPosition]);

  async function startTrip() {
    if (!route) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await publish();
      setLive(true);
      setStatus("Live trip started — updating students every 2 minutes. Tap to update sooner.");
      liveTimer.current = setInterval(async () => {
        try {
          await publish();
        } catch {
          // Keep the trip live; next tick will retry.
        }
      }, LIVE_INTERVAL_MS);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start this trip.");
    } finally {
      setSubmitting(false);
    }
  }

  function stopTrip() {
    if (liveTimer.current) clearInterval(liveTimer.current);
    liveTimer.current = null;
    setLive(false);
    setLastUpdate(null);
    setStatus("Trip ended. Thanks for sharing.");
  }

  if (loading) return <SafeAreaView style={styles.root}><ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
        <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="bus" size={23} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Driver Mode</Text><Text style={styles.subtitle}>Share your trip so students can plan with confidence.</Text></View></View>

        <Text style={styles.section}>Your route</Text>
        {routes.map((item) => {
          const active = item.route_id === routeId;
          const meta = vehicleMeta[item.vehicle_type] || vehicleMeta.shuttle;
          return <TouchableOpacity key={item.route_id} onPress={() => setRouteId(item.route_id)} style={[styles.routeCard, active && styles.routeCardActive]} testID={`driver-route-${item.route_id}`}><View style={[styles.routeIcon, { backgroundColor: meta.color }]}><Ionicons name={meta.icon} size={18} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.routeName}>{item.name}</Text><Text style={styles.routeStops}>{item.stops[0]?.name} → {item.stops[item.stops.length - 1]?.name}</Text></View>{active ? <Ionicons name="checkmark-circle" size={21} color={colors.primary} /> : <Ionicons name="ellipse-outline" size={21} color={colors.border} />}</TouchableOpacity>;
        })}

        <Text style={styles.section}>Seats available now</Text>
        <View style={styles.capacityGrid}>{CAPACITY.map((item) => <TouchableOpacity key={item.label} onPress={() => setCapacity(item)} style={[styles.capacityCard, capacity.seats === item.seats && styles.capacityCardActive]} testID={`driver-capacity-${item.seats}`}><Text style={[styles.capacityValue, capacity.seats === item.seats && styles.capacityValueActive]}>{item.seats === 0 ? "Full" : item.seats}</Text><Text style={[styles.capacityLabel, capacity.seats === item.seats && styles.capacityLabelActive]}>{item.seats === 0 ? "No more seats" : item.label}</Text></TouchableOpacity>)}</View>

        <View style={styles.privacy}><Ionicons name="shield-checkmark" size={17} color={colors.primary} /><Text style={styles.privacyText}>{live ? "Your location updates automatically every 2 minutes while this screen is open. End the trip when you finish your run." : "Your current location is shared only when you start or update a trip. Keep this screen open and update at major stops."}</Text></View>
        {lastUpdate ? (
          <View style={styles.liveBadge} testID="driver-live-badge">
            <View style={styles.pulse} />
            <Text style={styles.liveText}>LIVE · updated {lastUpdate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
          </View>
        ) : null}
        {status ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{status}</Text></View> : null}
        {live ? (
          <View style={styles.liveActions}>
            <TouchableOpacity style={[styles.shareButton, submitting && { opacity: 0.7 }]} onPress={async () => { setSubmitting(true); setStatus(null); try { await publish(); setStatus("Position updated."); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update."); } finally { setSubmitting(false); } }} disabled={submitting} testID="driver-update-trip-button">{submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="navigate" size={18} color="#fff" /><Text style={styles.shareText}>Update now</Text></>}</TouchableOpacity>
            <TouchableOpacity style={[styles.stopButton, submitting && { opacity: 0.7 }]} onPress={stopTrip} disabled={submitting} testID="driver-stop-trip-button"><Ionicons name="stop-circle" size={18} color={colors.delayed} /><Text style={styles.stopText}>End trip</Text></TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.shareButton, submitting && { opacity: 0.7 }]} onPress={startTrip} disabled={submitting || !route} testID="driver-share-trip-button">{submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="radio" size={18} color="#fff" /><Text style={styles.shareText}>Start live trip</Text></>}</TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { padding: spacing.lg, paddingBottom: 110 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.primaryDark, borderRadius: radii.xl }, heroIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, title: { color: "#fff", fontSize: 22, fontWeight: "900" }, subtitle: { color: "#D1FAE5", fontSize: 12, lineHeight: 17, marginTop: 3 },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 9 }, routeCard: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: 13, flexDirection: "row", alignItems: "center", gap: 11 }, routeCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, routeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" }, routeName: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" }, routeStops: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  capacityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, capacityCard: { width: "47%", minHeight: 78, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 12, justifyContent: "center" }, capacityCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, capacityValue: { color: colors.textPrimary, fontSize: 22, fontWeight: "900" }, capacityValueActive: { color: colors.primary }, capacityLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", marginTop: 2 }, capacityLabelActive: { color: colors.primaryDark },
  privacy: { flexDirection: "row", gap: 9, padding: 12, borderRadius: radii.lg, marginTop: 22, backgroundColor: "#ECFDF5" }, privacyText: { flex: 1, color: colors.primaryDark, fontSize: 11, fontWeight: "600", lineHeight: 16 }, liveBadge: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: "#DC2626", alignSelf: "flex-start", paddingHorizontal: 14 }, pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }, liveText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 0.4 }, status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight }, statusText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700", lineHeight: 17 }, shareButton: { minHeight: 54, marginTop: 16, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, shareText: { color: "#fff", fontSize: 14, fontWeight: "900" }, liveActions: { flexDirection: "row", gap: 10, marginTop: 16 }, stopButton: { minHeight: 54, flex: 1, borderRadius: radii.pill, backgroundColor: "#FEE2E2", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, stopText: { color: colors.delayed, fontSize: 14, fontWeight: "900" },
});
