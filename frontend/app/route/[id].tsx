// Route detail — stops list with per-stop ETA, recent reports, and back nav.
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, type CrowdAnalytics, type Eta, type Report, type Route } from "@/src/lib/api";
import { colors, radii, spacing, vehicleMeta } from "@/src/lib/theme";
import { formatRelative } from "@/src/lib/time";
import CrowdBars from "@/src/components/CrowdBars";
import { useAuth } from "@/src/lib/auth";
import { isFollowing, toggleFollow } from "@/src/lib/favorites";

export default function RouteDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [route, setRoute] = useState<Route | null>(null);
  const [etas, setEtas] = useState<Eta[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [crowd, setCrowd] = useState<CrowdAnalytics | null>(null);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [r, rep, crowdData] = await Promise.all([
        api.getRoute(id),
        api.listReports(id, 120),
        api.crowdAnalytics(id).catch(() => null),
      ]);
      setRoute(r);
      setReports(rep);
      setCrowd(crowdData);
      setFollowing(await isFollowing(id));
      // Compute ETAs sequentially (small N)
      const etaResults: Eta[] = [];
      for (let i = 0; i < r.stops.length; i++) {
        try {
          etaResults.push(await api.eta(id, i));
        } catch {
          etaResults.push({ route_id: id, stop_id: i, eta_minutes: null, last_seen_minutes_ago: null, distance_km: null, confidence: "none" });
        }
      }
      setEtas(etaResults);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !route) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const meta = vehicleMeta[route.vehicle_type] || vehicleMeta.bus;
  const liveCount = reports.filter((r) => r.type === "sighting" || r.type === "onboard").length;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="route-back-button">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1} testID="route-detail-name">{route.name}</Text>
          <Text style={styles.sub}>{route.city} · {route.stops.length} stops</Text>
        </View>
        <View style={[styles.vBadge, { backgroundColor: meta.color }]}>
          <Ionicons name={meta.icon} size={14} color={route.vehicle_type === "danfo" ? "#1A1A1A" : "#fff"} />
          <Text style={[styles.vBadgeText, { color: route.vehicle_type === "danfo" ? "#1A1A1A" : "#fff" }]}>{meta.label}</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            if (!user) {
              router.push("/(auth)/login");
              return;
            }
            setFollowing((f) => !f);
            void toggleFollow(id).catch(() => {});
          }}
          style={[styles.followBtn, following && styles.followBtnActive]}
          testID="route-follow-button"
        >
          <Ionicons
            name={following ? "notifications" : "notifications-outline"}
            size={18}
            color={following ? "#fff" : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {route.description ? <Text style={styles.desc}>{route.description}</Text> : null}

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{liveCount}</Text>
            <Text style={styles.statLabel}>Live now</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{reports.length}</Text>
            <Text style={styles.statLabel}>Reports (2h)</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{route.fare != null ? `₦${route.fare}` : "—"}</Text>
            <Text style={styles.statLabel}>Fare</Text>
          </View>
        </View>

        {crowd && crowd.by_hour && crowd.by_hour.length > 0 && (
          <>
            <Text style={styles.section}>Crowd pattern</Text>
            <View style={styles.crowdCard} testID="route-crowd-pattern">
              <View style={styles.crowdBars}>
                {crowd.by_hour.map((h) => {
                  const max = crowd.by_hour.reduce((m, x) => Math.max(m, x.report_count), 1);
                  const pct = Math.max(8, Math.round((h.report_count / max) * 100));
                  const isPeak = h.report_count === max && h.report_count > 0;
                  return (
                    <View key={h.hour} style={styles.crowdBarCol}>
                      <View
                        style={[
                          styles.crowdBar,
                          { height: pct, backgroundColor: isPeak ? colors.secondary : colors.primary },
                        ]}
                      />
                      <Text style={styles.crowdHour}>{h.hour}</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.crowdHint}>Reports per hour, last 7 days</Text>
            </View>
          </>
        )}

        <Text style={styles.section}>Stops & ETAs</Text>
        <View style={styles.stops}>
          {route.stops.map((s, i) => {
            const e = etas[i];
            const isFirst = i === 0;
            const isLast = i === route.stops.length - 1;
            return (
              <View key={i} style={styles.stopRow}>
                <View style={styles.stopLineWrap}>
                  <View style={[styles.stopMarker, { backgroundColor: isFirst ? colors.primary : isLast ? colors.secondary : "#fff", borderColor: isLast ? colors.secondaryDark : colors.primary }]} />
                  {!isLast && <View style={styles.stopLine} />}
                </View>
                <View style={styles.stopBody} testID={`route-stop-${i}`}>
                  <Text style={styles.stopName}>{s.name}</Text>
                  <Text style={styles.stopCoord}>{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</Text>
                </View>
                <EtaBadge eta={e} />
              </View>
            );
          })}
        </View>

        <Text style={styles.section}>Recent activity</Text>
        {reports.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={28} color={colors.border} />
            <Text style={styles.emptyTitle}>No reports yet</Text>
            <Text style={styles.emptyText}>Be the first to report a sighting on this route.</Text>
          </View>
        ) : (
          reports.map((r) => (
            <View key={r.report_id} style={styles.activityCard}>
              <View style={styles.activityIcon}>
                <Ionicons
                  name={r.type === "delay" ? "time" : r.type === "fare" ? "cash" : r.type === "onboard" ? "bus" : "eye"}
                  size={16}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityTitle}>
                  {r.type === "delay" ? `Delay +${r.delay_minutes}m` : r.type === "fare" ? `Fare update ₦${r.fare}` : r.type === "onboard" ? "Rider on board" : "Vehicle sighting"}
                </Text>
                <Text style={styles.activitySub} numberOfLines={1}>
                  {r.user_name || "Anonymous"} · {formatRelative(r.created_at)}
                  {r.note ? ` · ${r.note}` : ""}
                </Text>
              </View>
              {r.crowd_level && <CrowdBars level={r.crowd_level} size="sm" />}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function EtaBadge({ eta }: { eta?: Eta }) {
  if (!eta || eta.confidence === "none" || eta.eta_minutes == null) {
    return (
      <View style={[styles.etaBadge, { backgroundColor: colors.input }]}>
        <Text style={[styles.etaText, { color: colors.textSecondary }]}>—</Text>
      </View>
    );
  }
  const color =
    eta.confidence === "high" ? colors.primary : eta.confidence === "medium" ? colors.secondaryDark : colors.textSecondary;
  return (
    <View style={[styles.etaBadge, { backgroundColor: `${color}20`, borderColor: color, borderWidth: 1 }]}>
      <Text style={[styles.etaText, { color }]}>{eta.eta_minutes}m</Text>
      <Text style={styles.etaConf}>{eta.confidence}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 12,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.input,
  },
  title: { fontSize: 17, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  vBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  vBadgeText: { fontSize: 11, fontWeight: "800" },
  followBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scroll: { padding: spacing.lg, paddingBottom: 80 },
  desc: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: spacing.md },
  crowdCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  crowdBars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 3 },
  crowdBarCol: { flex: 1, alignItems: "center", gap: 6 },
  crowdBar: { width: "80%", borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 2 },
  crowdHour: { fontSize: 9, fontWeight: "700", color: colors.textSecondary },
  crowdHint: { fontSize: 11, color: colors.textSecondary, marginTop: 10, textAlign: "center" },
  statRow: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "900", color: colors.primary },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "700", marginTop: 2 },
  section: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: 10 },
  stops: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60 },
  stopLineWrap: { width: 14, alignItems: "center", alignSelf: "stretch" },
  stopMarker: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, backgroundColor: "#fff", borderColor: colors.primary, marginTop: 24 },
  stopLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  stopBody: { flex: 1, paddingVertical: 16 },
  stopName: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  stopCoord: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  etaBadge: {
    minWidth: 56,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.md,
    alignItems: "center",
  },
  etaText: { fontSize: 14, fontWeight: "900" },
  etaConf: { fontSize: 9, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", marginTop: 1 },
  empty: { alignItems: "center", paddingVertical: 30, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: "800", color: colors.textPrimary, marginTop: 6 },
  emptyText: { fontSize: 12, color: colors.textSecondary, textAlign: "center" },
  activityCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  activityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  activityTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  activitySub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
