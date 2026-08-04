import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import { api, ridesWsUrl, type CouponValidateOut, type DriverEta, type PaymentMethod, type Place, type RideEvent, type RideOut, type RideStatus, type TripOut, type VehicleType } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";
import LiveMap from "@/src/components/live-map";
import BookingMap from "@/src/components/booking-map";
import PlaceAutocomplete from "@/src/components/place-autocomplete";

const STATUS_STEPS: Record<string, { label: string; icon: "time" | "car" | "location" | "navigate" | "flag" }> = {
  requested: { label: "Finding a driver", icon: "time" },
  accepted: { label: "Driver on the way", icon: "car" },
  arriving: { label: "Driver has arrived", icon: "location" },
  in_progress: { label: "On the way", icon: "navigate" },
  completed: { label: "Trip complete", icon: "flag" },
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: "Cash", card: "Card", transfer: "Bank transfer" };

export default function RideScreen() {
  const router = useRouter();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const vehicle: VehicleType = "car";
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof api.estimateRide>> | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponValidateOut | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [phase, setPhase] = useState<"form" | "active">("form");
  const [ride, setRide] = useState<RideOut | null>(null);
  const [trip, setTrip] = useState<TripOut | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [eta, setEta] = useState<DriverEta | null>(null);
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

  const swapPlaces = useCallback(() => {
    setPickup(dropoff);
    setDropoff(pickup);
    setCoupon(null);
    setCouponError(null);
  }, [pickup, dropoff]);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    api.estimateRide({ pickup_lat: pickup.lat, pickup_lng: pickup.lng, dropoff_lat: dropoff.lat, dropoff_lng: dropoff.lng, vehicle_type: vehicle })
      .then(setEstimate)
      .catch(() => setEstimate(null));
    setCoupon(null);
    setCouponError(null);
  }, [pickup, dropoff, vehicle]);

  const applyCoupon = useCallback(async () => {
    if (!couponInput.trim() || !estimate) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const result = await api.validateCoupon(couponInput.trim(), "ride", estimate.fare);
      setCoupon(result);
      setCouponError(null);
    } catch (error) {
      setCoupon(null);
      setCouponError(error instanceof Error ? error.message : "Could not apply this code.");
    } finally {
      setCouponBusy(false);
    }
  }, [couponInput, estimate]);

  const clearCoupon = useCallback(() => {
    setCoupon(null);
    setCouponError(null);
    setCouponInput("");
  }, []);

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
          if (data.eta_minutes != null && data.target) {
            setEta({ minutes: data.eta_minutes, target: data.target });
          }
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
        pickup_address: pickup.name ?? "My location",
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        dropoff_address: dropoff.name ?? "Destination",
        vehicle_type: vehicle,
        payment_method: payment,
        coupon_code: coupon ? coupon.code : undefined,
      });
      setRide(result);
      setEta(result.driver_eta_minutes != null ? { minutes: result.driver_eta_minutes, target: "pickup" } : null);
      setPhase("active");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request this ride.");
    } finally {
      setBusy(false);
    }
  }, [pickup, dropoff, vehicle, payment, coupon]);

  const cancelRide = useCallback(async () => {
    if (!ride) return;
    setBusy(true);
    try {
      await api.cancelRide(ride.ride_id);
      wsRef.current?.close();
      setRide(null);
      setDriverLocation(null);
      setEta(null);
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

  const shareTrip = useCallback(async () => {
    if (!ride) return;
    setBusy(true);
    try {
      const share = await api.shareRide(ride.ride_id);
      try {
        await Share.share({ message: `Track my Naija Ride live: ${share.url}` });
      } catch {}
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create share link.");
    } finally {
      setBusy(false);
    }
  }, [ride]);

  const sos = useCallback(async () => {
    if (!ride) return;
    Alert.alert("Raise SOS?", "This alerts the safety team and the other party on this ride.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Raise SOS",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
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
    router.push({
      pathname: "/chat",
      params: { entity: "ride", entity_id: ride.ride_id, title: ride.driver?.name ?? "Your driver" },
    });
  }, [ride, router]);

  const liveStep = (step: string) => {
    const order = ["requested", "accepted", "arriving", "in_progress"];
    return step === "completed" ? 4 : order.indexOf(step);
  };

  if (phase === "active" && ride && !trip) {
    const stepIdx = liveStep(ride.status);
    const liveEta = eta ?? (ride.driver_eta_minutes != null && ride.status !== "in_progress" ? { minutes: ride.driver_eta_minutes, target: "pickup" as const } : null);
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="car" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>{statusStep?.label}</Text><Text style={styles.subtitle}>{ride.pickup_address ?? "Pickup"} → {ride.dropoff_address ?? "Dropoff"}</Text></View>{ride.status === "requested" ? <TouchableOpacity onPress={cancelRide} disabled={busy} testID="ride-cancel-button"><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity> : null}</View>

          <View style={styles.mapSpacer}>
            <LiveMap
              pickup={{ lat: ride.pickup_lat, lng: ride.pickup_lng }}
              dropoff={{ lat: ride.dropoff_lat, lng: ride.dropoff_lng }}
              driver={driverLocation ?? (ride.driver?.current_lat != null && ride.driver?.current_lng != null ? { lat: ride.driver.current_lat, lng: ride.driver.current_lng } : null)}
              driverLabel={ride.driver?.name ?? "Driver"}
              height={320}
            />
          </View>

          {ride.driver && liveEta ? (
            <View style={styles.etaBanner} testID="ride-eta-banner">
              <View style={styles.etaIcon}><Ionicons name="navigate" size={16} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.etaTitle}>{liveEta.target === "dropoff" ? "Arriving at dropoff" : "Driver is on the way"}</Text>
                <Text style={styles.etaSub}>{liveEta.target === "dropoff" ? "Estimated arrival, updates live" : "Reaching your pickup, updates live"}</Text>
              </View>
              <Text style={styles.etaValue}>~{liveEta.minutes} min</Text>
            </View>
          ) : null}

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
              <View style={styles.driverAvatar}>{ride.driver.profile_photo ? <Image source={{ uri: ride.driver.profile_photo }} style={styles.driverPhoto} /> : <Ionicons name="person" size={20} color="#fff" />}</View>
              <View style={{ flex: 1 }}><Text style={styles.driverName}>{ride.driver.name ?? "Your driver"}</Text><Text style={styles.driverMeta}>{(ride.driver.vehicle_model ?? "Vehicle")} · {ride.driver.vehicle_color ?? ""} · {ride.driver.vehicle_plate ?? ""}</Text></View>
              <View style={styles.driverRating}><Ionicons name="star" size={13} color={colors.secondaryDark} /><Text style={styles.driverRatingText}>{ride.driver.rating.toFixed(1)}</Text></View>
            </View>
          ) : (
            <View style={styles.searching} testID="ride-searching"><ActivityIndicator color={colors.primary} /><Text style={styles.searchingText}>Notifying nearby drivers… {ride.driver_eta_minutes != null ? `ETA ~${ride.driver_eta_minutes} min` : ""}</Text></View>
          )}

          {driverLocation ? (
            <View style={styles.statusLine}><Ionicons name="navigate" size={15} color={colors.primary} /><Text style={styles.statusLineText}>Driver position updated ({driverLocation.lat.toFixed(4)}, {driverLocation.lng.toFixed(4)})</Text></View>
          ) : null}

          {ride.driver && !["requested", "completed", "cancelled"].includes(ride.status) ? (
            <View style={styles.safetyRow}>
              <TouchableOpacity style={[styles.safetyBtn, busy && { opacity: 0.7 }]} onPress={openChat} disabled={busy} testID="ride-chat">
                <Ionicons name="chatbubble-ellipses" size={17} color={colors.primary} />
                <Text style={styles.safetyBtnText}>Chat</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.safetyBtn, busy && { opacity: 0.7 }]} onPress={shareTrip} disabled={busy} testID="ride-share-trip">
                <Ionicons name="share-social" size={17} color={colors.primary} />
                <Text style={styles.safetyBtnText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sosBtn, busy && { opacity: 0.7 }]} onPress={sos} disabled={busy} testID="ride-sos">
                <Ionicons name="warning" size={17} color="#fff" />
                <Text style={styles.sosBtnText}>SOS</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.fareCard}>
            <Text style={styles.fareLabel}>Car fare</Text>
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
        <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="car" size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.title}>Book a ride</Text><Text style={styles.subtitle}>On-demand car rides.</Text></View></View>

        <View style={styles.mapWrap}>
          <BookingMap
            pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
            dropoff={dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null}
            onPickLocation={tapMap}
            onUseMyLocation={getMyLocation}
            locating={locating}
            height={380}
          />
        </View>

        <View style={styles.locSearch}>
          <View style={styles.pickupRow}>
            <PlaceAutocomplete
              placeholder="Pickup location"
              value={pickup}
              onChange={setPickup}
              testID="ride-pickup-input"
              style={styles.pickupAutocomplete}
            />
            <TouchableOpacity style={styles.gpsBtn} onPress={getMyLocation} disabled={locating} testID="ride-gps-button">
              {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate" size={20} color={colors.primary} />}
            </TouchableOpacity>
          </View>
          <View style={styles.swapRow}>
            <View style={styles.swapLine} />
            <TouchableOpacity style={styles.swapBtn} onPress={swapPlaces} disabled={!pickup && !dropoff} testID="ride-swap">
              <Ionicons name="swap-vertical" size={19} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.swapLine} />
          </View>
          <PlaceAutocomplete
            placeholder="Where to? Search or tap the map"
            value={dropoff}
            onChange={setDropoff}
            testID="ride-dropoff-input"
          />
          <Text style={styles.mapHint}><Ionicons name="finger-print" size={12} color={colors.textSecondary} /> Tip: search above or tap the map to drop a destination pin.</Text>
        </View>

        <Text style={styles.section}>Vehicle</Text>
        <View style={styles.vehicleRow}>
          <View style={[styles.vehicleCard, styles.vehicleCardActive]} testID="ride-vehicle-car">
            <Ionicons name="car" size={22} color={colors.primary} />
            <Text style={[styles.vehicleLabel, styles.vehicleLabelActive]}>Car</Text>
          </View>
        </View>

        {banned ? (
          <View style={styles.bannedCard} testID="ride-zone-warning">
            <Ionicons name="alert-circle" size={17} color={colors.delayed} />
            <Text style={styles.bannedText}>{estimate?.reason ?? "Cars are not allowed in this zone."} Choose another option.</Text>
          </View>
        ) : estimate ? (
          <View style={styles.fareCard} testID="ride-estimate">
            <Text style={styles.fareLabel}>Car estimate</Text>
            {coupon && coupon.discount > 0 ? (
              <>
                <View style={styles.fareRow}>
                  <Text style={[styles.fareValue, styles.fareStruck]}>₦{estimate.fare.toLocaleString()}</Text>
                  <Text style={styles.fareDiscounted}>₦{coupon.fare_after.toLocaleString()}</Text>
                </View>
                <Text style={styles.couponAppliedText}>−₦{coupon.discount.toLocaleString()} with {coupon.code}</Text>
              </>
            ) : (
              <Text style={styles.fareValue}>₦{estimate.fare.toLocaleString()}</Text>
            )}
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

        <Text style={styles.section}>Promo code</Text>
        <View style={styles.couponCard}>
          {coupon ? (
            <View style={styles.couponAppliedRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.couponAppliedCode}>{coupon.code} applied</Text>
                <Text style={styles.couponAppliedMeta}>You save ₦{coupon.discount.toLocaleString()} on this trip.</Text>
              </View>
              <TouchableOpacity onPress={clearCoupon} style={styles.couponRemove} testID="ride-coupon-remove"><Text style={styles.couponRemoveText}>Remove</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.couponInputRow}>
                <Ionicons name="pricetag" size={17} color={colors.textSecondary} />
                <TextInput
                  style={styles.couponInput}
                  placeholder="Enter promo code"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="characters"
                  value={couponInput}
                  onChangeText={setCouponInput}
                  testID="ride-coupon-input"
                />
                <TouchableOpacity style={[styles.couponApplyBtn, (couponBusy || !couponInput.trim()) && { opacity: 0.5 }]} onPress={applyCoupon} disabled={couponBusy || !couponInput.trim()} testID="ride-coupon-apply">
                  {couponBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.couponApplyText}>Apply</Text>}
                </TouchableOpacity>
              </View>
              {couponError ? <Text style={styles.couponErrorText}>{couponError}</Text> : null}
            </>
          )}
        </View>

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        <TouchableOpacity style={[styles.primaryButton, (busy || banned || !pickup || !dropoff) && { opacity: 0.5 }]} onPress={requestRide} disabled={busy || banned || !pickup || !dropoff} testID="ride-request-button">
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="navigate" size={18} color="#fff" /><Text style={styles.primaryText}>Request car</Text></>}
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
  swapRow: { flexDirection: "row", alignItems: "center", marginVertical: 4 },
  swapLine: { flex: 1, height: 1, backgroundColor: colors.border },
  swapBtn: { width: 34, height: 30, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", marginHorizontal: 10 },
  mapHint: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 9 },
  vehicleRow: { flexDirection: "row", gap: 10 },
  vehicleCard: { flex: 1, minHeight: 74, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, alignItems: "center", justifyContent: "center", gap: 5 },
  vehicleCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  vehicleLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  vehicleLabelActive: { color: colors.primary },
  bannedCard: { flexDirection: "row", gap: 9, padding: 13, borderRadius: radii.lg, marginTop: 18, backgroundColor: "#FEF2F2", alignItems: "center" },
  bannedText: { flex: 1, color: colors.delayed, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  fareCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 16, marginTop: 18 },
  fareLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  fareValue: { color: colors.primaryDark, fontSize: 30, fontWeight: "900", marginTop: 4 },
  fareStruck: { color: colors.textSecondary, textDecorationLine: "line-through", fontSize: 16, fontWeight: "700" },
  fareRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  fareDiscounted: { color: colors.primaryDark, fontSize: 30, fontWeight: "900" },
  couponAppliedText: { color: colors.primary, fontSize: 12, fontWeight: "800", marginTop: 2 },
  fareMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 3 },
  couponCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 12 },
  couponInputRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  couponInput: { flex: 1, minHeight: 44, color: colors.textPrimary, fontSize: 14, fontWeight: "700", textTransform: "uppercase" },
  couponApplyBtn: { minWidth: 82, minHeight: 42, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  couponApplyText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  couponErrorText: { color: colors.delayed, fontSize: 12, fontWeight: "700", marginTop: 7 },
  couponAppliedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  couponAppliedCode: { color: colors.textPrimary, fontSize: 14, fontWeight: "900" },
  couponAppliedMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 1 },
  couponRemove: { paddingHorizontal: 10, paddingVertical: 6 },
  couponRemoveText: { color: colors.delayed, fontSize: 12, fontWeight: "800" },
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
  driverAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  driverPhoto: { width: 44, height: 44, borderRadius: 22 },
  driverName: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  driverMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  driverRating: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.secondaryLight, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  driverRatingText: { color: colors.secondaryDark, fontSize: 12, fontWeight: "900" },
  searching: { flexDirection: "row", gap: 10, padding: 15, borderRadius: radii.lg, marginTop: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  searchingText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  statusLine: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusLineText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700" },
  safetyRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  safetyBtn: { flex: 1, minHeight: 48, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  safetyBtnText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  sosBtn: { flex: 1, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.delayed, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  sosBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  mapSpacer: { marginTop: spacing.md },
  etaBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.primaryDark, borderRadius: radii.lg, padding: 14, marginTop: spacing.md },
  etaIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  etaTitle: { color: "#fff", fontSize: 14, fontWeight: "900" },
  etaSub: { color: "#D1FAE5", fontSize: 11, fontWeight: "600", marginTop: 1 },
  etaValue: { color: "#fff", fontSize: 20, fontWeight: "900" },
  ratingRow: { flexDirection: "row", gap: 18, justifyContent: "center", paddingVertical: 12 },
});
