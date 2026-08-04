// Admin console: overview stats, users, rides, deliveries, moving, payments, tickets,
// driver verification review, payout approvals and promos.
import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type AdminDelivery, type AdminMoving, type AdminRide, type AdminStats, type AdminUser, type AdminVerification, type Coupon, type CouponAudience, type CouponCreate, type CouponRedemption, type CouponScope, type DiscountType, type PaymentRecord, type SupportTicket, type Withdrawal } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, radii, spacing } from "@/src/lib/theme";

type Section =
  | "overview"
  | "users"
  | "rides"
  | "deliveries"
  | "moving"
  | "payments"
  | "tickets"
  | "verifications"
  | "withdrawals"
  | "promos";

const AUDIENCES: CouponAudience[] = ["rider", "driver"];
const SCOPES: CouponScope[] = ["ride", "delivery", "moving", "all"];
const DISCOUNT_TYPES: DiscountType[] = ["percent", "fixed"];

const GOOD_STATUSES = new Set(["completed", "delivered", "paid", "verified", "approved", "successful", "closed", "replied", "active"]);
const MID_STATUSES = new Set(["pending", "requested", "accepted", "arriving", "in_transit", "in_progress", "picked_up", "open"]);

function fmtDiscount(c: Coupon): string {
  if (c.discount_type === "percent") return `${c.discount_value}% off`;
  return `₦${c.discount_value.toLocaleString()} off`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusTone(status: string): { bg: string; text: string } {
  const s = status.toLowerCase();
  if (GOOD_STATUSES.has(s)) return { bg: colors.primaryLight, text: colors.primary };
  if (MID_STATUSES.has(s)) return { bg: colors.secondaryLight, text: "#B45309" };
  return { bg: colors.input, text: colors.textSecondary };
}

function StatusChip({ label }: { label: string }) {
  const tone = statusTone(label);
  return (
    <View style={[styles.statusChip, { backgroundColor: tone.bg }]}>
      <Text style={[styles.statusChipText, { color: tone.text }]}>{label.replace(/_/g, " ")}</Text>
    </View>
  );
}

function defaultPromoForm(): CouponCreate {
  const from = new Date();
  const to = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  return {
    code: "",
    description: "",
    discount_type: "percent",
    discount_value: 0,
    audience: "rider",
    scope: "ride",
    min_trip_fare: 0,
    max_discount: null,
    valid_from: from.toISOString(),
    valid_to: to.toISOString(),
    max_uses: 0,
  };
}

export default function AdminScreen() {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userRole, setUserRole] = useState("");
  const [rides, setRides] = useState<AdminRide[]>([]);
  const [deliveries, setDeliveries] = useState<AdminDelivery[]>([]);
  const [movings, setMovings] = useState<AdminMoving[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [verifications, setVerifications] = useState<AdminVerification[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [redemptions, setRedemptions] = useState<Record<string, CouponRedemption[]>>({});
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [promoForm, setPromoForm] = useState<CouponCreate>(defaultPromoForm);
  const [expandedPromo, setExpandedPromo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, u, r, d, m, p, t, v, w, c] = await Promise.all([
        api.adminStats(),
        api.adminUsers(),
        api.adminRides(),
        api.adminDeliveries(),
        api.adminMoving(),
        api.adminPayments(),
        api.adminTickets(),
        api.adminVerifications(),
        api.adminWithdrawals(),
        api.adminCoupons(),
      ]);
      setStats(st);
      setUsers(u);
      setRides(r);
      setDeliveries(d);
      setMovings(m);
      setPayments(p);
      setTickets(t);
      setVerifications(v);
      setWithdrawals(w);
      setCoupons(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const searchUsers = useCallback(async (search: string, role: string) => {
    setBusy("user-search");
    setError(null);
    try {
      const list = await api.adminUsers(search, role);
      setUsers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not search users.");
    } finally {
      setBusy(null);
    }
  }, []);

  const setUserStatus = useCallback(async (u: AdminUser, status: "active" | "suspended") => {
    setBusy(`us-${u.user_id}`);
    setError(null);
    try {
      await api.adminSetUserStatus(u.user_id, status);
      setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? { ...x, status } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update user.");
    } finally {
      setBusy(null);
    }
  }, []);

  const setTicketStatus = useCallback(async (t: SupportTicket, status: string) => {
    setBusy(`tk-${t.ticket_id}`);
    setError(null);
    try {
      const updated = await api.adminSetTicketStatus(t.ticket_id, status);
      setTickets((prev) => prev.map((x) => (x.ticket_id === t.ticket_id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update ticket.");
    } finally {
      setBusy(null);
    }
  }, []);

  const reviewVerification = useCallback(
    async (userId: string, decision: "verified" | "rejected") => {
      setBusy(userId);
      setError(null);
      try {
        await api.adminReviewVerification(userId, decision);
        setVerifications((prev) => prev.filter((v) => v.user_id !== userId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Review failed.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const reviewWithdrawal = useCallback(
    async (requestId: string, decision: "approved" | "rejected" | "paid") => {
      setBusy(requestId);
      setError(null);
      try {
        const updated = await api.adminReviewWithdrawal(requestId, decision);
        setWithdrawals((prev) => prev.map((w) => (w.request_id === requestId ? updated : w)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const togglePromo = useCallback(async (coupon: Coupon) => {
    setBusy(`tg-${coupon.coupon_id}`);
    setError(null);
    try {
      const updated = await api.adminToggleCoupon(coupon.coupon_id);
      setCoupons((prev) => prev.map((c) => (c.coupon_id === updated.coupon_id ? updated : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed.");
    } finally {
      setBusy(null);
    }
  }, []);

  const createPromo = useCallback(async () => {
    if (!promoForm.code.trim()) {
      setError("Give the promo a code.");
      return;
    }
    if (!promoForm.discount_value || promoForm.discount_value <= 0) {
      setError("Enter a discount value greater than zero.");
      return;
    }
    setBusy("new-promo");
    setError(null);
    try {
      const created = await api.adminCreateCoupon({ ...promoForm, code: promoForm.code.trim() });
      setCoupons((prev) => [created, ...prev]);
      setShowPromoForm(false);
      setPromoForm(defaultPromoForm());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create promo.");
    } finally {
      setBusy(null);
    }
  }, [promoForm]);

  const showRedemptions = useCallback(async (coupon: Coupon) => {
    if (expandedPromo === coupon.coupon_id) {
      setExpandedPromo(null);
      return;
    }
    setExpandedPromo(coupon.coupon_id);
    setError(null);
    try {
      const list = await api.adminCouponRedemptions(coupon.coupon_id);
      setRedemptions((prev) => ({ ...prev, [coupon.coupon_id]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load redemptions.");
    }
  }, [expandedPromo]);

  const setPromoField = useCallback(<K extends keyof CouponCreate>(key: K, value: CouponCreate[K]) => {
    setPromoForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (!user || user.is_admin !== 1) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.denied}>
          <Ionicons name="shield-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.deniedTitle}>Admin access only</Text>
          <Text style={styles.deniedText}>This console is available to platform administrators.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentUserId = user.user_id;
  const pendingVerifications = verifications.filter((v) => v.verification_status === "pending");
  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending");
  const approvedWithdrawals = withdrawals.filter((w) => w.status === "approved");
  const processedCount = withdrawals.filter((w) => ["paid", "rejected"].includes(w.status)).length;
  const openTickets = tickets.filter((t) => t.status === "open");

  const SECTIONS: { key: Section; label: string; icon: keyof typeof Ionicons.glyphMap; badge: number }[] = [
    { key: "overview", label: "Overview", icon: "stats-chart", badge: 0 },
    { key: "verifications", label: "Verify", icon: "shield-checkmark", badge: pendingVerifications.length },
    { key: "withdrawals", label: "Payouts", icon: "cash", badge: pendingWithdrawals.length },
    { key: "promos", label: "Promos", icon: "pricetag", badge: coupons.filter((c) => c.active === 1).length },
    { key: "users", label: "Users", icon: "people", badge: 0 },
    { key: "rides", label: "Rides", icon: "car", badge: 0 },
    { key: "deliveries", label: "Deliveries", icon: "cube", badge: 0 },
    { key: "moving", label: "Moving", icon: "home", badge: 0 },
    { key: "payments", label: "Payments", icon: "card", badge: stats?.payments_pending ?? 0 },
    { key: "tickets", label: "Tickets", icon: "chatbubbles", badge: openTickets.length },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="shield-checkmark" size={22} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Admin Console</Text>
            <Text style={styles.subtitle}>
              {users.length} users · {stats?.rides_total ?? 0} rides · {stats?.revenue ? `₦${stats.revenue.toLocaleString()} revenue` : "…"}
            </Text>
          </View>
          <TouchableOpacity onPress={load} style={styles.refreshBtn} testID="admin-refresh">
            <Ionicons name="refresh" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentRow}>
          {SECTIONS.map((s) => (
            <TouchableOpacity key={s.key} onPress={() => setSection(s.key)} style={[styles.segment, section === s.key && styles.segmentActive]} testID={`admin-segment-${s.key}`}>
              <Ionicons name={s.icon} size={14} color={section === s.key ? colors.primary : colors.textSecondary} />
              <Text style={[styles.segmentText, section === s.key && styles.segmentTextActive]}>{s.label}</Text>
              {s.badge > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{s.badge}</Text></View>
              ) : null}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {error ? <View style={styles.status}><Ionicons name="warning" size={16} color={colors.delayed} /><Text style={styles.statusText}>{error}</Text></View> : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <View style={styles.list}>
            {section === "overview" ? renderOverview(stats) : null}
            {section === "users" ? renderUsers() : null}
            {section === "rides" ? renderRides() : null}
            {section === "deliveries" ? renderDeliveries() : null}
            {section === "moving" ? renderMoving() : null}
            {section === "payments" ? renderPayments() : null}
            {section === "tickets" ? renderTickets() : null}
            {section === "verifications" ? renderVerifications() : null}
            {section === "withdrawals" ? renderWithdrawals() : null}
            {section === "promos" ? renderPromos() : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );

  function renderOverview(st: AdminStats | null) {
    if (!st) {
      return (
        <View style={styles.empty}>
          <Ionicons name="stats-chart-outline" size={32} color={colors.empty} />
          <Text style={styles.emptyTitle}>No stats yet</Text>
          <Text style={styles.emptyText}>Platform metrics will appear here.</Text>
        </View>
      );
    }
    const cards: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }[] = [
      { label: "Users", value: String(st.users), icon: "people" },
      { label: "Drivers", value: String(st.drivers), icon: "car-sport" },
      { label: "Rides total", value: String(st.rides_total), icon: "car" },
      { label: "Rides active", value: String(st.rides_active), icon: "navigate" },
      { label: "Rides done", value: String(st.rides_completed), icon: "checkmark-done" },
      { label: "Deliveries active", value: String(st.deliveries_active), icon: "cube" },
      { label: "Deliveries done", value: String(st.deliveries_completed), icon: "checkmark-done" },
      { label: "Moving active", value: String(st.moving_active), icon: "home" },
      { label: "Moving done", value: String(st.moving_completed), icon: "checkmark-done" },
      { label: "Revenue", value: `₦${st.revenue.toLocaleString()}`, icon: "trending-up" },
      { label: "Payments pending", value: String(st.payments_pending), icon: "time" },
    ];
    return (
      <View style={styles.statsGrid}>
        {cards.map((c) => (
          <View key={c.label} style={styles.statCard}>
            <Ionicons name={c.icon} size={18} color={colors.primary} />
            <Text style={styles.statValue}>{c.value}</Text>
            <Text style={styles.statLabel}>{c.label}</Text>
          </View>
        ))}
      </View>
    );
  }

  function renderUsers() {
    return (
      <View style={styles.list}>
        <View style={styles.filterRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Search name or email"
            placeholderTextColor={colors.textSecondary}
            value={userSearch}
            autoCapitalize="none"
            onChangeText={(t) => { setUserSearch(t); searchUsers(t, userRole); }}
            testID="admin-user-search"
          />
          <TouchableOpacity
            style={[styles.chip, userRole === "driver" && styles.chipActive]}
            onPress={() => { const r = userRole === "driver" ? "" : "driver"; setUserRole(r); searchUsers(userSearch, r); }}
            testID="admin-user-drivers"
          >
            <Text style={[styles.chipText, userRole === "driver" && styles.chipTextActive]}>Drivers</Text>
          </TouchableOpacity>
        </View>

        {users.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={32} color={colors.empty} />
            <Text style={styles.emptyTitle}>No users found</Text>
            <Text style={styles.emptyText}>Try a different search.</Text>
          </View>
        ) : (
          users.map((u) => (
            <View key={u.user_id} style={styles.card} testID="admin-user-card">
              <View style={styles.cardHeader}>
                <View style={[styles.avatar, u.role === "driver" && styles.avatarDriver]}><Ionicons name={u.role === "driver" ? "car-sport" : "person"} size={16} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{u.name || u.email}</Text>
                  <Text style={styles.cardMeta}>{u.email}</Text>
                </View>
                <View style={[styles.statusChip, u.status === "active" ? styles.statusChipPrimary : { backgroundColor: "#FEF2F2" }]}>
                  <Text style={[styles.statusChipText, u.status === "active" ? styles.statusChipTextPrimary : { color: colors.delayed }]}>
                    {u.status === "suspended" ? "suspended" : "active"}
                  </Text>
                </View>
              </View>
              <View style={styles.cardRow}><Ionicons name="shield" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{u.role} · karma {u.karma}{u.state ? ` · ${u.state}` : ""}</Text></View>
              <View style={styles.cardRow}><Ionicons name="calendar" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>Joined {fmtDateTime(u.created_at)}</Text></View>
              <View style={styles.actions}>
                {u.user_id === currentUserId ? (
                  <View style={styles.selfNote}><Ionicons name="lock-closed" size={14} color={colors.textSecondary} /><Text style={styles.selfNoteText}>That is you</Text></View>
                ) : u.status === "active" ? (
                  <TouchableOpacity style={[styles.rejectBtn, busy === `us-${u.user_id}` && { opacity: 0.6 }]} onPress={() => setUserStatus(u, "suspended")} disabled={busy !== null} testID="admin-suspend-user">
                    {busy === `us-${u.user_id}` ? <ActivityIndicator color={colors.delayed} size="small" /> : <><Ionicons name="pause-circle" size={16} color={colors.delayed} /><Text style={styles.rejectText}>Suspend</Text></>}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.approveBtn, busy === `us-${u.user_id}` && { opacity: 0.6 }]} onPress={() => setUserStatus(u, "active")} disabled={busy !== null} testID="admin-activate-user">
                    {busy === `us-${u.user_id}` ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="play-circle" size={16} color="#fff" /><Text style={styles.approveText}>Reactivate</Text></>}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </View>
    );
  }

  function renderRides() {
    if (rides.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="car-outline" size={32} color={colors.empty} />
          <Text style={styles.emptyTitle}>No rides yet</Text>
          <Text style={styles.emptyText}>Ride requests will appear here.</Text>
        </View>
      );
    }
    return rides.map((r) => (
      <View key={r.ride_id} style={styles.card} testID="admin-ride-card">
        <View style={styles.cardHeader}>
          <View style={styles.avatar}><Ionicons name="car" size={16} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{r.rider_name || r.rider_id.slice(0, 10)} → {r.driver_name || (r.driver ? r.driver.name : "no driver")}</Text>
            <Text style={styles.cardMeta}>{fmtDateTime(r.created_at)} · {r.distance_km.toFixed(1)} km</Text>
          </View>
          <StatusChip label={r.status} />
        </View>
        <View style={styles.cardRow}><Ionicons name="navigate" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{r.pickup_address || "Pickup"} → {r.dropoff_address || "Dropoff"}</Text></View>
        <View style={styles.cardRow}><Ionicons name="cash" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>₦{r.fare_estimate.toLocaleString()} · {r.vehicle_type} · {r.payment_method ?? "cash"}</Text></View>
      </View>
    ));
  }

  function renderDeliveries() {
    if (deliveries.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={32} color={colors.empty} />
          <Text style={styles.emptyTitle}>No deliveries yet</Text>
          <Text style={styles.emptyText}>Delivery orders will appear here.</Text>
        </View>
      );
    }
    return deliveries.map((d) => (
      <View key={d.delivery_id} style={styles.card} testID="admin-delivery-card">
        <View style={styles.cardHeader}>
          <View style={styles.avatar}><Ionicons name="cube" size={16} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{d.package_type}{d.recipient_name ? ` → ${d.recipient_name}` : ""}</Text>
            <Text style={styles.cardMeta}>{fmtDateTime(d.created_at)} · {d.distance_km.toFixed(1)} km · {d.driver?.name ?? "no driver"}</Text>
          </View>
          <StatusChip label={d.status} />
        </View>
        <View style={styles.cardRow}><Ionicons name="navigate" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{d.pickup_address || "Pickup"} → {d.dropoff_address || "Dropoff"}</Text></View>
        <View style={styles.cardRow}><Ionicons name="cash" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>₦{d.delivery_fee.toLocaleString()}{d.weight_kg ? ` · ${d.weight_kg} kg` : ""}{d.note ? ` · ${d.note}` : ""}</Text></View>
      </View>
    ));
  }

  function renderMoving() {
    if (movings.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="home-outline" size={32} color={colors.empty} />
          <Text style={styles.emptyTitle}>No moves yet</Text>
          <Text style={styles.emptyText}>Moving bookings will appear here.</Text>
        </View>
      );
    }
    return movings.map((m) => (
      <View key={m.booking_id} style={styles.card} testID="admin-moving-card">
        <View style={styles.cardHeader}>
          <View style={styles.avatar}><Ionicons name="home" size={16} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{m.move_type} move{m.truck_size ? ` · ${m.truck_size} truck` : ""}</Text>
            <Text style={styles.cardMeta}>{fmtDateTime(m.created_at)}{m.move_date ? ` · scheduled ${fmtDate(m.move_date)}` : ""} · {m.driver?.name ?? "no driver"}</Text>
          </View>
          <StatusChip label={m.status} />
        </View>
        <View style={styles.cardRow}><Ionicons name="navigate" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{m.origin_address} → {m.destination_address}</Text></View>
        {m.quote_amount ? <View style={styles.cardRow}><Ionicons name="cash" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>₦{m.quote_amount.toLocaleString()}{m.distance_km ? ` · ${m.distance_km.toFixed(1)} km` : ""}</Text></View> : null}
      </View>
    ));
  }

  function renderPayments() {
    if (payments.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="card-outline" size={32} color={colors.empty} />
          <Text style={styles.emptyTitle}>No payments yet</Text>
          <Text style={styles.emptyText}>Payment history will appear here.</Text>
        </View>
      );
    }
    return payments.map((p) => (
      <View key={p.payment_id} style={styles.card} testID="admin-payment-card">
        <View style={styles.cardHeader}>
          <View style={styles.avatar}><Ionicons name="card" size={16} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>₦{p.amount.toLocaleString()}</Text>
            <Text style={styles.cardMeta}>{fmtDateTime(p.created_at)} · {p.method} · {p.service_type ?? "ride"}</Text>
          </View>
          <StatusChip label={p.status} />
        </View>
        {p.pickup_address || p.dropoff_address ? (
          <View style={styles.cardRow}><Ionicons name="navigate" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{(p.pickup_address || "").trim() || "Pickup"} → {(p.dropoff_address || "").trim() || "Dropoff"}</Text></View>
        ) : null}
      </View>
    ));
  }

  function renderTickets() {
    if (tickets.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={32} color={colors.empty} />
          <Text style={styles.emptyTitle}>No tickets yet</Text>
          <Text style={styles.emptyText}>Support tickets from users will appear here.</Text>
        </View>
      );
    }
    return tickets.map((t) => (
      <View key={t.ticket_id} style={styles.card} testID="admin-ticket-card">
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, t.status === "closed" && { backgroundColor: colors.textSecondary }]}><Ionicons name="chatbubble" size={16} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t.subject}</Text>
            <Text style={styles.cardMeta}>{fmtDateTime(t.created_at)} · {t.category} · {t.priority}</Text>
          </View>
          <StatusChip label={t.status} />
        </View>
        {t.messages && t.messages.length > 0 ? (
          <View style={styles.cardRow}><Ionicons name="mail" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{t.messages.length} message{t.messages.length === 1 ? "" : "s"}</Text></View>
        ) : null}
        <View style={styles.actions}>
          {t.status === "open" ? (
            <TouchableOpacity style={[styles.approveBtn, busy === `tk-${t.ticket_id}` && { opacity: 0.6 }]} onPress={() => setTicketStatus(t, "closed")} disabled={busy !== null} testID="admin-close-ticket">
              {busy === `tk-${t.ticket_id}` ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={styles.approveText}>Close</Text></>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.approveBtn, busy === `tk-${t.ticket_id}` && { opacity: 0.6 }]} onPress={() => setTicketStatus(t, "open")} disabled={busy !== null} testID="admin-reopen-ticket">
              {busy === `tk-${t.ticket_id}` ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="refresh" size={16} color="#fff" /><Text style={styles.approveText}>Reopen</Text></>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    ));
  }

  function renderVerifications() {
    return (
      <View style={styles.list}>
        {pendingVerifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done" size={32} color={colors.empty} />
            <Text style={styles.emptyTitle}>All caught up</Text>
            <Text style={styles.emptyText}>No driver verifications waiting for review.</Text>
          </View>
        ) : (
          pendingVerifications.map((v) => (
            <View key={v.user_id} style={styles.card} testID="admin-verification-card">
              <View style={styles.cardHeader}>
                <View style={styles.avatar}><Ionicons name="person" size={16} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{v.name || v.email}</Text>
                  <Text style={styles.cardMeta}>{v.email}</Text>
                </View>
                <View style={styles.statusChip}><Text style={styles.statusChipText}>pending</Text></View>
              </View>
              <View style={styles.cardRow}><Ionicons name="car" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{v.vehicle_type} · {v.vehicle_plate ?? "no plate"}</Text></View>
              {v.id_type ? <View style={styles.cardRow}><Ionicons name="card" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{v.id_type.replace("_", " ")} · {v.id_number}</Text></View> : null}
              {v.license_number ? <View style={styles.cardRow}><Ionicons name="document-text" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>License {v.license_number}</Text></View> : null}
              {v.document_urls.length > 0 ? (
                <View style={styles.cardRow}><Ionicons name="images" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{v.document_urls.length} document{v.document_urls.length === 1 ? "" : "s"} uploaded</Text></View>
              ) : null}
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.approveBtn, busy === v.user_id && { opacity: 0.6 }]} onPress={() => reviewVerification(v.user_id, "verified")} disabled={busy !== null} testID="admin-approve-verification">
                  {busy === v.user_id ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={styles.approveText}>Approve</Text></>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => reviewVerification(v.user_id, "rejected")} disabled={busy !== null} testID="admin-reject-verification">
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
    );
  }

  function renderWithdrawals() {
    return (
      <View style={styles.list}>
        {pendingWithdrawals.length === 0 && approvedWithdrawals.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="wallet-outline" size={32} color={colors.empty} />
            <Text style={styles.emptyTitle}>No payouts</Text>
            <Text style={styles.emptyText}>Driver withdrawal requests will appear here.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.section}>Pending ({pendingWithdrawals.length})</Text>
            {pendingWithdrawals.map((w) => (
              <View key={w.request_id} style={styles.card} testID="admin-withdrawal-card">
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}><Ionicons name="cash" size={16} color="#fff" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>₦{w.amount.toLocaleString()}</Text>
                    <Text style={styles.cardMeta}>{w.bank_name} · {w.bank_account_number}</Text>
                  </View>
                  <View style={styles.statusChip}><Text style={styles.statusChipText}>pending</Text></View>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.approveBtn, busy === w.request_id && { opacity: 0.6 }]} onPress={() => reviewWithdrawal(w.request_id, "approved")} disabled={busy !== null} testID="admin-approve-withdrawal">
                    {busy === w.request_id ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={styles.approveText}>Approve</Text></>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rejectBtn} onPress={() => reviewWithdrawal(w.request_id, "rejected")} disabled={busy !== null} testID="admin-reject-withdrawal">
                    <Text style={styles.rejectText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <Text style={styles.section}>Approved · ready to pay ({approvedWithdrawals.length})</Text>
            {approvedWithdrawals.map((w) => (
              <View key={w.request_id} style={styles.card} testID="admin-withdrawal-card">
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}><Ionicons name="cash" size={16} color="#fff" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>₦{w.amount.toLocaleString()}</Text>
                    <Text style={styles.cardMeta}>{w.bank_name} · {w.bank_account_number}</Text>
                  </View>
                  <View style={[styles.statusChip, styles.statusChipPrimary]}><Text style={styles.statusChipTextPrimary}>approved</Text></View>
                </View>
                <TouchableOpacity style={[styles.approveBtn, busy === w.request_id && { opacity: 0.6 }]} onPress={() => reviewWithdrawal(w.request_id, "paid")} disabled={busy !== null} testID="admin-pay-withdrawal">
                  {busy === w.request_id ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="paper-plane" size={16} color="#fff" /><Text style={styles.approveText}>Mark as paid</Text></>}
                </TouchableOpacity>
              </View>
            ))}

            {processedCount > 0 ? (
              <>
                <Text style={styles.section}>Processed ({processedCount})</Text>
                <Text style={styles.processedNote}>Paid and rejected requests remain visible in history.</Text>
              </>
            ) : null}
          </>
        )}
      </View>
    );
  }

  function renderPromos() {
    return (
      <View style={styles.list}>
        <TouchableOpacity style={styles.newPromoBtn} onPress={() => { setShowPromoForm((v) => !v); setError(null); }} testID="admin-new-promo">
          <Ionicons name="pricetag" size={16} color="#fff" />
          <Text style={styles.newPromoText}>{showPromoForm ? "Close form" : "New promo"}</Text>
        </TouchableOpacity>

        {showPromoForm ? (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.promoForm} testID="admin-promo-form">
              <Text style={styles.promoFormTitle}>Create promo</Text>
              <TextInput
                style={styles.input}
                placeholder="Code (e.g. WELCOME10)"
                placeholderTextColor={colors.textSecondary}
                value={promoForm.code}
                autoCapitalize="characters"
                onChangeText={(t) => setPromoField("code", t)}
                testID="admin-promo-code"
              />
              <TextInput
                style={styles.input}
                placeholder="Description (optional)"
                placeholderTextColor={colors.textSecondary}
                value={promoForm.description ?? ""}
                onChangeText={(t) => setPromoField("description", t)}
                testID="admin-promo-desc"
              />

              <Text style={styles.formLabel}>Audience</Text>
              <View style={styles.chipRow}>
                {AUDIENCES.map((a) => (
                  <TouchableOpacity key={a} onPress={() => setPromoField("audience", a)} style={[styles.chip, promoForm.audience === a && styles.chipActive]} testID={`admin-promo-aud-${a}`}>
                    <Text style={[styles.chipText, promoForm.audience === a && styles.chipTextActive]}>{a === "rider" ? "Riders (discount)" : "Drivers (bonus)"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formLabel}>Applies to</Text>
              <View style={styles.chipRow}>
                {SCOPES.map((s) => (
                  <TouchableOpacity key={s} onPress={() => setPromoField("scope", s)} style={[styles.chip, promoForm.scope === s && styles.chipActive]} testID={`admin-promo-scope-${s}`}>
                    <Text style={[styles.chipText, promoForm.scope === s && styles.chipTextActive]}>{s === "all" ? "All services" : s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formLabel}>Discount type</Text>
              <View style={styles.chipRow}>
                {DISCOUNT_TYPES.map((t) => (
                  <TouchableOpacity key={t} onPress={() => setPromoField("discount_type", t)} style={[styles.chip, promoForm.discount_type === t && styles.chipActive]} testID={`admin-promo-type-${t}`}>
                    <Text style={[styles.chipText, promoForm.discount_type === t && styles.chipTextActive]}>{t === "percent" ? "Percentage" : "Fixed amount"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.formRow}>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>{promoForm.discount_type === "percent" ? "Percent (%)" : "Amount (₦)"}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="numeric"
                    value={promoForm.discount_value ? String(promoForm.discount_value) : ""}
                    onChangeText={(t) => setPromoField("discount_value", parseFloat(t) || 0)}
                    testID="admin-promo-value"
                  />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Min fare (₦)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="numeric"
                    value={promoForm.min_trip_fare ? String(promoForm.min_trip_fare) : ""}
                    onChangeText={(t) => setPromoField("min_trip_fare", parseFloat(t) || 0)}
                    testID="admin-promo-minfare"
                  />
                </View>
              </View>

              <View style={styles.formRow}>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Max discount (₦)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="None"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="numeric"
                    value={promoForm.max_discount != null && promoForm.max_discount > 0 ? String(promoForm.max_discount) : ""}
                    onChangeText={(t) => setPromoField("max_discount", t ? parseFloat(t) || 0 : null)}
                    testID="admin-promo-maxdisc"
                  />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Max uses (0 = unlimited)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="numeric"
                    value={promoForm.max_uses ? String(promoForm.max_uses) : ""}
                    onChangeText={(t) => setPromoField("max_uses", parseInt(t, 10) || 0)}
                    testID="admin-promo-maxuses"
                  />
                </View>
              </View>

              <Text style={styles.formLabel}>Valid: {fmtDate(promoForm.valid_from)} → {fmtDate(promoForm.valid_to)}</Text>

              <TouchableOpacity style={[styles.approveBtn, busy === "new-promo" && { opacity: 0.6 }]} onPress={createPromo} disabled={busy !== null} testID="admin-create-promo">
                {busy === "new-promo" ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={styles.approveText}>Create promo</Text></>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        ) : null}

        {coupons.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="pricetag-outline" size={32} color={colors.empty} />
            <Text style={styles.emptyTitle}>No promos yet</Text>
            <Text style={styles.emptyText}>Create rider discounts or driver bonuses that riders and drivers can use automatically.</Text>
          </View>
        ) : (
          coupons.map((c) => {
            const expanded = expandedPromo === c.coupon_id;
            const list = redemptions[c.coupon_id] ?? [];
            return (
              <View key={c.coupon_id} style={styles.card} testID="admin-promo-card">
                <View style={styles.cardHeader}>
                  <View style={[styles.avatar, c.audience === "driver" && styles.avatarDriver]}><Ionicons name={c.audience === "driver" ? "car-sport" : "ticket"} size={16} color="#fff" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.code}</Text>
                    <Text style={styles.cardMeta}>{c.description || fmtDiscount(c)}</Text>
                  </View>
                  <View style={[styles.statusChip, c.active === 1 ? styles.statusChipPrimary : {}]}>
                    <Text style={[styles.statusChipText, c.active === 1 && styles.statusChipTextPrimary]}>{c.active === 1 ? "active" : "paused"}</Text>
                  </View>
                </View>
                <View style={styles.cardRow}><Ionicons name="pricetag" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{fmtDiscount(c)} · for {c.audience === "driver" ? "driver bonuses" : "riders"} · {c.scope === "all" ? "all services" : c.scope}</Text></View>
                <View style={styles.cardRow}><Ionicons name="calendar" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{fmtDate(c.valid_from)} → {fmtDate(c.valid_to)}{c.min_trip_fare > 0 ? ` · min ₦${c.min_trip_fare.toLocaleString()}` : ""}</Text></View>
                <View style={styles.cardRow}><Ionicons name="people" size={14} color={colors.textSecondary} /><Text style={styles.cardRowText}>{c.used_count} use{c.used_count === 1 ? "" : "s"}{c.max_uses > 0 ? ` / ${c.max_uses}` : " / unlimited"}</Text></View>
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.approveBtn, busy === `tg-${c.coupon_id}` && { opacity: 0.6 }]} onPress={() => togglePromo(c)} disabled={busy !== null} testID="admin-toggle-promo">
                    {busy === `tg-${c.coupon_id}` ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name={c.active === 1 ? "pause" : "play"} size={15} color="#fff" /><Text style={styles.approveText}>{c.active === 1 ? "Pause" : "Activate"}</Text></>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rejectBtn} onPress={() => showRedemptions(c)} disabled={busy !== null} testID="admin-promo-redemptions">
                    <Text style={styles.rejectText}>{expanded ? "Hide" : "Usage"}</Text>
                  </TouchableOpacity>
                </View>
                {expanded ? (
                  <View style={styles.redemptions}>
                    {list.length === 0 ? <Text style={styles.processedNote}>No redemptions yet.</Text> : list.map((r) => (
                      <View key={r.redemption_id} style={styles.redemptionRow}>
                        <Text style={styles.redemptionUser}>{r.user_id.slice(0, 10)}</Text>
                        <Text style={styles.redemptionEntity}>{r.entity_id ?? "—"}</Text>
                        <Text style={styles.redemptionAmt}>₦{r.discount.toLocaleString()}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 110 },
  denied: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  deniedTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "900" },
  deniedText: { color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.primaryDark, borderRadius: radii.xl },
  heroIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 22, fontWeight: "900" },
  subtitle: { color: "#D1FAE5", fontSize: 12, marginTop: 3, fontWeight: "600" },
  refreshBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  segmentRow: { flexDirection: "row", gap: 10, paddingVertical: spacing.md, paddingRight: spacing.lg },
  segment: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44, paddingHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill },
  segmentActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  segmentText: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  segmentTextActive: { color: colors.primary },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: colors.textPrimary, fontSize: 11, fontWeight: "900" },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: "#FEF2F2", alignItems: "center" },
  statusText: { flex: 1, color: colors.delayed, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  list: { marginTop: spacing.md, gap: 10 },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 8, marginBottom: 2 },
  processedNote: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: 44, gap: 6 },
  emptyTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  emptyText: { color: colors.textSecondary, fontSize: 12, textAlign: "center" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { flex: 1, minWidth: "46%", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, gap: 6, alignItems: "flex-start" },
  statValue: { color: colors.textPrimary, fontSize: 20, fontWeight: "900" },
  statLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  filterRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  avatarDriver: { backgroundColor: colors.secondaryDark },
  cardTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  cardMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 1 },
  statusChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  statusChipText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  statusChipPrimary: { backgroundColor: colors.primaryLight },
  statusChipTextPrimary: { color: colors.primary },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardRowText: { color: colors.textPrimary, fontSize: 12, fontWeight: "600", flex: 1 },
  actions: { flexDirection: "row", gap: 10, marginTop: 2 },
  approveBtn: { flex: 1, minHeight: 46, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  approveText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  rejectBtn: { minWidth: 96, minHeight: 46, borderRadius: radii.pill, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  rejectText: { color: colors.delayed, fontSize: 13, fontWeight: "900" },
  selfNote: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 46, paddingHorizontal: 14 },
  selfNoteText: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
  newPromoBtn: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  newPromoText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  promoForm: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, gap: 8 },
  promoFormTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  formLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  input: { minHeight: 46, borderRadius: radii.md, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: colors.primary },
  formRow: { flexDirection: "row", gap: 10 },
  formField: { flex: 1, gap: 4 },
  redemptions: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 6 },
  redemptionRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  redemptionUser: { flex: 1, color: colors.textPrimary, fontSize: 11, fontWeight: "700" },
  redemptionEntity: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  redemptionAmt: { color: colors.primary, fontSize: 11, fontWeight: "900" },
});
