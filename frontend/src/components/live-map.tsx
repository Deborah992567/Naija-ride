// Live trip map: pickup, dropoff, the driver's real-time position, and an
// optional route polyline. Uses native MapLibre (MapTiler tiles) in dev builds,
// a WebView MapLibre GL JS fallback in Expo Go, and a coordinate card on web.
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii } from "@/src/lib/theme";
import { loadMapLibre, mapStyleUrl, nativeMapLibreAvailable, type MapLibreModule } from "@/src/lib/maplibre";
import WebMap, { type WebMarker } from "@/src/components/web-map";

type LatLng = { lat: number; lng: number };
type LngLat = [number, number];

type Props = {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  driver?: LatLng | null;
  route?: LngLat[];
  height?: number;
  driverLabel?: string;
};

export default function LiveMap({ pickup, dropoff, driver, route, height = 300 }: Props) {
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

  const points = [driver, pickup, dropoff].filter((p): p is LatLng => !!p);
  const routePoints = route && route.length > 1 ? route : null;

  if (Platform.OS !== "web" && (!native || !maps)) {
    const markers: WebMarker[] = [
      ...(driver ? [{ id: "driver", lngLat: [driver.lng, driver.lat] as LngLat, color: "#3B82F6", label: "" }] : []),
      ...(pickup ? [{ id: "pickup", lngLat: [pickup.lng, pickup.lat] as LngLat, color: colors.primary, label: "P" }] : []),
      ...(dropoff ? [{ id: "dropoff", lngLat: [dropoff.lng, dropoff.lat] as LngLat, color: colors.delayed, label: "D" }] : []),
    ];
    return <WebMap height={height} markers={markers} route={routePoints ?? undefined} testID="live-map" />;
  }

  const center = (() => {
    if (points.length === 0 && !routePoints) return null;
    const all: LngLat[] = [...points.map((p): LngLat => [p.lng, p.lat]), ...(routePoints ?? [])];
    const lat = all.reduce((s, p) => s + p[1], 0) / all.length;
    const lng = all.reduce((s, p) => s + p[0], 0) / all.length;
    return { lat, lng };
  })();

  if (!maps || !center) {
    return (
      <View style={[styles.fallback, { height }]} testID="live-map-fallback">
        <Ionicons name="map-outline" size={22} color={colors.textSecondary} />
        <Text style={styles.fallbackText}>
          {points.map((p) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`).join("  ·  ") || "Map unavailable"}
        </Text>
      </View>
    );
  }

  const Map = maps.Map;
  const Camera = maps.Camera;
  const Marker = maps.Marker;
  const GeoJSONSource = maps.GeoJSONSource;
  const Layer = maps.Layer;

  const allLngLat: LngLat[] = [...points.map((p): LngLat => [p.lng, p.lat]), ...(routePoints ?? [])];
  const lngs = allLngLat.map((p) => p[0]);
  const lats = allLngLat.map((p) => p[1]);
  const bounds: [number, number, number, number] = [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
  const hasExtent = Math.max(...lngs) - Math.min(...lngs) > 0.0001 || Math.max(...lats) - Math.min(...lats) > 0.0001;

  const routeFeature = routePoints
    ? {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: routePoints },
        properties: {},
      }
    : null;

  return (
    <View style={[styles.mapWrap, { height }]} testID="live-map">
      <Map style={StyleSheet.absoluteFill} mapStyle={mapStyleUrl()} attribution logo>
        <Camera
          {...(hasExtent
            ? { bounds, padding: { top: 50, right: 50, bottom: 50, left: 50 }, duration: 400 }
            : { center: [center.lng, center.lat] as LngLat, zoom: 15 })}
        />
        {routeFeature ? (
          <GeoJSONSource id="trip-route" data={routeFeature}>
            <Layer
              id="trip-route-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": "#2563EB", "line-width": 4, "line-opacity": 0.9 }}
            />
          </GeoJSONSource>
        ) : null}
        {driver ? (
          <Marker id="driver" lngLat={[driver.lng, driver.lat]} anchor="center">
            <View style={styles.driverPin}>
              <Ionicons name="car" size={12} color="#fff" />
            </View>
          </Marker>
        ) : null}
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
  driverPin: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#3B82F6", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  pin: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  pickupPin: { backgroundColor: colors.primary },
  dropoffPin: { backgroundColor: colors.delayed },
  pinText: { color: "#fff", fontSize: 12, fontWeight: "900" },
});
