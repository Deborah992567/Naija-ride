// Interactive booking map: shows pickup/dropoff pins and the user location,
// tap to set a destination. Uses native MapLibre (MapTiler tiles) in dev
// builds, a WebView MapLibre GL JS fallback in Expo Go, and a coordinate card
// on web.
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii } from "@/src/lib/theme";
import { loadMapLibre, mapStyleUrl, nativeMapLibreAvailable, type MapLibreModule } from "@/src/lib/maplibre";
import WebMap, { type WebMarker } from "@/src/components/web-map";

type LatLng = { lat: number; lng: number };

type Props = {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  onPickLocation?: (lat: number, lng: number) => void;
  onUseMyLocation?: () => void;
  locating?: boolean;
  height?: number;
};

export default function BookingMap({ pickup, dropoff, onPickLocation, onUseMyLocation, locating, height = 340 }: Props) {
  const [maps, setMaps] = useState<MapLibreModule | null>(null);
  const native = Platform.OS !== "web" && nativeMapLibreAvailable();

  useEffect(() => {
    let mounted = true;
    if (!nativeMapLibreAvailable()) {
      setMaps(null);
      return;
    }
    loadMapLibre()
      .then((m) => {
        if (mounted) setMaps(m);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const points = [pickup, dropoff].filter((p): p is LatLng => !!p);

  if (Platform.OS !== "web" && (!native || !maps)) {
    const markers: WebMarker[] = [
      ...(pickup ? [{ id: "pickup", lngLat: [pickup.lng, pickup.lat] as [number, number], color: colors.primary, label: "P" }] : []),
      ...(dropoff ? [{ id: "dropoff", lngLat: [dropoff.lng, dropoff.lat] as [number, number], color: colors.delayed, label: "D" }] : []),
    ];
    return (
      <View style={[styles.mapWrap, { height }]} testID="booking-map">
        <WebMap
          height={height}
          markers={markers}
          onPickLocation={onPickLocation}
          testID="booking-map-web"
        />
        {onUseMyLocation ? (
          <TouchableOpacity
            style={styles.locateBtn}
            onPress={onUseMyLocation}
            disabled={locating}
            testID="booking-map-locate"
          >
            {locating ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="locate" size={20} color={colors.primary} />
            )}
          </TouchableOpacity>
        ) : null}
        {onPickLocation ? (
          <View style={styles.hint} pointerEvents="none">
            <Ionicons name="finger-print" size={13} color={colors.textPrimary} />
            <Text style={styles.hintText}>Tap the map to set a destination</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (!maps) {
    return (
      <View style={[styles.fallback, { height }]} testID="booking-map-fallback">
        <Ionicons name="map-outline" size={22} color={colors.textSecondary} />
        <Text style={styles.fallbackText}>
          {points.map((p) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`).join("  ·  ") || "Map unavailable on this device"}
        </Text>
      </View>
    );
  }

  const Map = maps.Map;
  const Camera = maps.Camera;
  const Marker = maps.Marker;
  const UserLocation = maps.UserLocation;

  const center = points.length
    ? {
        lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
        lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
      }
    : null;

  return (
    <View style={[styles.mapWrap, { height }]} testID="booking-map">
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyleUrl()}
        attribution
        logo
        onPress={(event) => {
          const [lng, lat] = event.nativeEvent.lngLat;
          onPickLocation?.(lat, lng);
        }}
      >
        <Camera
          center={center ? ([center.lng, center.lat] as [number, number]) : [3.3792, 6.5244]}
          zoom={center ? 14 : 12}
          duration={300}
        />
        <UserLocation />
        {pickup ? (
          <Marker id="pickup" lngLat={[pickup.lng, pickup.lat]} anchor="center">
            <View style={[styles.pin, styles.pickupPin]}>
              <Text style={styles.pinText}>P</Text>
            </View>
          </Marker>
        ) : null}
        {dropoff ? (
          <Marker id="dropoff" lngLat={[dropoff.lng, dropoff.lat]} anchor="center">
            <View style={[styles.pin, styles.dropoffPin]}>
              <Text style={styles.pinText}>D</Text>
            </View>
          </Marker>
        ) : null}
      </Map>
      {onUseMyLocation ? (
        <TouchableOpacity
          style={styles.locateBtn}
          onPress={onUseMyLocation}
          disabled={locating}
          testID="booking-map-locate"
        >
          {locating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="locate" size={20} color={colors.primary} />
          )}
        </TouchableOpacity>
      ) : null}
      {onPickLocation ? (
        <View style={styles.hint} pointerEvents="none">
          <Ionicons name="finger-print" size={13} color={colors.textPrimary} />
          <Text style={styles.hintText}>Tap the map to set a destination</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { width: "100%", borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.input },
  fallback: {
    width: "100%",
    borderRadius: radii.lg,
    backgroundColor: colors.input,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  fallbackText: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", textAlign: "center" },
  locateBtn: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  hint: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  hintText: { color: colors.textPrimary, fontSize: 12, fontWeight: "800" },
  pin: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  pickupPin: { backgroundColor: colors.primary },
  dropoffPin: { backgroundColor: colors.delayed },
  pinText: { color: "#fff", fontSize: 12, fontWeight: "900" },
});
