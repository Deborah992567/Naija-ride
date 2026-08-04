// Free routing + ETA via the public OSRM API (no key required). Returns the
// route geometry (as [lng, lat] pairs for MapLibre) plus duration/distance.
// Falls back to a straight-line estimate when the router is unreachable.

export type LatLng = { lat: number; lng: number };

export type RouteResult = {
  coordinates: [number, number][];
  durationSeconds: number;
  distanceMeters: number;
};

const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";

export async function getRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  const url = `${OSRM_ENDPOINT}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not calculate route.");
  const data = (await res.json()) as {
    code: string;
    routes?: { duration: number; distance: number; geometry: { coordinates: [number, number][] } }[];
  };
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route) throw new Error("No route found.");
  return {
    coordinates: route.geometry.coordinates,
    durationSeconds: route.duration,
    distanceMeters: route.distance,
  };
}

/** Rough travel time (straight-line, ~30 km/h) when the router is unavailable. */
export function estimateEtaSeconds(from: LatLng, to: LatLng): number {
  return haversineMeters(from, to) / 8.3;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** "20 min", "1 hr 5 min" style label. */
export function etaLabel(totalSeconds: number): string {
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
  return `${totalMinutes} min`;
}
