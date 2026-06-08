// Native LiveMap — uses react-native-maps (Google on Android, Apple on iOS)
import { useMemo } from "react";
import { StyleSheet, View, Text } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import type { Report, Route } from "@/src/lib/api";
import { vehicleMeta, colors } from "@/src/lib/theme";

type Props = {
  region: Region;
  onRegionChange?: (r: Region) => void;
  vehicles: Report[];
  routes: Route[];
  onMarkerPress?: (v: Report) => void;
  showRoutePolylines?: boolean;
};

export default function LiveMap({ region, onRegionChange, vehicles, routes, onMarkerPress, showRoutePolylines = true }: Props) {
  const polylines = useMemo(
    () => routes.filter((r) => r.stops.length >= 2).map((r) => ({
      id: r.route_id,
      coords: r.stops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
      color: vehicleMeta[r.vehicle_type]?.color || colors.primary,
    })),
    [routes],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={onRegionChange}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {showRoutePolylines &&
          polylines.map((p) => (
            <Polyline
              key={p.id}
              coordinates={p.coords}
              strokeColor={p.color}
              strokeWidth={4}
              lineDashPattern={[6, 4]}
            />
          ))}
        {routes.flatMap((r) =>
          r.stops.map((s, i) => (
            <Marker
              key={`${r.route_id}-stop-${i}`}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.stopDot} />
            </Marker>
          )),
        )}
        {vehicles.map((v) => {
          const meta = vehicleMeta[v.vehicle_type] || vehicleMeta.bus;
          return (
            <Marker
              key={v.report_id}
              coordinate={{ latitude: v.lat, longitude: v.lng }}
              onPress={() => onMarkerPress?.(v)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.vehicleMarker, { backgroundColor: meta.color }]}>
                <Ionicons name={meta.icon} size={16} color={v.vehicle_type === "danfo" ? "#1A1A1A" : "#fff"} />
              </View>
            </Marker>
          );
        })}
      </MapView>
      {vehicles.length === 0 && (
        <View style={styles.emptyBadge} pointerEvents="none">
          <Ionicons name="radio" size={14} color={colors.textSecondary} />
          <Text style={styles.emptyText}>No live vehicles yet — be first to report</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  vehicleMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: colors.primary,
  },
  emptyBadge: {
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
  emptyText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
});
