// Delivery: book a parcel/food/document courier and track it live.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api, ridesWsUrl, type DeliveryOut, type DeliveryPackageType, type DeliveryQuoteOut, type Place } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";
import LiveMap from "@/src/components/live-map";
import BookingMap from "@/src/components/booking-map";
import PlaceAutocomplete from "@/src/components/place-autocomplete";

const PACKAGE_TYPES: DeliveryPackageType[] = ["parcel", "food", "document", "groceries", "other"];
const PACKAGE_LABELS: Record<DeliveryPackageType, string> = {
  parcel: "Parcel",
  food: "Food",
  document: "Document",
  groceries: "Groceries",
  other: "Other",
};
const PAYMENT_METHODS = ["cash", "card", "transfer", "wallet"];
const PAYMENT_LABELS: Record<string, string> = { cash: "Cash", card: "Card", transfer: "Transfer", wallet: "Wallet" };

const STATUS_STEPS: Record<string, { label: string; icon: "time" | "cube" | "bag-handle" | "navigate" | "flag" }> = {
  requested: { label: "Finding a courier", icon: "time" },
  accepted: { label: "Courier on the way to pickup", icon: "cube" },
  picked_up: { label: "Parcel picked up", icon: "bag-handle" },
  in_transit: { label: "On the way to recipient", icon: "navigate" },
  delivered: { label: "Delivered", icon: "flag" },
};

