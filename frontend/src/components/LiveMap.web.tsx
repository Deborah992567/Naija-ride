// Web fallback for LiveMap — react-native-maps doesn't render on web.
// Shows a stylized canvas with vehicle dots positioned by lat/lng linear projection.
import { useMemo } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Report, Route } from "@/src/lib/api";
import { vehicleMeta, colors } from "@/src/lib/theme";

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type Props = {
  region: Region;
  onRegionChange?: (r: Region) => void;
  vehicles: Report[];
  routes: Route[];
  onMarkerPress?: (v: Report) => void;
  showRoutePolylines?: boolean;
};

export default function LiveMap({ region, vehicles, routes, onMarkerPress }: Props) {
  // Compute bounding box from routes + vehicles
  const points = useMemo(() => {
    const pts: { lat: number; lng: number }[] = [];
    routes.forEach((r) => r.stops.forEach((s) => pts.push({ lat: s.lat, lng: s.lng })));
    vehicles.forEach((v) => pts.push({ lat: v.lat, lng: v.lng }));
    if (pts.length === 0) {
      pts.push({ lat: region.latitude, lng: region.longitude });
    }
    return pts;
  }, [routes, vehicles, region]);

  const bounds = useMemo(() => {
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats) - 0.005;
    const maxLat = Math.max(...lats) + 0.005;
    const minLng = Math.min(...lngs) - 0.005;
    const maxLng = Math.max(...lngs) + 0.005;
    return { minLat, maxLat, minLng, maxLng };
  }, [points]);

  function projX(lng: number, w: number) {
    return ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * w;
  }
  function projY(lat: number, h: number) {
    return h - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * h;
  }

  // For simplicity, use fixed dimensions; on web layout this expands to fill.
  const W = 1000;
  const H = 1000;

  return (
    <View style={styles.root}>
      <View style={styles.gridBg}>
        {/* Grid pattern */}
        {Array.from({ length: 20 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: `${i * 5}%` }]} />
        ))}
        {Array.from({ length: 20 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLineV, { left: `${i * 5}%` }]} />
        ))}

        {/* Route polylines (drawn as overlay) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ width: W, height: H }}
        >
          <View style={{ width: W, height: H, position: "relative" }}>
            {routes.map((r) =>
              r.stops.map((s, i) => (
                <View
                  key={`${r.route_id}-stop-${i}`}
                  style={[
                    styles.stopDot,
                    {
                      left: projX(s.lng, W) - 5,
                      top: projY(s.lat, H) - 5,
                      borderColor: vehicleMeta[r.vehicle_type]?.color || colors.primary,
                    },
                  ]}
                />
              )),
            )}
            {vehicles.map((v) => {
              const meta = vehicleMeta[v.vehicle_type] || vehicleMeta.bus;
              return (
                <TouchableOpacity
                  key={v.report_id}
                  onPress={() => onMarkerPress?.(v)}
                  style={[
                    styles.vehicle,
                    {
                      left: projX(v.lng, W) - 16,
                      top: projY(v.lat, H) - 16,
                      backgroundColor: meta.color,
                    },
                  ]}
                >
                  <Ionicons name={meta.icon} size={16} color={v.vehicle_type === "danfo" ? "#1A1A1A" : "#fff"} />
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
      <View style={styles.webBadge} pointerEvents="none">
        <Ionicons name="information-circle" size={14} color={colors.textSecondary} />
        <Text style={styles.webBadgeText}>Map preview — open in Expo Go for full interactive map</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: "#EFF6F1" },
  gridBg: { flex: 1, overflow: "hidden" },
  gridLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(0,135,81,0.08)" },
  gridLineV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(0,135,81,0.08)" },
  stopDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
    borderWidth: 2,
  },
  vehicle: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  webBadge: {
    position: "absolute",
    bottom: 130,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.96)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  webBadgeText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
});
