// History: unified trip / delivery / moving / payment history with filters.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, type DeliveryOut, type MovingOut, type PaymentRecord, type RideOut } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

type Tab = "rides" | "deliveries" | "moves" | "payments";

const RIDE_LABELS: Record<string, string> = {
  requested: "Requested",
  accepted: "Accepted",
  arriving: "Arriving",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_COLORS: Record<string, string> = {
  requested: colors.moderate,
  accepted: colors.moderate,
  arriving: colors.moderate,
  in_progress: colors.primary,
  completed: colors.empty,
  cancelled: colors.textSecondary,
  picked_up: colors.moderate,
  delivered: colors.empty,
  paid: colors.empty,
  success: colors.empty,
  pending: colors.moderate,
  failed: colors.delayed,
};

export default function HistoryScreen() {
  const [tab, setTab] = useState<Tab>("rides");
  const [role, setRole] = useState<"customer" | "driver">("customer");
  const [rides, setRides] = useState<RideOut[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryOut[]>([]);
  const [moves, setMoves] = useState<MovingOut[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      setRole(me.role === "driver" ? "driver" : "customer");
      const [r, d, m, p] = await Promise.all([
        api.ridesHistory(me.role === "driver" ? "driver" : "customer"),
        api.myDeliveries(me.role === "driver" ? "driver" : "requester"),
        api.myMoving(me.role === "driver" ? "driver" : "customer"),
        api.paymentsHistory(me.role === "driver" ? "driver" : "customer"),
      ]);
      setRides(r);
      setDeliveries(d);
      setMoves(m);
      setPayments(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history.");
    } finally {
      setLoading(false);
      loaded.current = true;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const statusColor = (s: string) => STATUS_COLORS[s] ?? colors.textSecondary;
  const money = (n: number | null | undefined) => (n != null ? `₦${n.toLocaleString()}` : "—");
  const dateStr = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  const renderRide = (r: RideOut) => (
    <View key={r.ride_id} style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}><Ionicons name="car" size={16} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{r.pickup_address ?? "Pickup"} → {r.dropoff_address ?? "Dropoff"}</Text>
          <Text style={styles.cardMeta}>{dateStr(r.created_at)} · {r.vehicle_type} · {money(r.fare_estimate)}</Text>
        </View>
        <Text style={[styles.badge, { color: statusColor(r.status), backgroundColor: `${statusColor(r.status)}1A` }]}>{RIDE_LABELS[r.status] ?? r.status}</Text>
      </View>
    </View>
  );

  const renderDelivery = (d: DeliveryOut) => (
    <View key={d.delivery_id} style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}><Ionicons name="cube" size={16} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{d.pickup_address ?? "Pickup"} → {d.dropoff_address ?? "Recipient"}</Text>
          <Text style={styles.cardMeta}>{dateStr(d.created_at)} · {d.package_type} · {money(d.delivery_fee)}</Text>
        </View>
        <Text style={[styles.badge, { color: statusColor(d.status), backgroundColor: `${statusColor(d.status)}1A` }]}>{d.status}</Text>
      </View>
    </View>
  );

  const renderMove = (m: MovingOut) => (
    <View key={m.booking_id} style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}><Ionicons name="home" size={16} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{m.origin_address} → {m.destination_address}</Text>
          <Text style={styles.cardMeta}>{dateStr(m.created_at)} · {m.move_type} · {m.truck_size ?? ""} truck · {money(m.quote_amount)}</Text>
        </View>
        <Text style={[styles.badge, { color: statusColor(m.status), backgroundColor: `${statusColor(m.status)}1A` }]}>{m.status}</Text>
      </View>
    </View>
  );

  const renderPayment = (p: PaymentRecord) => (
    <View key={p.payment_id} style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}><Ionicons name="card" size={16} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{p.service_type === "ride" ? p.pickup_address ?? "Ride" : "Payment"} → {p.dropoff_address ?? ""}</Text>
          <Text style={styles.cardMeta}>{dateStr(p.created_at)} · {p.method} · ref {p.provider_ref ?? "—"}</Text>
        </View>
        <Text style={[styles.badge, { color: statusColor(p.status), backgroundColor: `${statusColor(p.status)}1A` }]}>{p.status}</Text>
      </View>
    </View>
  );

  const emptyFor: Record<Tab, string> = {
    rides: "No rides yet. Book one from the Ride tab.",
    deliveries: "No deliveries yet. Send a parcel from Home.",
    moves: "No moves yet. Book one from Home.",
    payments: "No payments yet.",
  };

  const renderList = () => {
    if (tab === "rides") return rides.length ? rides.map(renderRide) : <Text style={styles.empty}>{emptyFor.rides}</Text>;
    if (tab === "deliveries") return deliveries.length ? deliveries.map(renderDelivery) : <Text style={styles.empty}>{emptyFor.deliveries}</Text>;
    if (tab === "moves") return moves.length ? moves.map(renderMove) : <Text style={styles.empty}>{emptyFor.moves}</Text>;
    return payments.length ? payments.map(renderPayment) : <Text style={styles.empty}>{emptyFor.payments}</Text>;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="time" size={22} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>History</Text>
            <Text style={styles.subtitle}>{role === "driver" ? "Jobs you've completed" : "Your trips and orders"}</Text>
          </View>
        </View>

        {error ? <View style={styles.status}><Ionicons name="alert-circle" size={16} color={colors.delayed} /><Text style={styles.statusText}>{error}</Text></View> : null}

        <View style={styles.tabRow}>
          {([
            ["rides", "car"],
            ["deliveries", "cube"],
            ["moves", "home"],
            ["payments", "card"],
          ] as [Tab, keyof typeof Ionicons.glyphMap][]).map(([key, icon]) => (
            <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)} testID={`history-tab-${key}`}>
              <Ionicons name={icon} size={14} color={tab === key ? colors.primary : colors.textSecondary} />
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{key === "moves" ? "Moves" : key[0].toUpperCase() + key.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.list}>{renderList()}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, paddingBottom: 110 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.primaryDark, borderRadius: radii.xl },
  heroIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 22, fontWeight: "900" },
  subtitle: { color: "#D1FAE5", fontSize: 12, lineHeight: 17, marginTop: 3 },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: "#FEF2F2", alignItems: "center" },
  statusText: { flex: 1, color: colors.delayed, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  tabRow: { flexDirection: "row", gap: 8, marginTop: spacing.md, flexWrap: "wrap" },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: colors.primary },
  list: { marginTop: spacing.md, gap: 10 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "800", flexShrink: 1 },
  cardMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 3 },
  badge: { fontSize: 11, fontWeight: "900", textTransform: "capitalize", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  empty: { color: colors.textSecondary, fontSize: 13, fontWeight: "600", textAlign: "center", padding: 32 },
});
