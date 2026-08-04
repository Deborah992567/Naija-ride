// Moving: home/office relocation with trucks. Book, then track live.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api, ridesWsUrl, type MovingOut, type MovingQuoteOut, type MovingType, type Place, type TruckSize } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";
import LiveMap from "@/src/components/live-map";
import BookingMap from "@/src/components/booking-map";
import PlaceAutocomplete from "@/src/components/place-autocomplete";

const MOVE_TYPES: MovingType[] = ["home", "apartment", "office"];
const MOVE_LABELS: Record<MovingType, string> = { home: "Home", apartment: "Apartment", office: "Office" };
const TRUCK_SIZES: TruckSize[] = ["small", "medium", "large"];
const TRUCK_LABELS: Record<TruckSize, string> = { small: "Small", medium: "Medium", large: "Large" };
const PAYMENT_METHODS = ["cash", "card", "transfer", "wallet"];
const PAYMENT_LABELS: Record<string, string> = { cash: "Cash", card: "Card", transfer: "Transfer", wallet: "Wallet" };

const STATUS_STEPS: Record<string, { label: string; icon: "time" | "home" | "navigate" | "flag" }> = {
  requested: { label: "Finding a mover", icon: "time" },
  accepted: { label: "Mover on the way", icon: "home" },
  in_progress: { label: "Move in progress", icon: "navigate" },
  completed: { label: "Move complete", icon: "flag" },
};

