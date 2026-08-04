// MapLibre bootstrap: loads @maplibre/maplibre-react-native (native dev builds
// only) and builds the MapTiler style URL for Google-Maps-like tiles.
//
// In Expo Go the native module is not present, so `nativeMapLibreAvailable()`
// returns false and callers fall back to the WebView map. Web is unsupported by
// the native module entirely.
import { Platform, TurboModuleRegistry } from "react-native";

export type MapLibreModule = typeof import("@maplibre/maplibre-react-native");

/** True when @maplibre/maplibre-react-native native code is in the running binary. */
export function nativeMapLibreAvailable(): boolean {
  if (Platform.OS === "web") return false;
  try {
    return !!TurboModuleRegistry.get("MLRNMapViewModule");
  } catch {
    return false;
  }
}

/** URL of the map style. Uses MapTiler streets-v2 when a key is set, else CARTO Voyager. */
export function mapStyleUrl(): string {
  const key = process.env.EXPO_PUBLIC_MAPTILER_KEY;
  if (key && !key.startsWith("your_")) {
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`;
  }
  return "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
}

let maplibrePromise: Promise<MapLibreModule> | null = null;

/** Load @maplibre/maplibre-react-native once. Rejects when native is unavailable. */
export function loadMapLibre(): Promise<MapLibreModule> {
  if (!maplibrePromise) {
    maplibrePromise = (async () => {
      if (!nativeMapLibreAvailable()) throw new Error("MapLibre native module is not available.");
      return import("@maplibre/maplibre-react-native");
    })();
  }
  return maplibrePromise;
}
