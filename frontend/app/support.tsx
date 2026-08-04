// Support: open, reply to, and track support tickets.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, type SupportMessage, type SupportTicket } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

const CATEGORIES = [
  { key: "ride", label: "Ride" },
  { key: "delivery", label: "Delivery" },
  { key: "moving", label: "Moving" },
  { key: "payment", label: "Payment" },
  { key: "driver", label: "Driver" },
  { key: "wallet", label: "Wallet" },
  { key: "other", label: "Other" },
];

const STATUS_COLORS: Record<string, string> = {
  open: colors.primary,
  pending: colors.moderate,
  resolved: colors.empty,
  closed: colors.textSecondary,
};
const PRIORITY_COLORS: Record<string, string> = {
  low: colors.textSecondary,
  normal: colors.primary,
  high: colors.moderate,
  urgent: colors.delayed,
};

export default function SupportScreen() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openTicket, setOpenTicket] = useState<SupportTicket | null>(null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("other");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.myTickets();
      setTickets(list);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load tickets.");
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

  const openDetail = useCallback(async (t: SupportTicket) => {
    try {
      const detail = await api.getTicket(t.ticket_id);
      setOpenTicket(detail);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open ticket.");
    }
  }, []);

  const submitTicket = useCallback(async () => {
    if (!subject.trim() || !body.trim()) {
      setMessage("Fill in a subject and a description.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const t = await api.createTicket({ subject: subject.trim(), category, priority: "normal", body: body.trim() });
      setCreating(false);
      setSubject("");
      setBody("");
      await load();
      openDetail(t);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open ticket.");
    } finally {
      setBusy(false);
    }
  }, [subject, category, body, load, openDetail]);

  const sendReply = useCallback(async () => {
    if (!openTicket || !reply.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const t = await api.replyTicket(openTicket.ticket_id, reply.trim());
      setReply("");
      setOpenTicket(t);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send reply.");
    } finally {
      setBusy(false);
    }
  }, [openTicket, reply, load]);

  const closeTicket = useCallback(async () => {
    if (!openTicket) return;
    setBusy(true);
    try {
      const t = await api.closeTicket(openTicket.ticket_id);
      setOpenTicket(t);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not close ticket.");
    } finally {
      setBusy(false);
    }
  }, [openTicket, load]);

  const formatDate = (s: string) => new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  if (openTicket) {
    const msgs = openTicket.messages ?? [];
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <TouchableOpacity onPress={() => setOpenTicket(null)} hitSlop={10} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{openTicket.subject}</Text>
                <Text style={styles.subtitle}>{CATEGORIES.find((c) => c.key === openTicket.category)?.label ?? openTicket.category} · {openTicket.ticket_id}</Text>
              </View>
              <Text style={[styles.badge, { color: STATUS_COLORS[openTicket.status] ?? colors.textSecondary, backgroundColor: `${STATUS_COLORS[openTicket.status] ?? colors.textSecondary}1A` }]}>{openTicket.status}</Text>
            </View>

            <View style={styles.thread}>
              {msgs.length === 0 ? <Text style={styles.empty}>No messages yet.</Text> : msgs.map((m: SupportMessage) => (
                <View key={m.message_id} style={[styles.bubble, m.is_agent === 1 ? styles.bubbleAgent : styles.bubbleMine]}>
                  <Text style={[styles.bubbleText, m.is_agent === 1 && styles.bubbleTextAgent]}>{m.body}</Text>
                  <Text style={[styles.bubbleMeta, m.is_agent === 1 && styles.bubbleMetaAgent]}>{m.is_agent === 1 ? "Support agent" : "You"} · {formatDate(m.created_at)}</Text>
                </View>
              ))}
            </View>

            {openTicket.status === "closed" ? (
              <View style={styles.status}><Ionicons name="lock-closed" size={16} color={colors.textSecondary} /><Text style={styles.statusText}>This ticket is closed.</Text></View>
            ) : (
              <>
                <View style={styles.replyRow}>
                  <TextInput
                    style={styles.replyInput}
                    placeholder="Type your message…"
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    value={reply}
                    onChangeText={setReply}
                    testID="support-reply-input"
                  />
                  <TouchableOpacity style={[styles.sendBtn, (busy || !reply.trim()) && { opacity: 0.5 }]} onPress={sendReply} disabled={busy || !reply.trim()} testID="support-reply-send">
                    {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.closeLink} onPress={closeTicket} disabled={busy} testID="support-close-ticket">
                  <Text style={styles.closeLinkText}>Close ticket</Text>
                </TouchableOpacity>
              </>
            )}

            {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="headset" size={22} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Support</Text>
            <Text style={styles.subtitle}>Help, complaints, and reports</Text>
          </View>
          <TouchableOpacity style={styles.newBtn} onPress={() => { setCreating(true); setMessage(null); }} testID="support-new-ticket">
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        {creating ? (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>New ticket</Text>
            <TextInput
              style={styles.input}
              placeholder="Subject"
              placeholderTextColor={colors.textSecondary}
              value={subject}
              onChangeText={setSubject}
              testID="support-subject-input"
            />
            <View style={styles.catRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c.key} onPress={() => setCategory(c.key)} style={[styles.catChip, category === c.key && styles.catChipActive]}>
                  <Text style={[styles.catChipText, category === c.key && styles.catChipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Describe your issue…"
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
              value={body}
              onChangeText={setBody}
              testID="support-body-input"
            />
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCreating(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.submitBtn, (busy || !subject.trim() || !body.trim()) && { opacity: 0.5 }]} onPress={submitTicket} disabled={busy || !subject.trim() || !body.trim()} testID="support-submit">
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <Text style={styles.section}>Your tickets</Text>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : tickets.length === 0 ? (
          <Text style={styles.empty}>No tickets yet. Tap + to open one.</Text>
        ) : (
          <View style={styles.list}>
            {tickets.map((t) => (
              <TouchableOpacity key={t.ticket_id} style={styles.card} onPress={() => openDetail(t)} testID={`support-ticket-${t.ticket_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{t.subject}</Text>
                  <Text style={styles.cardMeta}>{CATEGORIES.find((c) => c.key === t.category)?.label ?? t.category} · {formatDate(t.created_at)}</Text>
                </View>
                <Text style={[styles.badge, { color: PRIORITY_COLORS[t.priority] ?? colors.textSecondary, backgroundColor: `${PRIORITY_COLORS[t.priority] ?? colors.textSecondary}1A` }]}>{t.priority}</Text>
                <Text style={[styles.badge, { color: STATUS_COLORS[t.status] ?? colors.textSecondary, backgroundColor: `${STATUS_COLORS[t.status] ?? colors.textSecondary}1A` }]}>{t.status}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { padding: spacing.lg, paddingBottom: 110 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: colors.primaryDark, borderRadius: radii.xl },
  heroIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 20, fontWeight: "900", flexShrink: 1 },
  subtitle: { color: "#D1FAE5", fontSize: 11, lineHeight: 16, marginTop: 2 },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  formCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, marginTop: spacing.md, gap: 10 },
  formTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "900" },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, fontWeight: "600", backgroundColor: colors.input },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  catChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  catChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  catChipTextActive: { color: colors.primary },
  formBtns: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: "800" },
  submitBtn: { flex: 1, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  submitBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 9 },
  list: { gap: 10 },
  card: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14 },
  cardTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" },
  cardMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  badge: { fontSize: 10, fontWeight: "900", textTransform: "capitalize", paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill },
  empty: { color: colors.textSecondary, fontSize: 13, fontWeight: "600", textAlign: "center", padding: 32 },
  thread: { gap: 10, marginTop: spacing.md },
  bubble: { maxWidth: "85%", borderRadius: radii.lg, padding: 12 },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.primaryLight },
  bubbleAgent: { alignSelf: "flex-start", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  bubbleTextAgent: { color: colors.textPrimary },
  bubbleMeta: { color: colors.textSecondary, fontSize: 10, fontWeight: "600", marginTop: 5 },
  bubbleMetaAgent: { color: colors.textSecondary },
  replyRow: { flexDirection: "row", gap: 9, alignItems: "flex-end", marginTop: spacing.md },
  replyInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, fontWeight: "600", backgroundColor: colors.input },
  sendBtn: { width: 48, height: 48, borderRadius: radii.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  closeLink: { marginTop: 14, alignItems: "center" },
  closeLinkText: { color: colors.delayed, fontSize: 13, fontWeight: "800" },
});
