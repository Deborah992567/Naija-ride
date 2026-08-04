// Wallet: balance, top-ups (card), transaction history, driver earnings + withdrawals.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { api, type WalletDetail, type Withdrawal } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

const CATEGORY_ICONS: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  topup: { name: "card", color: colors.primary },
  earnings: { name: "cash", color: colors.primary },
  withdrawal: { name: "arrow-up-circle", color: colors.delayed },
  ride: { name: "car", color: colors.primary },
  delivery: { name: "cube", color: colors.primary },
  moving: { name: "home", color: colors.primary },
  refund: { name: "return-down-back", color: colors.primary },
  adjustment: { name: "swap-horizontal", color: colors.textSecondary },
};

const CATEGORY_LABELS: Record<string, string> = {
  topup: "Top-up",
  earnings: "Earnings",
  withdrawal: "Withdrawal",
  ride: "Ride",
  delivery: "Delivery",
  moving: "Moving",
  refund: "Refund",
  adjustment: "Adjustment",
};

export default function WalletScreen() {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [earnings, setEarnings] = useState<{ commission_percent: number; total_earnings: number; job_count: number } | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<"txns" | "earnings">("txns");
  const [withdrawForm, setWithdrawForm] = useState(false);
  const [wdAmount, setWdAmount] = useState("");
  const [wdBank, setWdBbank] = useState("");
  const [wdAccName, setWdAccName] = useState("");
  const [wdAccNo, setWdAccNo] = useState("");
  const [isDriver, setIsDriver] = useState(false);
  const [verified, setVerified] = useState(false);
  const topupRef = useRef<{ payment_id: string; reference: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, me] = await Promise.all([
        api.walletDetail(),
        api.me(),
      ]);
      setWallet(w);
      setIsDriver(me.role === "driver");
      if (me.role === "driver") {
        const [e, wd, ver] = await Promise.all([
          api.walletEarnings(),
          api.myWithdrawals().catch(() => [] as Withdrawal[]),
          api.getDriverVerification().catch(() => null),
        ]);
        setEarnings(e);
        setWithdrawals(wd);
        setVerified(ver?.verification_status === "verified");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load wallet.");
    } finally {
      setLoading(false);
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

  const topup = useCallback(async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      setMessage("Enter a valid top-up amount.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const init = await api.walletTopup(value);
      topupRef.current = { payment_id: init.payment_id, reference: init.reference };
      await WebBrowser.openAuthSessionAsync(init.authorization_url);
      const res = await api.verifyWalletTopup(init.reference);
      if (res.ok) {
        setMessage(`Top-up of ₦${value.toLocaleString()} confirmed.`);
        setAmount("");
        await load();
      } else {
        setMessage(`Top-up pending: ${res.status}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Top-up failed.");
    } finally {
      setBusy(false);
    }
  }, [amount, load]);

  const submitWithdraw = useCallback(async () => {
    const value = Number(wdAmount);
    if (!value || value <= 0) {
      setMessage("Enter a valid withdrawal amount.");
      return;
    }
    if (!wdBank.trim() || !wdAccName.trim() || !wdAccNo.trim()) {
      setMessage("Fill in all bank details.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.withdraw({ amount: value, bank_name: wdBank.trim(), bank_account_name: wdAccName.trim(), bank_account_number: wdAccNo.trim() });
      setMessage(`Withdrawal request of ₦${value.toLocaleString()} submitted for review.`);
      setWithdrawForm(false);
      setWdAmount("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Withdrawal failed.");
    } finally {
      setBusy(false);
    }
  }, [wdAmount, wdBank, wdAccName, wdAccNo, load]);

  const formatAmount = (a: number) => {
    const sign = a < 0 ? "-" : "+";
    return `${sign}₦${Math.abs(a).toLocaleString()}`;
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
          <View style={styles.heroIcon}><Ionicons name="wallet" size={22} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Wallet</Text>
            <Text style={styles.subtitle}>Balance · top-ups · payouts</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/history")} hitSlop={10}>
            <Ionicons name="time-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available balance</Text>
          <Text style={styles.balanceValue}>₦{wallet?.balance.toLocaleString() ?? "0"}</Text>
          <Text style={styles.balanceMeta}>{wallet?.currency ?? "NGN"} wallet</Text>
          <View style={styles.topupRow}>
            <TextInput
              style={styles.amountInput}
              placeholder="Amount (₦)"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
              testID="wallet-amount-input"
            />
            <TouchableOpacity style={[styles.topupBtn, (busy || !amount) && { opacity: 0.5 }]} onPress={topup} disabled={busy || !amount} testID="wallet-topup-button">
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="card" size={17} color="#fff" /><Text style={styles.topupBtnText}>Top up</Text></>}
            </TouchableOpacity>
          </View>
        </View>

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        {isDriver ? (
          <View style={styles.earningsCard}>
            <View style={styles.earningsHead}>
              <View style={styles.earningsIcon}><Ionicons name="cash" size={16} color="#fff" /></View>
              <Text style={styles.earningsTitle}>Earnings</Text>
            </View>
            <Text style={styles.earningsValue}>₦{earnings?.total_earnings.toLocaleString() ?? "0"}</Text>
            <Text style={styles.earningsMeta}>{earnings?.job_count ?? 0} completed jobs · platform keeps {earnings?.commission_percent ?? 0}%</Text>
            {verified ? (
              <TouchableOpacity style={[styles.withdrawBtn, withdrawForm && styles.withdrawBtnOpen]} onPress={() => setWithdrawForm((v) => !v)} testID="wallet-withdraw-toggle">
                <Ionicons name={withdrawForm ? "close" : "arrow-up-circle"} size={17} color="#fff" />
                <Text style={styles.withdrawBtnText}>{withdrawForm ? "Close withdrawal form" : "Request withdrawal"}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.verifyHint}>Get verified to withdraw earnings.</Text>
            )}
          </View>
        ) : null}

        {isDriver && withdrawForm ? (
          <View style={styles.formCard}>
            <TextInput style={styles.input} placeholder="Amount (₦)" placeholderTextColor={colors.textSecondary} keyboardType="numeric" value={wdAmount} onChangeText={setWdAmount} />
            <TextInput style={styles.input} placeholder="Bank name" placeholderTextColor={colors.textSecondary} value={wdBank} onChangeText={setWdBbank} />
            <TextInput style={styles.input} placeholder="Account name" placeholderTextColor={colors.textSecondary} value={wdAccName} onChangeText={setWdAccName} />
            <TextInput style={styles.input} placeholder="Account number" placeholderTextColor={colors.textSecondary} keyboardType="number-pad" value={wdAccNo} onChangeText={setWdAccNo} />
            <TouchableOpacity style={[styles.submitBtn, busy && { opacity: 0.6 }]} onPress={submitWithdraw} disabled={busy} testID="wallet-withdraw-submit">
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Submit request</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tab, tab === "txns" && styles.tabActive]} onPress={() => setTab("txns")}>
            <Text style={[styles.tabText, tab === "txns" && styles.tabTextActive]}>Transactions</Text>
          </TouchableOpacity>
          {isDriver ? (
            <TouchableOpacity style={[styles.tab, tab === "earnings" && styles.tabActive]} onPress={() => setTab("earnings")}>
              <Text style={[styles.tabText, tab === "earnings" && styles.tabTextActive]}>Withdrawals</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {tab === "txns" ? (
          <View style={styles.listCard} testID="wallet-transactions">
            {(wallet?.transactions?.length ?? 0) === 0 ? (
              <Text style={styles.emptyText}>No transactions yet. Top up to get started.</Text>
            ) : (
              wallet?.transactions.map((t) => {
                const icon = CATEGORY_ICONS[t.category] ?? CATEGORY_ICONS.adjustment;
                return (
                  <View key={t.txn_id} style={styles.txnRow}>
                    <View style={styles.txnIcon}><Ionicons name={icon.name} size={16} color={icon.color} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txnTitle}>{CATEGORY_LABELS[t.category] ?? t.category}</Text>
                      <Text style={styles.txnMeta}>{t.status === "success" ? "Completed" : t.status} · {new Date(t.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Text>
                    </View>
                    <Text style={[styles.txnAmount, t.txn_type === "debit" && styles.txnDebit]}>{formatAmount(t.txn_type === "debit" ? -t.amount : t.amount)}</Text>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <View style={styles.listCard} testID="wallet-withdrawals">
            {withdrawals.length === 0 ? (
              <Text style={styles.emptyText}>No withdrawal requests yet.</Text>
            ) : (
              withdrawals.map((w) => (
                <View key={w.request_id} style={styles.txnRow}>
                  <View style={styles.txnIcon}><Ionicons name="arrow-up-circle" size={16} color={colors.delayed} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txnTitle}>₦{w.amount.toLocaleString()}</Text>
                    <Text style={styles.txnMeta}>{w.bank_name} · {w.bank_account_number}</Text>
                  </View>
                  <Text style={[styles.wdStatus, styles[`wd_${w.status}`] ?? styles.wd_pending]}>{w.status}</Text>
                </View>
              ))
            )}
          </View>
        )}
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
  balanceCard: { backgroundColor: colors.primary, borderRadius: radii.xl, padding: 20, marginTop: spacing.md },
  balanceLabel: { color: "#D1FAE5", fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  balanceValue: { color: "#fff", fontSize: 40, fontWeight: "900", marginTop: 6 },
  balanceMeta: { color: "#D1FAE5", fontSize: 12, fontWeight: "700", marginTop: 2 },
  topupRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  amountInput: { flex: 1, minHeight: 48, borderRadius: radii.md, paddingHorizontal: 14, backgroundColor: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 15, fontWeight: "800" },
  topupBtn: { minHeight: 48, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.secondary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  topupBtnText: { color: colors.textPrimary, fontSize: 13, fontWeight: "900" },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  earningsCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 16, marginTop: spacing.md },
  earningsHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  earningsIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  earningsTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  earningsValue: { color: colors.primaryDark, fontSize: 32, fontWeight: "900", marginTop: 8 },
  earningsMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 2 },
  withdrawBtn: { marginTop: 14, minHeight: 46, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  withdrawBtnOpen: { backgroundColor: colors.textSecondary },
  withdrawBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  verifyHint: { marginTop: 14, color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  formCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, marginTop: spacing.md, gap: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, fontWeight: "600", backgroundColor: colors.input },
  submitBtn: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  submitBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  tabRow: { flexDirection: "row", gap: 8, marginTop: spacing.md },
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: colors.primary },
  listCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, marginTop: spacing.md, overflow: "hidden" },
  txnRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  txnIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  txnTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "900" },
  txnMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 1 },
  txnAmount: { color: colors.primaryDark, fontSize: 14, fontWeight: "900" },
  txnDebit: { color: colors.delayed },
  wdStatus: { fontSize: 11, fontWeight: "900", textTransform: "capitalize", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  wd_pending: { color: colors.moderate, backgroundColor: colors.secondaryLight },
  wd_approved: { color: colors.primaryDark, backgroundColor: colors.primaryLight },
  wd_rejected: { color: colors.delayed, backgroundColor: "#FEF2F2" },
  wd_paid: { color: colors.empty, backgroundColor: "#E7F8F1" },
  emptyText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600", textAlign: "center", padding: 24 },
});
