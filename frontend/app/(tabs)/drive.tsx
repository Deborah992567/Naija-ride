import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api, ridesWsUrl, type DeliveryOut, type DriverEta, type DriverProfile, type DriverVerification, type MovingOut, type RideOut, type VehicleType } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";
import LiveMap from "@/src/components/live-map";
import { useAuth } from "@/src/lib/auth";
import { getRoute, estimateEtaSeconds, etaLabel, type RouteResult } from "@/src/lib/routing";

const HEARTBEAT_MS = 10000;

export default function DriveScreen() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [verification, setVerification] = useState<DriverVerification | null>(null);
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
  const [delivery, setDelivery] = useState<DeliveryOut | null>(null);
  const [incomingDelivery, setIncomingDelivery] = useState<DeliveryOut | null>(null);
  const [moving, setMoving] = useState<MovingOut | null>(null);
  const [incomingMoving, setIncomingMoving] = useState<MovingOut | null>(null);
  const [eta, setEta] = useState<DriverEta | null>(null);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [nav, setNav] = useState<{ route: [number, number][]; etaSeconds: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);
  const rideIdRef = useRef<string | null>(null);
  const deliveryIdRef = useRef<string | null>(null);
  const movingIdRef = useRef<string | null>(null);

  useEffect(() => {
    rideIdRef.current = ride?.ride_id ?? null;
  }, [ride]);

  useEffect(() => {
    deliveryIdRef.current = delivery?.delivery_id ?? null;
  }, [delivery]);

  useEffect(() => {
    movingIdRef.current = moving?.booking_id ?? null;
  }, [moving]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [p, v] = await Promise.all([
        api.driverMe(),
        api.getDriverVerification().catch(() => null),
      ]);
      setProfile(p);
      setVerification(v);
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

  const refreshNav = useCallback(async () => {
    if (!ride || ride.status !== "in_progress") {
      setNav(null);
      return;
    }
    try {
      const pos = await getPosition();
      setDriverLoc(pos);
      const dropoff = { lat: ride.dropoff_lat, lng: ride.dropoff_lng };
      let result: RouteResult;
      try {
        result = await getRoute(pos, dropoff);
      } catch {
        result = {
          coordinates: [
            [pos.lng, pos.lat],
            [dropoff.lng, dropoff.lat],
          ],
          durationSeconds: estimateEtaSeconds(pos, dropoff),
          distanceMeters: 0,
        };
      }
      setNav({ route: result.coordinates, etaSeconds: result.durationSeconds });
    } catch {}
  }, [ride, getPosition]);

  useEffect(() => {
    if (ride?.status !== "in_progress") return;
    refreshNav();
    const id = setInterval(refreshNav, 15000);
    return () => clearInterval(id);
  }, [ride?.status, refreshNav]);

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
          const data = JSON.parse(event.data) as { event: string; [k: string]: unknown };
          if (data.event === "ride.request") {
            setIncoming(data as unknown as RideOut);
          } else if (data.event === "delivery.request") {
            setIncomingDelivery(data as unknown as DeliveryOut);
          } else if (data.event === "moving.request") {
            setIncomingMoving(data as unknown as MovingOut);
          } else if (data.event === "driver.eta") {
            if (data.ride_id === rideIdRef.current) {
              setEta({ minutes: data.eta_minutes as number, target: data.target as "pickup" | "dropoff" });
            }
          } else if (data.event === "ride.cancelled") {
            setIncoming(null);
            setMessage("A rider cancelled their request.");
          } else if (data.event === "delivery.cancelled") {
            setIncomingDelivery(null);
            setMessage("A delivery request was cancelled.");
          } else if (data.event === "moving.cancelled") {
            setIncomingMoving(null);
            setMessage("A moving request was cancelled.");
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
    setIncomingDelivery(null);
    setIncomingMoving(null);
    const loc = locationRef.current;
    try {
      if (loc) {
        const p = await api.driverStatus(false, loc.lat, loc.lng);
        setProfile(p);
      }
    } catch {}
    setOnline(false);
    setRide(null);
    setDelivery(null);
    setMoving(null);
    setEta(null);
    setDriverLoc(null);
    setNav(null);
    setMessage("You are offline.");
  }, []);

  const accept = useCallback(async (rideId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.acceptRide(rideId);
      setRide(r);
      setIncoming(null);
      setEta(r.driver_eta_minutes != null ? { minutes: r.driver_eta_minutes, target: "pickup" } : null);
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

  const acceptDeliveryJob = useCallback(async (deliveryId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const d = await api.acceptDelivery(deliveryId);
      setDelivery(d);
      setIncomingDelivery(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept delivery.");
    } finally {
      setBusy(false);
    }
  }, []);

  const declineDeliveryJob = useCallback(async () => {
    setIncomingDelivery(null);
  }, []);

  const acceptMovingJob = useCallback(async (bookingId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const m = await api.acceptMoving(bookingId);
      setMoving(m);
      setIncomingMoving(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept move.");
    } finally {
      setBusy(false);
    }
  }, []);

  const declineMovingJob = useCallback(async () => {
    setIncomingMoving(null);
  }, []);

  const advanceDelivery = useCallback(async (action: "pickup" | "start" | "complete") => {
    if (!delivery) return;
    setBusy(true);
    setMessage(null);
    try {
      let d: DeliveryOut;
      if (action === "pickup") d = await api.pickupDelivery(delivery.delivery_id);
      else if (action === "start") d = await api.startDelivery(delivery.delivery_id);
      else d = await api.completeDelivery(delivery.delivery_id);
      setDelivery(d);
      if (action === "complete") {
        setMessage(`Delivery complete — fee ₦${d.delivery_fee.toLocaleString()} (${d.payment_method ?? "cash"}).`);
        setTimeout(() => setDelivery(null), 2000);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, [delivery]);

  const advanceMoving = useCallback(async (action: "start" | "complete") => {
    if (!moving) return;
    setBusy(true);
    setMessage(null);
    try {
      let m: MovingOut;
      if (action === "start") m = await api.startMoving(moving.booking_id);
      else m = await api.completeMoving(moving.booking_id);
      setMoving(m);
      if (action === "complete") {
        setMessage(`Move complete — fee ₦${m.quote_amount?.toLocaleString() ?? "—"} (${m.payment_method ?? "cash"}).`);
        setTimeout(() => setMoving(null), 2000);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, [moving]);

  const advance = useCallback(async (action: "arrive" | "start" | "complete") => {
    if (!ride) return;
    setBusy(true);
    setMessage(null);
    try {
      if (action === "complete") {
        const trip = await api.completeRide(ride.ride_id);
        setRide(null);
        setEta(null);
        setMessage(`Trip complete — rider owes ₦${trip.fare.toLocaleString()} (${trip.payment_method}).`);
      } else {
        const r = action === "arrive" ? await api.arriveRide(ride.ride_id) : await api.startRide(ride.ride_id);
        setRide(r);
        if (action === "start") setEta(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, [ride]);

  const sos = useCallback(async () => {
    if (!ride) return;
    Alert.alert("Raise SOS?", "This alerts the safety team and the rider on this trip.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Raise SOS",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setMessage(null);
          try {
            await api.raiseEmergency({ ride_id: ride.ride_id });
            setMessage("SOS raised. Help is on the way.");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not raise SOS.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [ride]);

  const openChat = useCallback(() => {
    if (!ride) return;
    router.push({ pathname: "/chat", params: { entity: "ride", entity_id: ride.ride_id, title: "Rider" } });
  }, [ride, router]);

  const openDeliveryChat = useCallback(() => {
    if (!delivery) return;
    router.push({ pathname: "/chat", params: { entity: "delivery", entity_id: delivery.delivery_id, title: "Customer" } });
  }, [delivery, router]);

  const openMovingChat = useCallback(() => {
    if (!moving) return;
    router.push({ pathname: "/chat", params: { entity: "moving", entity_id: moving.booking_id, title: "Customer" } });
  }, [moving, router]);

  const callJob = useCallback(async (entity: "ride" | "delivery" | "moving", entity_id: string) => {
    try {
      const contact = await api.chatContact(entity, entity_id);
      if (!contact.phone) {
        Alert.alert("No number", "No phone number is available for this person yet.");
        return;
      }
      Linking.openURL(`tel:${contact.phone}`).catch(() => Alert.alert("Call failed", "Could not open the dialer."));
    } catch {
      Alert.alert("Not available", "Calling is not available for this job yet.");
    }
  }, []);

  const register = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const p = await api.driverRegister({ vehicle_type: vehicle, vehicle_plate: plate, vehicle_color: color, vehicle_model: model, phone });
      setProfile(p);
      setNeedsRegister(false);
      await refresh();
      setMessage("Driver profile saved. Go online to receive requests.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setBusy(false);
    }
  }, [vehicle, plate, color, model, phone, refresh]);

  if (loading) return <SafeAreaView style={styles.root}><ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} /></SafeAreaView>;

  if (needsRegister) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="car" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Earn with Naija Ride</Text><Text style={styles.subtitle}>Drive passengers in your car or deliver parcels on your bike.</Text></View></View>

          <Text style={styles.section}>Vehicle type</Text>
          <View style={styles.vehicleRow}>
            {(["car", "bike"] as VehicleType[]).map((v) => (
              <TouchableOpacity key={v} onPress={() => setVehicle(v)} style={[styles.vehicleCard, vehicle === v && styles.vehicleCardActive]} testID={`driver-vehicle-${v}`}>
                <Ionicons name={v === "car" ? "car" : "bicycle"} size={22} color={vehicle === v ? colors.primary : colors.textSecondary} />
                <Text style={[styles.vehicleLabel, vehicle === v && styles.vehicleLabelActive]}>{v === "car" ? "Car" : "Bike"}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.section}>Vehicle details</Text>
          <TextInput style={styles.input} placeholder="Plate number (e.g. LAG-123)" placeholderTextColor={colors.textSecondary} value={plate} onChangeText={setPlate} autoCapitalize="characters" testID="driver-plate-input" />
          <TextInput style={styles.input} placeholder="Colour (e.g. Blue)" placeholderTextColor={colors.textSecondary} value={color} onChangeText={setColor} testID="driver-color-input" />
          <TextInput style={styles.input} placeholder="Model (e.g. Toyota Camry)" placeholderTextColor={colors.textSecondary} value={model} onChangeText={setModel} testID="driver-model-input" />
          <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor={colors.textSecondary} value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="driver-phone-input" />

        <TouchableOpacity style={styles.verifyLink} onPress={() => router.push("/verify-driver")} testID="driver-verify-link">
          <Ionicons name="shield-checkmark" size={16} color={colors.primary} />
          <Text style={styles.verifyLinkText}>Verify your documents</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

          <TouchableOpacity style={[styles.primaryButton, busy && { opacity: 0.7 }]} onPress={register} disabled={busy} testID="driver-register-button">
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.primaryText}>Save driver profile</Text></>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const meta = profile ? `${profile.vehicle_type === "car" ? "Car" : "Bike"}${profile.vehicle_model ? ` · ${profile.vehicle_model}` : ""}${profile.vehicle_plate ? ` · ${profile.vehicle_plate}` : ""}` : "";

  const verifyStatus = verification?.verification_status ?? "unverified";
  const verifyTone =
    verifyStatus === "verified"
      ? { bg: colors.empty, icon: "shield-checkmark" as const, title: "Verified", text: "Your documents are approved — you can go online and earn." }
      : verifyStatus === "pending"
        ? { bg: colors.moderate, icon: "time" as const, title: "Verification pending", text: "Your documents are under review by our team." }
        : verifyStatus === "rejected"
          ? { bg: colors.delayed, icon: "close-circle" as const, title: "Verification rejected", text: "Your documents were rejected — tap to resubmit." }
          : { bg: colors.textSecondary, icon: "shield-outline" as const, title: "Not verified", text: "Complete your verification to go online and receive jobs." };

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

        <TouchableOpacity style={[styles.verifyBanner, { backgroundColor: `${verifyTone.bg}1A`, borderColor: verifyTone.bg }]} onPress={() => router.push("/verify-driver")} testID="driver-verification-banner">
          <View style={[styles.verifyBannerIcon, { backgroundColor: verifyTone.bg }]}>
            <Ionicons name={verifyTone.icon} size={16} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.verifyBannerTitle, { color: verifyTone.bg }]}>{verifyTone.title}</Text>
            <Text style={styles.verifyBannerText}>{verifyTone.text}</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={verifyTone.bg} />
        </TouchableOpacity>

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

        {incomingDelivery ? (
          <View style={styles.requestCard} testID="driver-delivery-request-card">
            <View style={styles.requestHeader}><Ionicons name="cube" size={17} color={colors.secondaryDark} /><Text style={styles.requestTitle}>New delivery request</Text></View>
            <View style={styles.requestRow}><Ionicons name="location" size={16} color={colors.primary} /><Text style={styles.requestText}>{incomingDelivery.pickup_address ?? "Pickup"}</Text></View>
            <View style={styles.requestRow}><Ionicons name="flag" size={16} color={colors.delayed} /><Text style={styles.requestText}>{incomingDelivery.dropoff_address ?? "Recipient"}</Text></View>
            {incomingDelivery.recipient_name ? <View style={styles.requestRow}><Ionicons name="person" size={16} color={colors.textSecondary} /><Text style={styles.requestText}>{incomingDelivery.recipient_name}{incomingDelivery.recipient_phone ? ` · ${incomingDelivery.recipient_phone}` : ""}</Text></View> : null}
            <View style={styles.requestMeta}>
              <Text style={styles.requestFare}>₦{incomingDelivery.delivery_fee.toLocaleString()}</Text>
              <Text style={styles.requestDist}>{incomingDelivery.distance_km.toFixed(1)} km</Text>
              <Text style={styles.requestDist}>{incomingDelivery.package_type}</Text>
            </View>
            <View style={styles.requestActions}>
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => acceptDeliveryJob(incomingDelivery.delivery_id)} disabled={busy} testID="driver-accept-delivery">{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept</Text>}</TouchableOpacity>
              <TouchableOpacity style={styles.declineButton} onPress={declineDeliveryJob} disabled={busy} testID="driver-decline-delivery"><Text style={styles.declineText}>Decline</Text></TouchableOpacity>
            </View>
          </View>
        ) : null}

        {incomingMoving ? (
          <View style={styles.requestCard} testID="driver-moving-request-card">
            <View style={styles.requestHeader}><Ionicons name="home" size={17} color={colors.secondaryDark} /><Text style={styles.requestTitle}>New moving request</Text></View>
            <View style={styles.requestRow}><Ionicons name="location" size={16} color={colors.primary} /><Text style={styles.requestText}>{incomingMoving.origin_address}</Text></View>
            <View style={styles.requestRow}><Ionicons name="flag" size={16} color={colors.delayed} /><Text style={styles.requestText}>{incomingMoving.destination_address}</Text></View>
            <View style={styles.requestMeta}>
              <Text style={styles.requestFare}>₦{incomingMoving.quote_amount?.toLocaleString() ?? "—"}</Text>
              <Text style={styles.requestDist}>{incomingMoving.truck_size ?? "medium"} truck</Text>
              {incomingMoving.distance_km != null ? <Text style={styles.requestDist}>{incomingMoving.distance_km.toFixed(1)} km</Text> : null}
            </View>
            <View style={styles.requestActions}>
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => acceptMovingJob(incomingMoving.booking_id)} disabled={busy} testID="driver-accept-moving">{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept</Text>}</TouchableOpacity>
              <TouchableOpacity style={styles.declineButton} onPress={declineMovingJob} disabled={busy} testID="driver-decline-moving"><Text style={styles.declineText}>Decline</Text></TouchableOpacity>
            </View>
          </View>
        ) : null}

        {ride ? (
          <View style={styles.activeCard} testID="driver-active-ride">
            <View style={styles.requestHeader}><Ionicons name="navigate" size={17} color={colors.primary} /><Text style={styles.requestTitle}>Active ride · {ride.status.replace("_", " ")}</Text></View>
            <View style={styles.mapSpacer}>
              <LiveMap
                pickup={{ lat: ride.pickup_lat, lng: ride.pickup_lng }}
                dropoff={{ lat: ride.dropoff_lat, lng: ride.dropoff_lng }}
                driver={driverLoc}
                route={nav?.route}
                driverLabel="You"
                height={320}
              />
            </View>
            <View style={styles.requestRow}><Ionicons name="location" size={16} color={colors.primary} /><Text style={styles.requestText}>{ride.pickup_address ?? "Pickup"}</Text></View>
            <View style={styles.requestRow}><Ionicons name="flag" size={16} color={colors.delayed} /><Text style={styles.requestText}>{ride.dropoff_address ?? "Dropoff"}</Text></View>
            <View style={styles.requestMeta}><Text style={styles.requestFare}>₦{ride.fare_estimate.toLocaleString()}</Text><Text style={styles.requestDist}>{ride.payment_method ?? "cash"}</Text></View>
            {eta ? (
              <View style={styles.etaBanner} testID="driver-eta-banner">
                <Ionicons name={eta.target === "dropoff" ? "flag" : "navigate"} size={15} color="#fff" />
                <Text style={styles.etaText}>
                  {eta.target === "dropoff" ? `Dropoff in ~${eta.minutes} min` : `Pickup in ~${eta.minutes} min`}
                </Text>
              </View>
            ) : null}
            {ride.status === "in_progress" && nav ? (
              <View style={styles.navBanner} testID="driver-nav-eta">
                <Ionicons name="navigate" size={16} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navTitle}>Trip in progress</Text>
                  <Text style={styles.navEta}>Dropping off in ~{etaLabel(nav.etaSeconds)}</Text>
                </View>
              </View>
            ) : null}
            <TouchableOpacity style={styles.driverChat} onPress={openChat} disabled={busy} testID="driver-chat"><Ionicons name="chatbubble-ellipses" size={16} color={colors.primary} /><Text style={styles.driverChatText}>Message rider</Text></TouchableOpacity>
            {ride.status === "accepted" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advance("arrive")} disabled={busy} testID="driver-arrive-button"><Text style={styles.acceptText}>I have arrived</Text></TouchableOpacity>
            ) : null}
            {ride.status === "arriving" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advance("start")} disabled={busy} testID="driver-start-button"><Text style={styles.acceptText}>Start trip</Text></TouchableOpacity>
            ) : null}
            {ride.status === "in_progress" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advance("complete")} disabled={busy} testID="driver-complete-button"><Text style={styles.acceptText}>Complete trip</Text></TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.driverSos} onPress={sos} disabled={busy} testID="driver-sos"><Ionicons name="warning" size={15} color={colors.delayed} /><Text style={styles.driverSosText}>SOS</Text></TouchableOpacity>
          </View>
        ) : null}

        {delivery ? (
          <View style={styles.activeCard} testID="driver-active-delivery">
            <View style={styles.requestHeader}><Ionicons name="cube" size={17} color={colors.primary} /><Text style={styles.requestTitle}>Active delivery · {delivery.status.replace("_", " ")}</Text></View>
            <View style={styles.requestRow}><Ionicons name="location" size={16} color={colors.primary} /><Text style={styles.requestText}>{delivery.pickup_address ?? "Pickup"}</Text></View>
            <View style={styles.requestRow}><Ionicons name="flag" size={16} color={colors.delayed} /><Text style={styles.requestText}>{delivery.dropoff_address ?? "Recipient"}</Text></View>
            {delivery.recipient_name ? <View style={styles.requestRow}><Ionicons name="person" size={16} color={colors.textSecondary} /><Text style={styles.requestText}>Recipient: {delivery.recipient_name}{delivery.recipient_phone ? ` · ${delivery.recipient_phone}` : ""}</Text></View> : null}
            <View style={styles.requestMeta}><Text style={styles.requestFare}>₦{delivery.delivery_fee.toLocaleString()}</Text><Text style={styles.requestDist}>{delivery.package_type}</Text></View>
            <View style={styles.jobActions}>
              <TouchableOpacity style={styles.driverChat} onPress={openDeliveryChat} disabled={busy} testID="driver-delivery-chat"><Ionicons name="chatbubble-ellipses" size={16} color={colors.primary} /><Text style={styles.driverChatText}>Message</Text></TouchableOpacity>
              <TouchableOpacity style={styles.driverChat} onPress={() => callJob("delivery", delivery.delivery_id)} disabled={busy} testID="driver-delivery-call"><Ionicons name="call" size={16} color={colors.primary} /><Text style={styles.driverChatText}>Call</Text></TouchableOpacity>
            </View>
            {delivery.status === "accepted" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advanceDelivery("pickup")} disabled={busy} testID="driver-pickup-button"><Text style={styles.acceptText}>Mark as picked up</Text></TouchableOpacity>
            ) : null}
            {delivery.status === "picked_up" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advanceDelivery("start")} disabled={busy} testID="driver-delivery-start-button"><Text style={styles.acceptText}>Start delivery</Text></TouchableOpacity>
            ) : null}
            {delivery.status === "in_transit" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advanceDelivery("complete")} disabled={busy} testID="driver-delivery-complete-button"><Text style={styles.acceptText}>Mark as delivered</Text></TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {moving ? (
          <View style={styles.activeCard} testID="driver-active-moving">
            <View style={styles.requestHeader}><Ionicons name="home" size={17} color={colors.primary} /><Text style={styles.requestTitle}>Active move · {moving.status.replace("_", " ")}</Text></View>
            <View style={styles.requestRow}><Ionicons name="location" size={16} color={colors.primary} /><Text style={styles.requestText}>{moving.origin_address}</Text></View>
            <View style={styles.requestRow}><Ionicons name="flag" size={16} color={colors.delayed} /><Text style={styles.requestText}>{moving.destination_address}</Text></View>
            <View style={styles.requestMeta}><Text style={styles.requestFare}>₦{moving.quote_amount?.toLocaleString() ?? "—"}</Text><Text style={styles.requestDist}>{moving.truck_size ?? "medium"} truck</Text></View>
            <View style={styles.jobActions}>
              <TouchableOpacity style={styles.driverChat} onPress={openMovingChat} disabled={busy} testID="driver-moving-chat"><Ionicons name="chatbubble-ellipses" size={16} color={colors.primary} /><Text style={styles.driverChatText}>Message</Text></TouchableOpacity>
              <TouchableOpacity style={styles.driverChat} onPress={() => callJob("moving", moving.booking_id)} disabled={busy} testID="driver-moving-call"><Ionicons name="call" size={16} color={colors.primary} /><Text style={styles.driverChatText}>Call</Text></TouchableOpacity>
            </View>
            {moving.status === "accepted" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advanceMoving("start")} disabled={busy} testID="driver-moving-start-button"><Text style={styles.acceptText}>Start move</Text></TouchableOpacity>
            ) : null}
            {moving.status === "in_progress" ? (
              <TouchableOpacity style={[styles.acceptButton, busy && { opacity: 0.7 }]} onPress={() => advanceMoving("complete")} disabled={busy} testID="driver-moving-complete-button"><Text style={styles.acceptText}>Complete move</Text></TouchableOpacity>
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
  verifyLink: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, marginTop: 12 },
  verifyLinkText: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: "800" },
  verifyBanner: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: radii.lg, padding: 14, marginTop: 12 },
  verifyBannerIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  verifyBannerTitle: { fontSize: 14, fontWeight: "900" },
  verifyBannerText: { color: colors.textPrimary, fontSize: 12, fontWeight: "600", marginTop: 2, lineHeight: 16 },
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
  etaBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primaryDark, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9, marginBottom: 10 },
  etaText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  navBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.primaryDark, borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
  navTitle: { color: "#D1FAE5", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  navEta: { color: "#fff", fontSize: 17, fontWeight: "900", marginTop: 2 },
  requestFare: { color: colors.primaryDark, fontSize: 20, fontWeight: "900" },
  requestDist: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  requestActions: { flexDirection: "row", gap: 10 },
  acceptButton: { flex: 1, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  acceptText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  declineButton: { minWidth: 96, minHeight: 48, borderRadius: radii.pill, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center" },
  declineText: { color: colors.delayed, fontSize: 14, fontWeight: "900" },
  activeCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary, borderRadius: radii.lg, padding: 16, marginTop: 16 },
  mapSpacer: { marginBottom: 12 },
  driverChat: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, marginBottom: 10 },
  driverChatText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  jobActions: { flexDirection: "row", gap: 10, marginBottom: 2 },
  driverSos: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, minHeight: 40, borderRadius: radii.pill, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  driverSosText: { color: colors.delayed, fontSize: 12, fontWeight: "900" },
});
