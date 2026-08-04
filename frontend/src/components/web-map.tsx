// WebView-based map using MapLibre GL JS + MapTiler/CARTO tiles. This is the
// fallback that works everywhere — including Expo Go, where the native MapLibre
// module is not available. Same rendering engine and styles as the native path.
import { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { mapStyleUrl } from "@/src/lib/maplibre";

export type WebMarker = { id: string; lngLat: [number, number]; color?: string; label?: string };

type Props = {
  height?: number;
  markers?: WebMarker[];
  route?: [number, number][];
  onPickLocation?: (lat: number, lng: number) => void;
  testID?: string;
};

const LAGOS: [number, number] = [3.3792, 6.5244];

const HTML_TEMPLATE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
<style>html,body{margin:0;height:100%;overflow:hidden}#map{position:absolute;inset:0}</style>
</head>
<body>
<div id="map"></div>
<script>
(function(){
  var map = new maplibregl.Map({
    container: 'map',
    style: __STYLE__,
    center: __CENTER__,
    zoom: __ZOOM__,
    attributionControl: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  var markers = {};
  var routeLayerId = null;

  function pin(color, label) {
    var el = document.createElement('div');
    el.style.width = '30px'; el.style.height = '30px';
    el.style.borderRadius = '50%'; el.style.background = color;
    el.style.color = '#fff'; el.style.fontWeight = '900';
    el.style.fontSize = '12px';
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.border = '2px solid #fff'; el.style.boxShadow = '0 1px 4px rgba(0,0,0,.35)';
    el.textContent = label || '';
    return el;
  }

  function renderMarkers(list) {
    Object.keys(markers).forEach(function (k) { markers[k].remove(); });
    markers = {};
    (list || []).forEach(function (m) {
      var el = pin(m.color, m.label);
      markers[m.id] = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([m.lngLat[0], m.lngLat[1]]).addTo(map);
    });
  }

  function renderRoute(coords) {
    if (routeLayerId) { map.removeLayer(routeLayerId); routeLayerId = null; }
    if (map.getSource('route')) { map.removeSource('route'); }
    if (!coords || coords.length < 2) return;
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
    });
    routeLayerId = 'route-line';
    map.addLayer({
      id: routeLayerId, type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2563EB', 'line-width': 5, 'line-opacity': 0.9 },
    });
  }

  if (__PICKABLE__) {
    map.on('click', function (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pick', lng: e.lngLat.lng, lat: e.lngLat.lat }));
    });
  }

  map.on('load', function () {
    if (__BOUNDS__) {
      map.fitBounds(__BOUNDS__, { padding: 40, maxZoom: 15 });
    }
    renderMarkers(__MARKERS__);
    renderRoute(__ROUTE__);
    window.__update = function (payload) {
      if (payload.markers) renderMarkers(payload.markers);
      if (payload.route) renderRoute(payload.route);
    };
  });
})();
</script>
</body>
</html>`;

function boundsOf(points: [number, number][]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  if (Math.max(...lngs) - Math.min(...lngs) < 0.0005 && Math.max(...lats) - Math.min(...lats) < 0.0005) return null;
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

export default function WebMap({ height = 220, markers = [], route, onPickLocation, testID }: Props) {
  const ref = useRef<WebView>(null);
  const loadedRef = useRef(false);

  const html = useMemo(() => {
    const allPoints: [number, number][] = [...markers.map((m) => m.lngLat), ...(route ?? [])];
    const center: [number, number] =
      allPoints.length > 0
        ? [
            allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length,
            allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length,
          ]
        : LAGOS;
    const bounds = boundsOf(allPoints);
    const serialize = (value: unknown) => JSON.stringify(value);
    return HTML_TEMPLATE
      .replace("__STYLE__", serialize(mapStyleUrl()))
      .replace("__CENTER__", serialize(center))
      .replace("__ZOOM__", "13")
      .replace("__BOUNDS__", bounds ? serialize([[bounds[0], bounds[1]], [bounds[2], bounds[3]]]) : "null")
      .replace("__PICKABLE__", onPickLocation ? "true" : "false")
      .replace("__MARKERS__", serialize(markers))
      .replace("__ROUTE__", route ? serialize(route) : "null");
  }, [markers, route, onPickLocation]);

  useEffect(() => {
    if (!loadedRef.current || Platform.OS === "web") return;
    ref.current?.injectJavaScript(
      `window.__update && window.__update(${JSON.stringify({ markers, route: route ?? null })}) ; true;`,
    );
  }, [markers, route]);

  if (Platform.OS === "web") {
    return <View style={[styles.box, { height }]} testID={testID} />;
  }

  return (
    <View style={[styles.box, { height }]} testID={testID}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
        onLoadEnd={() => {
          loadedRef.current = true;
        }}
        onMessage={(event: WebViewMessageEvent) => {
          try {
            const data = JSON.parse(event.nativeEvent.data) as { type: string; lng: number; lat: number };
            if (data.type === "pick") onPickLocation?.(data.lat, data.lng);
          } catch {}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: "100%", borderRadius: 16, overflow: "hidden", backgroundColor: "#E2E8F0" },
});
