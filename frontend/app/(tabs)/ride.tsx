import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import { api, ridesWsUrl, type PaymentMethod, type RideEvent, type RideOut, type RideStatus, type TripOut, type VehicleType } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

type Destination = { name: string; area: string; lat: number; lng: number };

const DESTINATIONS: Destination[] = [
  { name: "CMS", area: "Lagos Island", lat: 6.4534, lng: 3.3942 },
  { name: "Yaba", area: "Lagos Mainland", lat: 6.51, lng: 3.37 },
  { name: "Ikeja", area: "Lagos", lat: 6.6018, lng: 3.3515 },
  { name: "Lekki Phase 1", area: "Lagos", lat: 6.4478, lng: 3.4723 },
  { name: "Victoria Island", area: "Lagos", lat: 6.4281, lng: 3.4219 },
  { name: "Surulere", area: "Lagos", lat: 6.5013, lng: 3.3553 },
  { name: "Wuse Market", area: "Abuja", lat: 9.0765, lng: 7.4730 },
  { name: "Garki", area: "Abuja", lat: 9.033, lng: 7.49 },
  { name: "Maitama", area: "Abuja", lat: 9.088, lng: 7.499 },
];

const STATUS_STEPS: Record<string, { label: string; icon: "time" | "car" | "location" | "navigate" | "flag" }> = {
  requested: { label: "Finding a driver", icon: "time" },
  accepted: { label: "Driver on the way", icon: "car" },
  arriving: { label: "Driver has arrived", icon: "location" },
  in_progress: { label: "On the way", icon: "navigate" },
  completed: { label: "Trip complete", icon: "flag" },
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: "Cash", card: "Card", transfer: "Bank transfer" };

