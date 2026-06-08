// Report screen: pick route → pick vehicle/crowd/fare → submit.
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api, type Route } from "@/src/lib/api";
import { colors, crowdMeta, radii, spacing, vehicleMeta } from "@/src/lib/theme";

const CROWD: ("empty" | "moderate" | "packed")[] = ["empty", "moderate", "packed"];

export default function ReportScreen() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [crowd, setCrowd] = useState<"empty" | "moderate" | "packed">("moderate");
  const [reportType, setReportType] = useState<"sighting" | "onboard" | "delay" | "fare">("sighting");
  const [delay, setDelay] = useState("");
  const [fare, setFare] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [locDenied, setLocDenied] = useState(false);

  useEffect(() => {
    api.listRoutes().then((rs) => {
      setRoutes(rs);
      if (rs.length && !routeId) setRouteId(rs[0].route_id);
    });
  }, [routeId]);

  const selectedRoute = routes.find((r) => r.route_id === routeId);

  async function getLocation(): Promise<{ lat: number; lng: number } | null> {
    let { status: permStatus } = await Location.getForegroundPermissionsAsync();
    if (permStatus !== "granted") {
      const req = await Location.requestForegroundPermissionsAsync();
      permStatus = req.status;
    }
    if (permStatus !== "granted") {
      setLocDenied(true);
      // Fallback: use route's first stop as approximate
      if (selectedRoute?.stops[0]) {
        return { lat: selectedRoute.stops[0].lat, lng: selectedRoute.stops[0].lng };
      }
      return null;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  }

  async function submit() {
    if (!selectedRoute) {
      setStatus({ ok: false, msg: "Pick a route first" });
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      const loc = await getLocation();
      if (!loc) {
        setStatus({ ok: false, msg: "Could not get location" });
        return;
      }
      const body = {
        route_id: selectedRoute.route_id,
        type: reportType,
        vehicle_type: selectedRoute.vehicle_type,
        lat: loc.lat,
        lng: loc.lng,
        crowd_level: reportType === "sighting" || reportType === "onboard" ? crowd : undefined,
        delay_minutes: reportType === "delay" && delay ? Number(delay) : undefined,
        fare: reportType === "fare" && fare ? Number(fare) : undefined,
        note: note.trim() || undefined,
      };
      await api.submitReport(body);
      setStatus({ ok: true, msg: "Report submitted. +1 karma 🎉" });
      setNote("");
      setDelay("");
      setFare("");
    } catch (e: unknown) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : "Failed to submit" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Report</Text>
          <Text style={styles.subtitle}>Help riders by sharing what you see right now.</Text>

          {/* Report type */}
          <Text style={styles.section}>What are you reporting?</Text>
          <View style={styles.grid}>
            <TypeBtn
              active={reportType === "sighting"}
              icon="eye"
              label="Sighting"
              sub="I just saw it"
              onPress={() => setReportType("sighting")}
              testID="report-type-sighting"
            />
            <TypeBtn
              active={reportType === "onboard"}
              icon="bus"
              label="On board"
              sub="I'm riding it"
              onPress={() => setReportType("onboard")}
              testID="report-type-onboard"
            />
            <TypeBtn
              active={reportType === "delay"}
              icon="time"
              label="Delay"
              sub="Running late"
              onPress={() => setReportType("delay")}
              testID="report-type-delay"
            />
            <TypeBtn
              active={reportType === "fare"}
              icon="cash"
              label="Fare"
              sub="Price update"
              onPress={() => setReportType("fare")}
              testID="report-type-fare"
            />
          </View>

          {/* Route picker */}
          <Text style={styles.section}>Which route?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.routeRow}>
            {routes.map((r) => {
              const meta = vehicleMeta[r.vehicle_type] || vehicleMeta.bus;
              const active = r.route_id === routeId;
              return (
                <TouchableOpacity
                  key={r.route_id}
                  onPress={() => setRouteId(r.route_id)}
                  style={[styles.routePill, active && styles.routePillActive]}
                  testID={`report-route-${r.route_id}`}
                >
                  <View style={[styles.routeDot, { backgroundColor: meta.color }]} />
                  <Text style={[styles.routePillText, active && styles.routePillTextActive]} numberOfLines={1}>
                    {r.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Crowd / Delay / Fare details */}
          {(reportType === "sighting" || reportType === "onboard") && (
            <>
              <Text style={styles.section}>How packed is it?</Text>
              <View style={styles.crowdRow}>
                {CROWD.map((c) => {
                  const meta = crowdMeta[c];
                  const active = c === crowd;
                  return (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setCrowd(c)}
                      style={[styles.crowdBtn, active && { borderColor: meta.color, backgroundColor: `${meta.color}15` }]}
                      testID={`crowd-${c}`}
                    >
                      <View style={styles.bars}>
                        {[0, 1, 2].map((i) => (
                          <View
                            key={i}
                            style={{
                              width: 5,
                              height: 8 + i * 6,
                              borderRadius: 2,
                              backgroundColor: i < meta.bars ? meta.color : "#E2E8F0",
                            }}
                          />
                        ))}
                      </View>
                      <Text style={[styles.crowdLabel, active && { color: meta.color }]}>{meta.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {reportType === "delay" && (
            <>
              <Text style={styles.section}>How many minutes late?</Text>
              <View style={styles.singleInput}>
                <Ionicons name="time" size={18} color={colors.textSecondary} />
                <TextInput
                  value={delay}
                  onChangeText={setDelay}
                  placeholder="e.g. 15"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.input}
                  keyboardType="number-pad"
                  testID="report-delay-input"
                />
                <Text style={styles.unit}>min</Text>
              </View>
            </>
          )}

          {reportType === "fare" && (
            <>
              <Text style={styles.section}>New fare</Text>
              <View style={styles.singleInput}>
                <Text style={[styles.unit, { fontSize: 16 }]}>₦</Text>
                <TextInput
                  value={fare}
                  onChangeText={setFare}
                  placeholder="e.g. 500"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.input}
                  keyboardType="number-pad"
                  testID="report-fare-input"
                />
              </View>
            </>
          )}

          <Text style={styles.section}>Add a note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything riders should know? e.g. ‘heavy traffic on Carter Bridge’"
            placeholderTextColor={colors.textSecondary}
            style={styles.noteInput}
            multiline
            numberOfLines={3}
            testID="report-note-input"
          />

          {locDenied && (
            <View style={styles.warn}>
              <Ionicons name="warning" size={14} color={colors.delayed} />
              <Text style={styles.warnText}>Using route stop as approximate location (allow location for precision).</Text>
            </View>
          )}

          {status && (
            <View style={[styles.status, status.ok ? styles.statusOk : styles.statusErr]} testID="report-status">
              <Ionicons
                name={status.ok ? "checkmark-circle" : "alert-circle"}
                size={16}
                color={status.ok ? colors.primary : colors.delayed}
              />
              <Text style={[styles.statusText, { color: status.ok ? colors.primaryDark : colors.delayed }]}>
                {status.msg}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={submit}
            disabled={submitting}
            style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
            testID="report-submit-button"
          >
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="paper-plane" size={18} color="#fff" />
                <Text style={styles.submitText}>Submit report</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TypeBtn({
  active,
  icon,
  label,
  sub,
  onPress,
  testID,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.typeBtn, active && styles.typeBtnActive]}
      activeOpacity={0.85}
      testID={testID}
    >
      <Ionicons name={icon} size={22} color={active ? colors.primary : colors.textPrimary} />
      <Text style={[styles.typeBtnLabel, active && { color: colors.primary }]}>{label}</Text>
      <Text style={styles.typeBtnSub}>{sub}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120 },
  title: { fontSize: 30, fontWeight: "900", color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  section: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.md, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeBtn: {
    width: "48%",
    height: 100,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: 14,
    gap: 4,
  },
  typeBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeBtnLabel: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  typeBtnSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  routeRow: { gap: 8, paddingRight: spacing.lg, paddingVertical: 4 },
  routePill: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    maxWidth: 260,
  },
  routePillActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routePillText: { fontSize: 13, color: colors.textPrimary, fontWeight: "700" },
  routePillTextActive: { color: colors.primary },
  crowdRow: { flexDirection: "row", gap: 10 },
  crowdBtn: {
    flex: 1,
    height: 84,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  bars: { flexDirection: "row", gap: 3, alignItems: "flex-end" },
  crowdLabel: { fontSize: 12, fontWeight: "800", color: colors.textPrimary },
  singleInput: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    height: 54,
  },
  input: { flex: 1, fontSize: 16, color: colors.textPrimary, paddingVertical: 0 },
  unit: { color: colors.textSecondary, fontWeight: "800", fontSize: 14 },
  noteInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 14,
    minHeight: 86,
    fontSize: 14,
    color: colors.textPrimary,
    textAlignVertical: "top",
  },
  warn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, padding: 10, backgroundColor: "#FEF3C7", borderRadius: radii.md },
  warnText: { color: "#92400E", fontSize: 12, flex: 1, fontWeight: "600" },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, padding: 12, borderRadius: radii.md },
  statusOk: { backgroundColor: colors.primaryLight },
  statusErr: { backgroundColor: "#FEE2E2" },
  statusText: { fontSize: 13, fontWeight: "700", flex: 1 },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    marginTop: spacing.lg,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