export default function DeliveryScreen() {
  const router = useRouter();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [packageType, setPackageType] = useState<DeliveryPackageType>("parcel");
  const [weight, setWeight] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState("cash");
  const [quote, setQuote] = useState<DeliveryQuoteOut | null>(null);
  const [phase, setPhase] = useState<"form" | "active">("form");
  const [order, setOrder] = useState<DeliveryOut | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [eta, setEta] = useState<{ minutes: number; target: "pickup" | "dropoff" } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const nameCurrentPosition = useCallback(async (lat: number, lng: number) => {
    const fallback: Place = { name: "My current location", lat, lng, state: null, city: null, category: null };
    try {
      const place = await api.reverseGeocode(lat, lng);
      setPickup({ ...place, name: place.name || "My current location" });
    } catch {
      setPickup(fallback);
    }
  }, []);

  const getMyLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setPickup({ name: "Permission denied — search for pickup", lat: 6.5244, lng: 3.3792, state: null, city: null, category: null });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await nameCurrentPosition(pos.coords.latitude, pos.coords.longitude);
    } catch {
      setMessage("Could not get your location. Try searching for pickup instead.");
    } finally {
      setLocating(false);
    }
  }, [locating, nameCurrentPosition]);

  useEffect(() => {
    getMyLocation();
  }, []);

  const tapMap = useCallback((lat: number, lng: number) => {
    setDropoff({ name: "Pinned on map", lat, lng, state: null, city: null, category: null });
    api.reverseGeocode(lat, lng)
      .then((place) => setDropoff((prev) => (prev && prev.lat === lat && prev.lng === lng ? { ...place, name: place.name || "Pinned on map" } : prev)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    api.deliveryQuote({
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      package_type: packageType,
      weight_kg: weight ? Number(weight) : null,
    })
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [pickup, dropoff, packageType, weight]);

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
        if (data.event === "delivery.status" || data.event === "delivery.accepted") {
          const id = data.delivery_id as string;
          setOrder((prev) => (prev && prev.delivery_id === id ? { ...prev, status: data.status as string } : prev));
          api.getDelivery(id).then(setOrder).catch(() => {});
        } else if (data.event === "delivery.completed") {
          const id = data.delivery_id as string;
          api.getDelivery(id).then(setOrder).catch(() => {});
        } else if (data.event === "driver.location" && data.delivery_id) {
          setDriverLocation({ lat: data.lat as number, lng: data.lng as number });
          if (data.eta_minutes != null && data.target) {
            setEta({ minutes: data.eta_minutes as number, target: data.target as "pickup" | "dropoff" });
          }
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (phase === "active" && order) openSocket();
    return () => {
      if (phase !== "active") wsRef.current?.close();
    };
  }, [phase, order, openSocket]);

  const requestDelivery = useCallback(async () => {
    if (!pickup || !dropoff) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.createDelivery({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_address: pickup.name ?? "My location",
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        dropoff_address: dropoff.name ?? "Recipient address",
        package_type: packageType,
        weight_kg: weight ? Number(weight) : null,
        recipient_name: recipientName || null,
        recipient_phone: recipientPhone || null,
        note: note || null,
        payment_method: payment,
      });
      setOrder(result);
      setPhase("active");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request this delivery.");
    } finally {
      setBusy(false);
    }
  }, [pickup, dropoff, packageType, weight, recipientName, recipientPhone, note, payment]);

  const cancelDelivery = useCallback(async () => {
    if (!order) return;
    setBusy(true);
    try {
      await api.cancelDelivery(order.delivery_id);
      wsRef.current?.close();
      setOrder(null);
      setDriverLocation(null);
      setEta(null);
      setPhase("form");
      setMessage("Delivery cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }, [order]);

  const statusStep = useMemo(() => (order ? STATUS_STEPS[order.status] ?? STATUS_STEPS.requested : null), [order]);
  const banned = quote && !quote.allowed;

  const openChat = useCallback(() => {
    if (!order) return;
    router.push({ pathname: "/chat", params: { entity: "delivery", entity_id: order.delivery_id, title: order.driver?.name ?? "Your courier" } });
  }, [order, router]);

  const callCourier = useCallback(async () => {
    if (!order) return;
    try {
      const contact = await api.chatContact("delivery", order.delivery_id);
      if (!contact.phone) {
        Alert.alert("No number", "No phone number is available for this courier yet.");
        return;
      }
      Linking.openURL(`tel:${contact.phone}`).catch(() => Alert.alert("Call failed", "Could not open the dialer."));
    } catch {
      Alert.alert("Not available", "Calling is not available for this job yet.");
    }
  }, [order]);

  const liveStep = (step: string) => {
    const orderSteps = ["requested", "accepted", "picked_up", "in_transit"];
    return step === "delivered" ? 4 : orderSteps.indexOf(step);
  };

  if (phase === "active" && order) {
    const stepIdx = liveStep(order.status);
    const liveEta = eta;
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Ionicons name="cube" size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{statusStep?.label}</Text>
              <Text style={styles.subtitle}>{order.pickup_address ?? "Pickup"} → {order.dropoff_address ?? "Recipient"}</Text>
            </View>
            {order.status === "requested" ? (
              <TouchableOpacity onPress={cancelDelivery} disabled={busy} testID="delivery-cancel-button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.mapSpacer}>
            <LiveMap
              pickup={{ lat: order.pickup_lat, lng: order.pickup_lng }}
              dropoff={{ lat: order.dropoff_lat, lng: order.dropoff_lng }}
              driver={driverLocation ?? (order.driver?.current_lat != null && order.driver?.current_lng != null ? { lat: order.driver.current_lat, lng: order.driver.current_lng } : null)}
              driverLabel={order.driver?.name ?? "Courier"}
            />
          </View>

          {order.driver && liveEta ? (
            <View style={styles.etaBanner} testID="delivery-eta-banner">
              <View style={styles.etaIcon}><Ionicons name="navigate" size={16} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.etaTitle}>{liveEta.target === "dropoff" ? "Arriving at recipient" : "Courier is on the way"}</Text>
                <Text style={styles.etaSub}>{liveEta.target === "dropoff" ? "Estimated arrival, updates live" : "Reaching the pickup, updates live"}</Text>
              </View>
              <Text style={styles.etaValue}>~{liveEta.minutes} min</Text>
            </View>
          ) : null}

          <View style={styles.timeline}>
            {["requested", "accepted", "picked_up", "in_transit"].map((s, i) => (
              <View key={s} style={styles.stepRow} testID={`delivery-step-${s}`}>
                <View style={styles.stepIconWrap}>
                  <View style={[styles.stepDot, i <= stepIdx && styles.stepDotActive]} />
                  <Ionicons name={STATUS_STEPS[s].icon} size={15} color={i <= stepIdx ? colors.primary : colors.border} />
                </View>
                <Text style={[styles.stepLabel, i <= stepIdx && styles.stepLabelActive]}>{STATUS_STEPS[s].label}</Text>
              </View>
            ))}
          </View>

          {order.driver ? (
            <>
              <View style={styles.driverCard} testID="delivery-driver-card">
                <View style={styles.driverAvatar}>{order.driver.profile_photo ? <Image source={{ uri: order.driver.profile_photo }} style={styles.driverPhoto} /> : <Ionicons name="person" size={20} color="#fff" />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{order.driver.name ?? "Your courier"}</Text>
                  <Text style={styles.driverMeta}>{(order.driver.vehicle_model ?? "Vehicle")} · {order.driver.vehicle_color ?? ""} · {order.driver.vehicle_plate ?? ""}</Text>
                </View>
                <View style={styles.driverRating}><Ionicons name="star" size={13} color={colors.secondaryDark} /><Text style={styles.driverRatingText}>{order.driver.rating.toFixed(1)}</Text></View>
              </View>
              <View style={styles.jobActions}>
                <TouchableOpacity style={styles.jobButton} onPress={openChat} disabled={busy} testID="delivery-chat"><Ionicons name="chatbubble-ellipses" size={15} color={colors.primary} /><Text style={styles.jobButtonText}>Message</Text></TouchableOpacity>
                <TouchableOpacity style={styles.jobButton} onPress={callCourier} disabled={busy} testID="delivery-call"><Ionicons name="call" size={15} color={colors.primary} /><Text style={styles.jobButtonText}>Call</Text></TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.searching} testID="delivery-searching">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.searchingText}>Notifying nearby couriers…</Text>
            </View>
          )}

          <View style={styles.fareCard}>
            <Text style={styles.fareLabel}>Delivery fee</Text>
            <Text style={styles.fareValue}>₦{order.delivery_fee.toLocaleString()}</Text>
            <Text style={styles.fareMeta}>{order.distance_km.toFixed(1)} km · {order.package_type} · {PAYMENT_LABELS[order.payment_method ?? "cash"]}</Text>
            {order.recipient_name ? <Text style={styles.fareMeta}>Recipient: {order.recipient_name}{order.recipient_phone ? ` · ${order.recipient_phone}` : ""}</Text> : null}
          </View>

          {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="cube" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Send a parcel</Text><Text style={styles.subtitle}>Packages, food, documents — door to door.</Text></View></View>

        <View style={styles.mapWrap}>
          <BookingMap
            pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
            dropoff={dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null}
            onPickLocation={tapMap}
            onUseMyLocation={getMyLocation}
            locating={locating}
            height={320}
          />
        </View>

        <View style={styles.locSearch}>
          <View style={styles.pickupRow}>
            <PlaceAutocomplete
              placeholder="Pickup location"
              value={pickup}
              onChange={setPickup}
              style={styles.pickupAutocomplete}
            />
            <TouchableOpacity style={styles.gpsBtn} onPress={getMyLocation} disabled={locating}>
              {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate" size={20} color={colors.primary} />}
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />
          <PlaceAutocomplete
            placeholder="Where should we deliver?"
            value={dropoff}
            onChange={setDropoff}
          />
        </View>

        <Text style={styles.section}>Package type</Text>
        <View style={styles.packageRow}>
          {PACKAGE_TYPES.map((p) => (
            <TouchableOpacity key={p} onPress={() => setPackageType(p)} style={[styles.packageChip, packageType === p && styles.packageChipActive]}>
              <Text style={[styles.packageChipText, packageType === p && styles.packageChipTextActive]}>{PACKAGE_LABELS[p]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.fieldCard}>
          <TextInput
            style={styles.input}
            placeholder="Weight (kg) — optional"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            value={weight}
            onChangeText={setWeight}
          />
          <TextInput
            style={styles.input}
            placeholder="Recipient name — optional"
            placeholderTextColor={colors.textSecondary}
            value={recipientName}
            onChangeText={setRecipientName}
          />
          <TextInput
            style={styles.input}
            placeholder="Recipient phone — optional"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            value={recipientPhone}
            onChangeText={setRecipientPhone}
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Note to courier — optional"
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
            <Text style={styles.bannedText}>{quote?.reason ?? "No couriers available on this route."}</Text>
          </View>
        ) : quote ? (
          <View style={styles.fareCard} testID="delivery-estimate">
            <Text style={styles.fareLabel}>Delivery estimate</Text>
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
        ) : pickup && dropoff ? (
          <View style={styles.status}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.statusText}>Calculating delivery fee…</Text></View>
        ) : null}

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        <TouchableOpacity style={[styles.primaryButton, (busy || banned || !pickup || !dropoff) && { opacity: 0.5 }]} onPress={requestDelivery} disabled={busy || banned || !pickup || !dropoff} testID="delivery-request-button">
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="cube" size={18} color="#fff" /><Text style={styles.primaryText}>Request courier</Text></>}
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
  packageRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  packageChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  packageChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  packageChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  packageChipTextActive: { color: colors.primary },
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