export default function RideScreen() {
  const [pickup, setPickup] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoff, setDropoff] = useState<Destination | null>(null);
  const [vehicle, setVehicle] = useState<VehicleType>("car");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof api.estimateRide>> | null>(null);
  const [phase, setPhase] = useState<"form" | "active">("form");
  const [ride, setRide] = useState<RideOut | null>(null);
  const [trip, setTrip] = useState<TripOut | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status === "granted") {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setPickup({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    api.estimateRide({ pickup_lat: pickup.lat, pickup_lng: pickup.lng, dropoff_lat: dropoff.lat, dropoff_lng: dropoff.lng, vehicle_type: vehicle })
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [pickup, dropoff, vehicle]);

  const openSocket = useCallback(async () => {
    wsRef.current?.close();
    const url = await ridesWsUrl("rider");
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RideEvent;
        if (data.event === "ride.status" || data.event === "ride.accepted") {
          setRide((prev) => (prev && prev.ride_id === data.ride_id ? { ...prev, status: (data as { status: RideStatus }).status } : prev));
          api.getRide(data.ride_id).then(setRide).catch(() => {});
        } else if (data.event === "driver.location") {
          setDriverLocation({ lat: data.lat, lng: data.lng });
        } else if (data.event === "ride.completed") {
          api.getRide(data.ride_id).then(setRide).catch(() => {});
        } else if (data.event === "ride.cancelled") {
          setMessage("This ride was cancelled.");
          setPhase("form");
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (phase === "active" && ride) {
      openSocket();
    }
    return () => {
      if (phase !== "active") wsRef.current?.close();
    };
  }, [phase, ride, openSocket]);

  const requestRide = useCallback(async () => {
    if (!pickup || !dropoff) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.requestRide({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_address: "My location",
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        dropoff_address: dropoff.name,
        vehicle_type: vehicle,
        payment_method: payment,
      });
      setRide(result);
      setPhase("active");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request this ride.");
    } finally {
      setBusy(false);
    }
  }, [pickup, dropoff, vehicle, payment]);

  const cancelRide = useCallback(async () => {
    if (!ride) return;
    setBusy(true);
    try {
      await api.cancelRide(ride.ride_id);
      wsRef.current?.close();
      setRide(null);
      setDriverLocation(null);
      setTrip(null);
      setPhase("form");
      setMessage("Ride cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }, [ride]);

  const statusStep = useMemo(() => (ride ? STATUS_STEPS[ride.status] ?? STATUS_STEPS.requested : null), [ride]);
  const banned = estimate && !estimate.allowed;

  const payCard = useCallback(async () => {
    if (!ride) return;
    setBusy(true);
    try {
      const init = await api.initCardPayment(ride.ride_id, ride.fare_estimate);
      await WebBrowser.openAuthSessionAsync(init.authorization_url);
      const res = await api.verifyCardPayment(init.payment_id);
      if (res.ok) setMessage(`Card payment of ₦${ride.fare_estimate.toLocaleString()} confirmed.`);
      else setMessage(`Payment pending: ${res.status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Card payment failed.");
    } finally {
      setBusy(false);
    }
  }, [ride]);

  const payTransfer = useCallback(async () => {
    if (!ride) return;
    setBusy(true);
    try {
      const details = await api.transferDetails(ride.ride_id);
      Alert.alert("Transfer details", `${details.account_name}\n${details.bank_name}\nAccount: ${details.account_number}\nAmount: ₦${details.amount.toLocaleString()}\nRef: ${details.reference}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load transfer details.");
    } finally {
      setBusy(false);
    }
  }, [ride]);

  const rateTrip = useCallback(async (rating: number) => {
    if (!trip) return;
    await api.rateTrip(trip.trip_id, rating).catch(() => {});
    setMessage("Thanks for your feedback!");
    setPhase("form");
    setRide(null);
    setTrip(null);
    setDriverLocation(null);
  }, [trip]);

  const liveStep = (step: string) => {
    const order = ["requested", "accepted", "arriving", "in_progress"];
    return step === "completed" ? 4 : order.indexOf(step);
  };

  if (phase === "active" && ride && !trip) {
    const stepIdx = liveStep(ride.status);
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="car" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>{statusStep?.label}</Text><Text style={styles.subtitle}>{ride.pickup_address ?? "Pickup"} → {ride.dropoff_address ?? "Dropoff"}</Text></View>{ride.status === "requested" ? <TouchableOpacity onPress={cancelRide} disabled={busy} testID="ride-cancel-button"><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity> : null}</View>

          <View style={styles.timeline}>
            {["requested", "accepted", "arriving", "in_progress"].map((s, i) => (
              <View key={s} style={styles.stepRow} testID={`ride-step-${s}`}>
                <View style={styles.stepIconWrap}><View style={[styles.stepDot, i <= stepIdx && styles.stepDotActive]} /><Ionicons name={STATUS_STEPS[s].icon} size={15} color={i <= stepIdx ? colors.primary : colors.border} /></View>
                <Text style={[styles.stepLabel, i <= stepIdx && styles.stepLabelActive]}>{STATUS_STEPS[s].label}</Text>
                {s === "accepted" && ride.status === "accepted" && ride.driver ? <Text style={styles.stepMeta}>{(ride.driver.name ?? "Driver")} · {ride.driver.vehicle_model ?? ride.driver.vehicle_type} · ⭐ {ride.driver.rating.toFixed(1)}</Text> : null}
              </View>
            ))}
          </View>

          {ride.driver ? (
            <View style={styles.driverCard} testID="ride-driver-card">
              <View style={styles.driverAvatar}><Ionicons name="person" size={20} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.driverName}>{ride.driver.name ?? "Your driver"}</Text><Text style={styles.driverMeta}>{ride.driver.vehicle_model ?? ride.driver.vehicle_type} · {ride.driver.vehicle_color ?? ""} · {ride.driver.vehicle_plate ?? ""}</Text></View>
              <View style={styles.driverRating}><Ionicons name="star" size={13} color={colors.secondaryDark} /><Text style={styles.driverRatingText}>{ride.driver.rating.toFixed(1)}</Text></View>
            </View>
          ) : (
            <View style={styles.searching} testID="ride-searching"><ActivityIndicator color={colors.primary} /><Text style={styles.searchingText}>Notifying nearby {vehicle} drivers… {ride.driver_eta_minutes != null ? `ETA ~${ride.driver_eta_minutes} min` : ""}</Text></View>
          )}

          {driverLocation ? (
            <View style={styles.statusLine}><Ionicons name="navigate" size={15} color={colors.primary} /><Text style={styles.statusLineText}>Driver position updated ({driverLocation.lat.toFixed(4)}, {driverLocation.lng.toFixed(4)})</Text></View>
          ) : null}

          <View style={styles.fareCard}>
            <Text style={styles.fareLabel}>{ride.vehicle_type === "car" ? "Car" : "Keke"} fare</Text>
            <Text style={styles.fareValue}>₦{ride.fare_estimate.toLocaleString()}</Text>
            <Text style={styles.fareMeta}>{ride.distance_km.toFixed(1)} km · {PAYMENT_LABELS[ride.payment_method ?? "cash"]}</Text>
          </View>

          {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

          {ride.status === "in_progress" ? (
            <TouchableOpacity style={[styles.primaryButton, busy && { opacity: 0.7 }]} onPress={async () => { setBusy(true); try { const t = await api.completeRide(ride.ride_id); setTrip(t); setMessage(null); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not complete."); } finally { setBusy(false); } }} disabled={busy} testID="ride-complete-button"><Ionicons name="flag" size={18} color="#fff" /><Text style={styles.primaryText}>Complete ride</Text></TouchableOpacity>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (phase === "active" && trip) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="checkmark" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Trip complete</Text><Text style={styles.subtitle}>₦{trip.fare.toLocaleString()} · {PAYMENT_LABELS[trip.payment_method]}</Text></View></View>

          <View style={styles.fareCard}><Text style={styles.fareLabel}>Total fare</Text><Text style={styles.fareValue}>₦{trip.fare.toLocaleString()}</Text><Text style={styles.fareMeta}>Paid by {PAYMENT_LABELS[trip.payment_method]}</Text></View>

          {trip.payment_method === "card" ? (
            <TouchableOpacity style={[styles.primaryButton, busy && { opacity: 0.7 }]} onPress={payCard} disabled={busy} testID="ride-pay-card"><Ionicons name="card" size={18} color="#fff" /><Text style={styles.primaryText}>Pay with card</Text></TouchableOpacity>
          ) : null}
          {trip.payment_method === "transfer" ? (
            <TouchableOpacity style={[styles.primaryButton, busy && { opacity: 0.7 }]} onPress={payTransfer} disabled={busy} testID="ride-pay-transfer"><Ionicons name="business" size={18} color="#fff" /><Text style={styles.primaryText}>View transfer details</Text></TouchableOpacity>
          ) : null}
          {trip.payment_method === "cash" ? <View style={styles.status}><Ionicons name="cash" size={16} color={colors.primary} /><Text style={styles.statusText}>Pay {PAYMENT_LABELS.cash} to your driver.</Text></View> : null}

          <Text style={styles.section}>Rate your driver</Text>
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => rateTrip(n)} testID={`ride-rating-${n}`}><Ionicons name="star" size={34} color={colors.secondary} /></TouchableOpacity>
            ))}
          </View>

          {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="car" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Book a ride</Text><Text style={styles.subtitle}>On-demand cars and keke rides.</Text></View></View>

        <View style={styles.locations}>
          <View style={styles.locationRow} testID="ride-pickup"><View style={styles.dotPickup} /><View style={{ flex: 1 }}><Text style={styles.locationLabel}>Pickup</Text><Text style={styles.locationValue}>{pickup ? `My location (${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)})` : "Locating you…"}</Text></View></View>
          <View style={styles.dashLine} />
          <View style={styles.locationRow} testID="ride-dropoff"><View style={styles.dotDropoff} /><View style={{ flex: 1 }}><Text style={styles.locationLabel}>Where to?</Text><Text style={styles.locationValue}>{dropoff ? dropoff.name : "Choose a destination below"}</Text></View></View>
        </View>

        <Text style={styles.section}>Vehicle</Text>
        <View style={styles.vehicleRow}>
          {(["car", "keke"] as VehicleType[]).map((v) => (
            <TouchableOpacity key={v} onPress={() => setVehicle(v)} style={[styles.vehicleCard, vehicle === v && styles.vehicleCardActive]} testID={`ride-vehicle-${v}`}>
              <Ionicons name={v === "car" ? "car" : "bicycle"} size={22} color={vehicle === v ? colors.primary : colors.textSecondary} />
              <Text style={[styles.vehicleLabel, vehicle === v && styles.vehicleLabelActive]}>{v === "car" ? "Car" : "Keke"}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>Destinations</Text>
        <View style={styles.destList}>
          {DESTINATIONS.map((d) => (
            <TouchableOpacity key={d.name} onPress={() => setDropoff(d)} style={[styles.destCard, dropoff?.name === d.name && styles.destCardActive]} testID={`ride-dest-${d.name}`}>
              <Ionicons name="location" size={17} color={dropoff?.name === d.name ? colors.primary : colors.textSecondary} />
              <View style={{ flex: 1 }}><Text style={styles.destName}>{d.name}</Text><Text style={styles.destArea}>{d.area}</Text></View>
              {dropoff?.name === d.name ? <Ionicons name="checkmark-circle" size={19} color={colors.primary} /> : null}
            </TouchableOpacity>
          ))}
        </View>

        {banned ? (
          <View style={styles.bannedCard} testID="ride-zone-warning">
            <Ionicons name="alert-circle" size={17} color={colors.delayed} />
            <Text style={styles.bannedText}>{estimate?.reason ?? "Keke is not allowed in this zone."} Choose a car instead.</Text>
          </View>
        ) : estimate ? (
          <View style={styles.fareCard} testID="ride-estimate">
            <Text style={styles.fareLabel}>{vehicle === "car" ? "Car" : "Keke"} estimate</Text>
            <Text style={styles.fareValue}>₦{estimate.fare.toLocaleString()}</Text>
            <Text style={styles.fareMeta}>{estimate.distance_km.toFixed(1)} km · ~{estimate.eta_minutes} min</Text>
            <View style={styles.paymentRow}>
              {estimate.payment_methods.map((m) => (
                <TouchableOpacity key={m} onPress={() => setPayment(m)} style={[styles.paymentChip, payment === m && styles.paymentChipActive]} testID={`ride-payment-${m}`}><Text style={[styles.paymentChipText, payment === m && styles.paymentChipTextActive]}>{PAYMENT_LABELS[m]}</Text></TouchableOpacity>
              ))}
            </View>
          </View>
        ) : pickup && dropoff ? (
          <View style={styles.status}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.statusText}>Calculating fare…</Text></View>
        ) : null}

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        <TouchableOpacity style={[styles.primaryButton, (busy || banned || !pickup || !dropoff) && { opacity: 0.5 }]} onPress={requestRide} disabled={busy || banned || !pickup || !dropoff} testID="ride-request-button">
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="navigate" size={18} color="#fff" /><Text style={styles.primaryText}>Request {vehicle === "car" ? "car" : "keke"}</Text></>}
        </TouchableOpacity>
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
  subtitle: { color: "#D1FAE5", fontSize: 12, lineHeight: 17, marginTop: 3 },
  cancelText: { color: "#FECACA", fontSize: 14, fontWeight: "800", paddingVertical: 8, paddingLeft: 12 },
  locations: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: spacing.md },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  dashLine: { height: 16, borderLeftWidth: 1, borderStyle: "dashed", borderColor: colors.border, marginLeft: 5 },
  dotPickup: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },
  dotDropoff: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.secondary },
  locationLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  locationValue: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", marginTop: 2 },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 9 },
  vehicleRow: { flexDirection: "row", gap: 10 },
  vehicleCard: { flex: 1, minHeight: 74, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, alignItems: "center", justifyContent: "center", gap: 5 },
  vehicleCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  vehicleLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  vehicleLabelActive: { color: colors.primary },
  destList: { gap: 8 },
  destCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 13 },
  destCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  destName: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" },
  destArea: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  bannedCard: { flexDirection: "row", gap: 9, padding: 13, borderRadius: radii.lg, marginTop: 18, backgroundColor: "#FEF2F2", alignItems: "center" },
  bannedText: { flex: 1, color: colors.delayed, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  fareCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 16, marginTop: 18 },
  fareLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  fareValue: { color: colors.primaryDark, fontSize: 30, fontWeight: "900", marginTop: 4 },
  fareMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 3 },
  paymentRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  paymentChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  paymentChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  paymentChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  paymentChipTextActive: { color: colors.primary },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  primaryButton: { minHeight: 54, marginTop: 18, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  timeline: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: spacing.md, gap: 14 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  stepIconWrap: { width: 24, alignItems: "center" },
  stepDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.border, marginBottom: 2 },
  stepDotActive: { backgroundColor: colors.primary },
  stepLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
  stepLabelActive: { color: colors.textPrimary },
  stepMeta: { marginLeft: "auto", color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  driverCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, marginTop: spacing.md },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  driverName: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  driverMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  driverRating: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.secondaryLight, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  driverRatingText: { color: colors.secondaryDark, fontSize: 12, fontWeight: "900" },
  searching: { flexDirection: "row", gap: 10, padding: 15, borderRadius: radii.lg, marginTop: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  searchingText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  statusLine: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusLineText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700" },
  ratingRow: { flexDirection: "row", gap: 18, justifyContent: "center", paddingVertical: 12 },
});
