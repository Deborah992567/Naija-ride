import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api, ridesWsUrl, type DriverProfile, type RideEvent, type RideOut, type VehicleType } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

const HEARTBEAT_MS = 10000;

export default function DriveScreen() {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [needsRegister, setNeedsRegister] = useState(false);
  const [vehicle, setVehicle] = useState<VehicleType>("car");
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState("");
  const [model, setModel] = useState("");
  const [phone, setPhone] = useState("");
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ride, setRide] = useState<RideOut | null>(null);
  const [incoming, setIncoming] = useState<RideOut | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const p = await api.driverMe();
      setProfile(p);
      setVehicle(p.vehicle_type);
      setPlate(p.vehicle_plate ?? "");
      setColor(p.vehicle_color ?? "");
      setModel(p.vehicle_model ?? "");
      setPhone(p.phone ?? "");
      setNeedsRegister(false);
      setOnline(p.is_online === 1);
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        setNeedsRegister(true);
      } else {
        setMessage(error instanceof Error ? error.message : "Could not load driver profile.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
    return () => {
      wsRef.current?.close();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [loadProfile]);

  const getPosition = useCallback(async () => {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") throw new Error("Allow location to go online and receive ride requests.");
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    return locationRef.current;
  }, []);

  const sendLocation = useCallback(async () => {
    const ws = wsRef.current;
    const loc = locationRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && loc) {
      ws.send(JSON.stringify({ type: "location", lat: loc.lat, lng: loc.lng }));
    }
  }, []);

  const goOnline = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const loc = await getPosition();
      const p = await api.driverStatus(true, loc.lat, loc.lng);
      setProfile(p);
      setOnline(true);

      const url = await ridesWsUrl("driver");
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RideEvent;
          if (data.event === "ride.request") {
            setIncoming(data as unknown as RideOut);
          } else if (data.event === "ride.cancelled") {
            setIncoming(null);
            setMessage("A rider cancelled their request.");
          } else if (data.event === "connected") {
            sendLocation();
          }
        } catch {}
      };
      heartbeatRef.current = setInterval(() => {
        sendLocation();
      }, HEARTBEAT_MS);
      setMessage("You are online. Ride requests will appear here.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not go online.");
    } finally {
      setBusy(false);
    }
  }, [getPosition, sendLocation]);

  const goOffline = useCallback(async () => {
    if (wsRef.current) wsRef.current.close();
    wsRef.current = null;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    setIncoming(null);
    const loc = locationRef.current;
    try {
      if (loc) {
        const p = await api.driverStatus(false, loc.lat, loc.lng);
        setProfile(p);
      }
    } catch {}
    setOnline(false);
    setRide(null);
    setMessage("You are offline.");
  }, []);

  const accept = useCallback(async (rideId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.acceptRide(rideId);
      setRide(r);
      setIncoming(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept.");
    } finally {
      setBusy(false);
    }
  }, []);

  const decline = useCallback(async (rideId: string) => {
    setBusy(true);
    try {
      await api.declineRide(rideId);
    } catch {}
    setIncoming(null);
    setBusy(false);
  }, []);

  const advance = useCallback(async (action: "arrive" | "start" | "complete") => {
    if (!ride) return;
    setBusy(true);
    setMessage(null);
    try {
      if (action === "complete") {
        const trip = await api.completeRide(ride.ride_id);
        setRide(null);
        setMessage(`Trip complete — rider owes ₦${trip.fare.toLocaleString()} (${trip.payment_method}).`);
      } else {
        const r = action === "arrive" ? await api.arriveRide(ride.ride_id) : await api.startRide(ride.ride_id);
        setRide(r);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, [ride]);

  const register = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const p = await api.driverRegister({ vehicle_type: vehicle, vehicle_plate: plate, vehicle_color: color, vehicle_model: model, phone });
      setProfile(p);
      setNeedsRegister(false);
      setMessage("Driver profile saved. Go online to receive requests.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setBusy(false);
    }
  }, [vehicle, plate, color, model, phone]);

  if (loading) return <SafeAreaView style={styles.root}><ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} /></SafeAreaView>;

  if (needsRegister) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="car" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Become a driver</Text><Text style={styles.subtitle}>Register your vehicle to receive ride requests.</Text></View></View>

          <Text style={styles.section}>Vehicle type</Text>
          <View style={styles.vehicleRow}>
            {(["car", "keke"] as VehicleType[]).map((v) => (
              <TouchableOpacity key={v} onPress={() => setVehicle(v)} style={[styles.vehicleCard, vehicle === v && styles.vehicleCardActive]} testID={`driver-vehicle-${v}`}>
                <Ionicons name={v === "car" ? "car" : "bicycle"} size={22} color={vehicle === v ? colors.primary : colors.textSecondary} />
                <Text style={[styles.vehicleLabel, vehicle === v && styles.vehicleLabelActive]}>{v === "car" ? "Car" : "Keke"}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.section}>Vehicle details</Text>
          <TextInput style={styles.input} placeholder="Plate number (e.g. LAG-123)" placeholderTextColor={colors.textSecondary} value={plate} onChangeText={setPlate} autoCapitalize="characters" testID="driver-plate-input" />
          <TextInput style={styles.input} placeholder="Colour (e.g. Blue)" placeholderTextColor={colors.textSecondary} value={color} onChangeText={setColor} testID="driver-color-input" />
          <TextInput style={styles.input} placeholder="Model (e.g. Toyota Camry)" placeholderTextColor={colors.textSecondary} value={model} onChangeText={setModel} testID="driver-model-input" />
          <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor={colors.textSecondary} value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="driver-phone-input" />

          {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

          <TouchableOpacity style={[styles.primaryButton, busy && { opacity: 0.7 }]} onPress={register} disabled={busy} testID="driver-register-button">
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.primaryText}>Save driver profile</Text></>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const meta = profile ? `${profile.vehicle_type === "car" ? "Car" : "Keke"}${profile.vehicle_model ? ` · ${profile.vehicle_model}` : ""}${profile.vehicle_plate ? ` · ${profile.vehicle_plate}` : ""}` : "";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="car" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Driver Mode</Text><Text style={styles.subtitle}>{online ? "Online — nearby riders can find you." : "Go online to start receiving requests."}</Text></View>{online ? <View style={styles.onlineBadge} testID="driver-online-badge"><View style={styles.pulse} /><Text style={styles.onlineText}>ONLINE</Text></View> : <View style={styles.offlineBadge}><Text style={styles.offlineText}>OFFLINE</Text></View>}</View>

        <View style={styles.profileCard}>
          <View style={styles.driverAvatar}><Ionicons name="person" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{profile?.name ?? "You"}</Text>
            <Text style={styles.profileMeta}>{meta}</Text>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.stat}><Text style={styles.statValue}>⭐ {profile?.rating.toFixed(1) ?? "5.0"}</Text><Text style={styles.statLabel}>rating</Text></View>
            <View style={styles.stat}><Text style={styles.statValue}>{profile?.trips_completed ?? 0}</Text><Text style={styles.statLabel}>trips</Text></View>
          </View>
        </View>

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        {!online ? (
          <TouchableOpacity style={[styles.primaryButton, busy && { opacity: 0.7 }]} onPress={goOnline} disabled={busy} testID="driver-go-online-button">
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="radio" size={18} color="#fff" /><Text style={styles.primaryText}>Go online</Text></>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.offlineButton, busy && { opacity: 0.7 }]} onPress={goOffline} disabled={busy} testID="driver-go-offline-button">
            <Ionicons name="power" size={18} color={colors.delayed} /><Text style={styles.offlineButtonText}>Go offline</Text>
          </TouchableOpacity>
        )}

        {incoming ? (
          <View style={styles.requestCard} testID="driver-request-card">
            <View style={styles.requestHeader}><Ionicons name="flash" size={17} color={colors.secondaryDark} /><Text style={styles.requestTitle}>New ride request</Text></View>
            <View style={styles.requestRow}><Ionicons name="location" size={16} color={colors.primary} /><Text style={styles.requestText}>{incoming.pickup_address ?? "Pickup"} ({incoming.pickup_lat.toFixed(4)}, {incoming.pickup_lng.toFixed(4)})</Text></View>
            <View style={styles.requestRow}><Ionicons name="flag" size={16} color={colors.delayed} /><Text style={styles.requestText}>{incoming.dropoff_address ?? "Dropoff"}</Text></View>
            <View style={styles.requestMeta}>
              <Text style={styles.requestFare}>₦{incoming.fare_estimate.toLocaleString()}</Text>
              <Text style={styles.requestDist}>{incoming.distance_km.toFixed(1)} km</Text>
              {incoming.driver_eta_minutes != null ? <Text style={styles.requestDist}>ETA ~{incoming.driver_eta_minutes} min</Text> : null}
            </View>
            <View style={styles.requestActions}>
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => accept(incoming.ride_id)} disabled={busy} testID="driver-accept-button">{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept</Text>}</TouchableOpacity>
              <TouchableOpacity style={styles.declineButton} onPress={() => decline(incoming.ride_id)} disabled={busy} testID="driver-decline-button"><Text style={styles.declineText}>Decline</Text></TouchableOpacity>
            </View>
          </View>
        ) : null}

        {ride ? (
          <View style={styles.activeCard} testID="driver-active-ride">
            <View style={styles.requestHeader}><Ionicons name="navigate" size={17} color={colors.primary} /><Text style={styles.requestTitle}>Active ride · {ride.status.replace("_", " ")}</Text></View>
            <View style={styles.requestRow}><Ionicons name="location" size={16} color={colors.primary} /><Text style={styles.requestText}>{ride.pickup_address ?? "Pickup"}</Text></View>
            <View style={styles.requestRow}><Ionicons name="flag" size={16} color={colors.delayed} /><Text style={styles.requestText}>{ride.dropoff_address ?? "Dropoff"}</Text></View>
            <View style={styles.requestMeta}><Text style={styles.requestFare}>₦{ride.fare_estimate.toLocaleString()}</Text><Text style={styles.requestDist}>{ride.payment_method ?? "cash"}</Text></View>
            {ride.status === "accepted" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advance("arrive")} disabled={busy} testID="driver-arrive-button"><Text style={styles.acceptText}>I have arrived</Text></TouchableOpacity>
            ) : null}
            {ride.status === "arriving" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advance("start")} disabled={busy} testID="driver-start-button"><Text style={styles.acceptText}>Start trip</Text></TouchableOpacity>
            ) : null}
            {ride.status === "in_progress" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advance("complete")} disabled={busy} testID="driver-complete-button"><Text style={styles.acceptText}>Complete trip</Text></TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 110 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.primaryDark, borderRadius: radii.xl },
  heroIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 22, fontWeight: "900" },
  subtitle: { color: "#D1FAE5", fontSize: 12, lineHeight: 17, marginTop: 3, flexShrink: 1 },
  onlineBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#DC2626", borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 6 },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  onlineText: { color: "#fff", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  offlineBadge: { backgroundColor: "#334155", borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 6 },
  offlineText: { color: "#E2E8F0", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, marginTop: spacing.md },
  driverAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  profileName: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  profileMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 12 },
  stat: { alignItems: "center" },
  statValue: { color: colors.textPrimary, fontSize: 13, fontWeight: "900" },
  statLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  primaryButton: { minHeight: 54, marginTop: 16, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  offlineButton: { minHeight: 54, marginTop: 16, borderRadius: radii.pill, backgroundColor: "#FEE2E2", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  offlineButtonText: { color: colors.delayed, fontSize: 14, fontWeight: "900" },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 9 },
  vehicleRow: { flexDirection: "row", gap: 10 },
  vehicleCard: { flex: 1, minHeight: 70, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, alignItems: "center", justifyContent: "center", gap: 5 },
  vehicleCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  vehicleLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  vehicleLabelActive: { color: colors.primary },
  input: { backgroundColor: colors.input, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12, color: colors.textPrimary, fontSize: 14, fontWeight: "600", marginBottom: 10 },
  requestCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.secondaryDark, borderRadius: radii.lg, padding: 16, marginTop: 16 },
  requestHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  requestTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  requestRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 8 },
  requestText: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  requestMeta: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 12, marginTop: 2 },
  requestFare: { color: colors.primaryDark, fontSize: 20, fontWeight: "900" },
  requestDist: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  requestActions: { flexDirection: "row", gap: 10 },
  acceptButton: { flex: 1, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  acceptText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  declineButton: { minWidth: 96, minHeight: 48, borderRadius: radii.pill, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center" },
  declineText: { color: colors.delayed, fontSize: 14, fontWeight: "900" },
  activeCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary, borderRadius: radii.lg, padding: 16, marginTop: 16 },
});
