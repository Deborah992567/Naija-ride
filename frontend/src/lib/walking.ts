export type GeoPoint = { latitude: number; longitude: number };

export type WalkingRoute = {
  coordinates: GeoPoint[];
  distanceMeters: number;
  durationSeconds: number;
};

// OpenStreetMap's public foot-routing service. This is intentionally a small,
// no-key prototype integration; production traffic should use a managed router.
const FOOT_ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";

export async function getWalkingRoute(from: GeoPoint, to: GeoPoint): Promise<WalkingRoute> {
  const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const response = await fetch(`${FOOT_ROUTER}/${coordinates}?overview=full&geometries=geojson`);
  if (!response.ok) throw new Error("Walking directions are unavailable right now.");

  const data = (await response.json()) as {
    routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
  };
  const route = data.routes?.[0];
  if (!route) throw new Error("No walking path was found for this stop.");

  return {
    coordinates: route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
}

export function formatWalkingDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