export default function MovingScreen() {
  const router = useRouter();
  const [origin, setOrigin] = useState<Place | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [moveType, setMoveType] = useState<MovingType>("home");
  const [truckSize, setTruckSize] = useState<TruckSize>("medium");
  const [moveDate, setMoveDate] = useState("");
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState("cash");
  const [quote, setQuote] = useState<MovingQuoteOut | null>(null);
  const [phase, setPhase] = useState<"form" | "active">("form");
  const [booking, setBooking] = useState<MovingOut | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [eta, setEta] = useState<{ minutes: number; target: "pickup" | "dropoff" } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const nameCurrentPosition = useCallback(async (lat: number, lng: number) => {
    const fallback: Place = { name: "My current location", lat, lng, state: null, city: null, category: null };
    try {
      const place = await api.reverseGeocode(lat, lng);
      setOrigin({ ...place, name: place.name || "My current location" });
    } catch {
      setOrigin(fallback);
    }
  }, []);

  const getMyLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setOrigin({ name: "Permission denied — search for origin", lat: 6.5244, lng: 3.3792, state: null, city: null, category: null });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await nameCurrentPosition(pos.coords.latitude, pos.coords.longitude);
    } catch {
      setMessage("Could not get your location. Try searching for the origin instead.");
    } finally {
      setLocating(false);
    }
  }, [locating, nameCurrentPosition]);

  useEffect(() => {
    getMyLocation();
  }, []);

  const tapMap = useCallback((lat: number, lng: number) => {
    setDest({ name: "Pinned on map", lat, lng, state: null, city: null, category: null });
    api.reverseGeocode(lat, lng)
      .then((place) => setDest((prev) => (prev && prev.lat === lat && prev.lng === lng ? { ...place, name: place.name || "Pinned on map" } : prev)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!origin || !dest) return;
    api.movingQuote({
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      destination_lat: dest.lat,
      destination_lng: dest.lng,
      move_type: moveType,
      truck_size: truckSize,
    })
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [origin, dest, moveType, truckSize]);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  const openSocket = useCallback(async () => {
    wsRef.current?.close();
    const url = await ridesWsUrl("rider");
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { event: string; [k: string]: unknown };
        if (data.event === "moving.status" || data.event === "moving.accepted") {
          const id = data.booking_id as string;
          setBooking((prev) => (prev && prev.booking_id === id ? { ...prev, status: data.status as string } : prev));
          api.getMoving(id).then(setBooking).catch(() => {});
        } else if (data.event === "moving.completed") {
          const id = data.booking_id as string;
          api.getMoving(id).then(setBooking).catch(() => {});
        } else if (data.event === "driver.location" && data.booking_id) {
          setDriverLocation({ lat: data.lat as number, lng: data.lng as number });
          if (data.eta_minutes != null && data.target) {
            setEta({ minutes: data.eta_minutes as number, target: data.target as "pickup" | "dropoff" });
          }
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (phase === "active" && booking) openSocket();
    return () => {
      if (phase !== "active") wsRef.current?.close();
    };
  }, [phase, booking, openSocket]);

  const requestMoving = useCallback(async () => {
    if (!origin || !dest) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.createMoving({
        origin_address: origin.name ?? "Origin",
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        destination_address: dest.name ?? "Destination",
        destination_lat: dest.lat,
        destination_lng: dest.lng,
        move_type: moveType,
        truck_size: truckSize,
        move_date: moveDate || null,
        items: items ? items.split(",").map((s) => s.trim()).filter(Boolean) : null,
        note: note || null,
        payment_method: payment,
      });
      setBooking(result);
      setPhase("active");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request this move.");
    } finally {
      setBusy(false);
    }
  }, [origin, dest, moveType, truckSize, moveDate, items, note, payment]);

  const cancelMoving = useCallback(async () => {
    if (!booking) return;
    setBusy(true);
    try {
      await api.cancelMoving(booking.booking_id);
      wsRef.current?.close();
      setBooking(null);
      setDriverLocation(null);
      setEta(null);
      setPhase("form");
      setMessage("Move cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }, [booking]);

  const statusStep = useMemo(() => (booking ? STATUS_STEPS[booking.status] ?? STATUS_STEPS.requested : null), [booking]);

  const openChat = useCallback(() => {
    if (!booking) return;
    router.push({ pathname: "/chat", params: { entity: "moving", entity_id: booking.booking_id, title: booking.driver?.name ?? "Your mover" } });
  }, [booking, router]);

  const callMover = useCallback(async () => {
    if (!booking) return;
    try {
      const contact = await api.chatContact("moving", booking.booking_id);
      if (!contact.phone) {
        Alert.alert("No number", "No phone number is available for this mover yet.");
        return;
      }
      Linking.openURL(`tel:${contact.phone}`).catch(() => Alert.alert("Call failed", "Could not open the dialer."));
    } catch {
      Alert.alert("Not available", "Calling is not available for this job yet.");
    }
  }, [booking]);
  const banned = quote && !quote.allowed;

  const liveStep = (step: string) => {
    const steps = ["requested", "accepted", "in_progress"];
    return step === "completed" ? 3 : steps.indexOf(step);
  };

  if (phase === "active" && booking) {
    const stepIdx = liveStep(booking.status);
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Ionicons name="home" size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{statusStep?.label}</Text>
              <Text style={styles.subtitle}>{booking.origin_address} → {booking.destination_address}</Text>
            </View>
            {booking.status === "requested" ? (
              <TouchableOpacity onPress={cancelMoving} disabled={busy} testID="moving-cancel-button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {booking.origin_lat != null && booking.origin_lng != null && booking.destination_lat != null && booking.destination_lng != null ? (
            <View style={styles.mapSpacer}>
              <LiveMap
                pickup={{ lat: booking.origin_lat, lng: booking.origin_lng }}
                dropoff={{ lat: booking.destination_lat, lng: booking.destination_lng }}
                driver={driverLocation ?? (booking.driver?.current_lat != null && booking.driver?.current_lng != null ? { lat: booking.driver.current_lat, lng: booking.driver.current_lng } : null)}
                driverLabel={booking.driver?.name ?? "Mover"}
              />
            </View>
          ) : null}

          {booking.driver && eta ? (
            <View style={styles.etaBanner} testID="moving-eta-banner">
              <View style={styles.etaIcon}><Ionicons name="navigate" size={16} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.etaTitle}>{eta.target === "dropoff" ? "Arriving at destination" : "Mover is on the way"}</Text>
                <Text style={styles.etaSub}>{eta.target === "dropoff" ? "Estimated arrival, updates live" : "Reaching your origin, updates live"}</Text>
              </View>
              <Text style={styles.etaValue}>~{eta.minutes} min</Text>
            </View>
          ) : null}

          <View style={styles.timeline}>
            {["requested", "accepted", "in_progress"].map((s, i) => (
              <View key={s} style={styles.stepRow} testID={`moving-step-${s}`}>
                <View style={styles.stepIconWrap}>
                  <View style={[styles.stepDot, i <= stepIdx && styles.stepDotActive]} />
                  <Ionicons name={STATUS_STEPS[s].icon} size={15} color={i <= stepIdx ? colors.primary : colors.border} />
                </View>
                <Text style={[styles.stepLabel, i <= stepIdx && styles.stepLabelActive]}>{STATUS_STEPS[s].label}</Text>
              </View>
            ))}
          </View>

          {booking.driver ? (
            <>
              <View style={styles.driverCard} testID="moving-driver-card">
                <View style={styles.driverAvatar}>{booking.driver.profile_photo ? <Image source={{ uri: booking.driver.profile_photo }} style={styles.driverPhoto} /> : <Ionicons name="person" size={20} color="#fff" />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{booking.driver.name ?? "Your mover"}</Text>
                  <Text style={styles.driverMeta}>{(booking.driver.vehicle_model ?? "Truck")} · {booking.driver.vehicle_color ?? ""} · {booking.driver.vehicle_plate ?? ""}</Text>
                </View>
                <View style={styles.driverRating}><Ionicons name="star" size={13} color={colors.secondaryDark} /><Text style={styles.driverRatingText}>{booking.driver.rating.toFixed(1)}</Text></View>
              </View>
              <View style={styles.jobActions}>
                <TouchableOpacity style={styles.jobButton} onPress={openChat} disabled={busy} testID="moving-chat"><Ionicons name="chatbubble-ellipses" size={15} color={colors.primary} /><Text style={styles.jobButtonText}>Message</Text></TouchableOpacity>
                <TouchableOpacity style={styles.jobButton} onPress={callMover} disabled={busy} testID="moving-call"><Ionicons name="call" size={15} color={colors.primary} /><Text style={styles.jobButtonText}>Call</Text></TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.searching} testID="moving-searching">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.searchingText}>Notifying nearby movers…</Text>
            </View>
          )}

          <View style={styles.fareCard}>
            <Text style={styles.fareLabel}>Moving quote</Text>
            <Text style={styles.fareValue}>₦{booking.quote_amount?.toLocaleString() ?? "—"}</Text>
            <Text style={styles.fareMeta}>{booking.distance_km != null ? `${booking.distance_km.toFixed(1)} km · ` : ""}{MOVE_LABELS[booking.move_type as MovingType] ?? booking.move_type} · {TRUCK_LABELS[booking.truck_size as TruckSize] ?? booking.truck_size} truck · {PAYMENT_LABELS[booking.payment_method ?? "cash"]}</Text>
          </View>

          {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="home" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Book a move</Text><Text style={styles.subtitle}>Home and office relocation with trucks.</Text></View></View>

        <View style={styles.mapWrap}>
          <BookingMap
            pickup={origin ? { lat: origin.lat, lng: origin.lng } : null}
            dropoff={dest ? { lat: dest.lat, lng: dest.lng } : null}
            onPickLocation={tapMap}
            onUseMyLocation={getMyLocation}
            locating={locating}
            height={320}
          />
        </View>

        <View style={styles.locSearch}>
          <View style={styles.pickupRow}>
            <PlaceAutocomplete
              placeholder="Moving from (origin)"
              value={origin}
              onChange={setOrigin}
              style={styles.pickupAutocomplete}
            />
            <TouchableOpacity style={styles.gpsBtn} onPress={getMyLocation} disabled={locating}>
              {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate" size={20} color={colors.primary} />}
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />
          <PlaceAutocomplete
            placeholder="Moving to (destination)"
            value={dest}
            onChange={setDest}
          />
        </View>

        <Text style={styles.section}>Move type</Text>
        <View style={styles.optionRow}>
          {MOVE_TYPES.map((m) => (
            <TouchableOpacity key={m} onPress={() => setMoveType(m)} style={[styles.optionChip, moveType === m && styles.optionChipActive]}>
              <Text style={[styles.optionChipText, moveType === m && styles.optionChipTextActive]}>{MOVE_LABELS[m]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>Truck size</Text>
        <View style={styles.optionRow}>
          {TRUCK_SIZES.map((s) => (
            <TouchableOpacity key={s} onPress={() => setTruckSize(s)} style={[styles.optionChip, truckSize === s && styles.optionChipActive]}>
              <Text style={[styles.optionChipText, truckSize === s && styles.optionChipTextActive]}>{TRUCK_LABELS[s]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.fieldCard}>
          <TextInput
            style={styles.input}
            placeholder="Move date (e.g. 2026-08-15) — optional"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            value={moveDate}
            onChangeText={setMoveDate}
          />
          <TextInput
            style={styles.input}
            placeholder="Items to move (comma separated) — optional"
            placeholderTextColor={colors.textSecondary}
            value={items}
            onChangeText={setItems}
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Note to mover — optional"
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={2}
            value={note}
            onChangeText={setNote}
          />
        </View>

        {banned ? (
          <View style={styles.bannedCard}>
            <Ionicons name="alert-circle" size={17} color={colors.delayed} />
            <Text style={styles.bannedText}>{quote?.reason ?? "No movers available on this route."}</Text>
          </View>
        ) : quote ? (
          <View style={styles.fareCard} testID="moving-estimate">
            <Text style={styles.fareLabel}>Moving estimate</Text>
            <Text style={styles.fareValue}>₦{quote.fee.toLocaleString()}</Text>
            <Text style={styles.fareMeta}>{quote.distance_km.toFixed(1)} km · ~{quote.eta_minutes} min</Text>
            <View style={styles.paymentRow}>
              {PAYMENT_METHODS.map((m) => (
                <TouchableOpacity key={m} onPress={() => setPayment(m)} style={[styles.paymentChip, payment === m && styles.paymentChipActive]}>
                  <Text style={[styles.paymentChipText, payment === m && styles.paymentChipTextActive]}>{PAYMENT_LABELS[m]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : origin && dest ? (
          <View style={styles.status}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.statusText}>Calculating moving quote…</Text></View>
        ) : null}

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        <TouchableOpacity style={[styles.primaryButton, (busy || banned || !origin || !dest) && { opacity: 0.5 }]} onPress={requestMoving} disabled={busy || banned || !origin || !dest} testID="moving-request-button">
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="home" size={18} color="#fff" /><Text style={styles.primaryText}>Request mover</Text></>}
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
  mapWrap: { marginTop: spacing.md },
  locSearch: { marginTop: spacing.md },
  pickupRow: { flexDirection: "row", gap: 9, alignItems: "flex-start" },
  pickupAutocomplete: { flex: 1, zIndex: 30 },
  gpsBtn: { width: 48, height: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 9 },
  optionRow: { flexDirection: "row", gap: 8 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  optionChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  optionChipTextActive: { color: colors.primary },
  fieldCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, marginTop: 14, gap: 4 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, fontWeight: "600", backgroundColor: colors.input },
  multiline: { minHeight: 64, textAlignVertical: "top" },
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
  driverCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, marginTop: spacing.md },
  driverAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  driverPhoto: { width: 44, height: 44, borderRadius: 22 },
  driverName: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  driverMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  driverRating: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.secondaryLight, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  driverRatingText: { color: colors.secondaryDark, fontSize: 12, fontWeight: "900" },
  jobActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  jobButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card },
  jobButtonText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  searching: { flexDirection: "row", gap: 10, padding: 15, borderRadius: radii.lg, marginTop: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  searchingText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  mapSpacer: { marginTop: spacing.md },
  etaBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.primaryDark, borderRadius: radii.lg, padding: 14, marginTop: spacing.md },
  etaIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  etaTitle: { color: "#fff", fontSize: 14, fontWeight: "900" },
  etaSub: { color: "#D1FAE5", fontSize: 11, fontWeight: "600", marginTop: 1 },
  etaValue: { color: "#fff", fontSize: 20, fontWeight: "900" },
});
