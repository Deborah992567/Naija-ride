// Safety: emergency SOS, trusted contacts, and SOS history.
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type EmergencyContact, type EmergencyRecord } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

export default function SafetyScreen() {
  const router = useRouter();
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null);
  const [records, setRecords] = useState<EmergencyRecord[] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([api.emergencyContacts(), api.myEmergencies()]);
      setContacts(c);
      setRecords(r);
    } catch {
      setContacts([]);
      setRecords([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const triggerSos = useCallback(async () => {
    Alert.alert(
      "Raise SOS?",
      "Your location and ride details will be sent to your trusted contacts and the safety team for help.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Raise SOS",
          style: "destructive",
          onPress: async () => {
            setSosBusy(true);
            setMessage(null);
            try {
              const rec = await api.raiseEmergency({ message: "SOS from app" });
              setRecords((prev) => [rec, ...(prev ?? [])]);
              setMessage("SOS raised. Help is on the way — stay where you are.");
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Could not raise SOS.");
            } finally {
              setSosBusy(false);
            }
          },
        },
      ],
    );
  }, []);

  const addContact = useCallback(async () => {
    if (!name.trim() || !phone.trim()) return;
    setAdding(true);
    setMessage(null);
    try {
      const c = await api.addEmergencyContact(name.trim(), phone.trim());
      setContacts((prev) => [c, ...(prev ?? [])]);
      setName("");
      setPhone("");
      setMessage("Contact added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add contact.");
    } finally {
      setAdding(false);
    }
  }, [name, phone]);

  const removeContact = useCallback(async (c: EmergencyContact) => {
    Alert.alert("Remove contact?", `${c.name} (${c.phone})`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await api.removeEmergencyContact(c.contact_id).catch(() => {});
          setContacts((prev) => prev?.filter((x) => x.contact_id !== c.contact_id) ?? null);
        },
      },
    ]);
  }, []);

  const resolve = useCallback(async (rec: EmergencyRecord) => {
    setBusy(true);
    try {
      const updated = await api.resolveEmergency(rec.emergency_id);
      setRecords((prev) => prev?.map((x) => (x.emergency_id === updated.emergency_id ? updated : x)) ?? null);
    } catch {}
    setBusy(false);
  }, []);

  const loading = contacts === null || records === null;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="safety-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Safety</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={[styles.sosButton, (sosBusy || busy) && { opacity: 0.7 }]}
          onPress={triggerSos}
          disabled={sosBusy || busy}
          activeOpacity={0.85}
          testID="safety-sos-button"
        >
          {sosBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name="warning" size={26} color="#fff" />}
          <Text style={styles.sosText}>{sosBusy ? "Raising SOS…" : "Press for emergency help"}</Text>
        </TouchableOpacity>

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusText}>{message}</Text></View> : null}

        <Text style={styles.section}>Trusted contacts</Text>
        <Text style={styles.hint}>These contacts are alerted when you raise an SOS.</Text>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (contacts ?? []).length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={22} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No contacts yet. Add a friend or family member below.</Text>
          </View>
        ) : (
          <View style={styles.contactList}>
            {(contacts ?? []).map((c) => (
              <View key={c.contact_id} style={styles.contactRow} testID={`safety-contact-${c.contact_id}`}>
                <View style={styles.contactAvatar}><Ionicons name="person" size={16} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>{c.name}</Text>
                  <Text style={styles.contactPhone}>{c.phone}</Text>
                </View>
                <TouchableOpacity onPress={() => removeContact(c)} hitSlop={10} testID={`safety-contact-remove-${c.contact_id}`}>
                  <Ionicons name="trash-outline" size={18} color={colors.delayed} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.addCard}>
          <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.textSecondary} value={name} onChangeText={setName} testID="safety-contact-name" />
          <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor={colors.textSecondary} value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="safety-contact-phone" />
          <TouchableOpacity style={[styles.addButton, (adding || !name.trim() || !phone.trim()) && { opacity: 0.5 }]} onPress={addContact} disabled={adding || !name.trim() || !phone.trim()} testID="safety-contact-add">
            {adding ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="add" size={18} color="#fff" /><Text style={styles.addText}>Add contact</Text></>}
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>SOS history</Text>
        {(records ?? []).length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>No SOS records yet. We hope it stays that way.</Text></View>
        ) : (
          (records ?? []).map((rec) => (
            <View key={rec.emergency_id} style={styles.recordRow} testID={`safety-record-${rec.emergency_id}`}>
              <View style={[styles.recordIcon, rec.status === "raised" ? styles.recordIconRaised : styles.recordIconResolved]}>
                <Ionicons name={rec.status === "raised" ? "warning" : "checkmark"} size={15} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recordTitle}>{rec.status === "raised" ? "SOS raised" : "SOS resolved"}</Text>
                <Text style={styles.recordMeta}>
                  {new Date(rec.created_at).toLocaleString()}
                  {rec.lat != null ? ` · ${rec.lat.toFixed(4)}, ${rec.lng?.toFixed(4)}` : ""}
                </Text>
              </View>
              {rec.status === "raised" ? (
                <TouchableOpacity onPress={() => resolve(rec)} disabled={busy} style={styles.resolveButton} testID={`safety-resolve-${rec.emergency_id}`}>
                  <Text style={styles.resolveText}>I{"'"}m safe</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  headerTitle: { flex: 1, color: colors.textPrimary, fontSize: 18, fontWeight: "900" },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 60 },
  sosButton: {
    minHeight: 120,
    borderRadius: radii.xl,
    backgroundColor: colors.delayed,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: spacing.sm,
  },
  sosText: { color: "#fff", fontSize: 17, fontWeight: "900" },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: 6 },
  hint: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginBottom: 10 },
  center: { paddingVertical: 30, alignItems: "center" },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  contactList: { gap: 8 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 11, padding: 13, borderRadius: radii.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  contactAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  contactName: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" },
  contactPhone: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 2 },
  addCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 12, marginTop: 10, gap: 8 },
  input: { backgroundColor: colors.input, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 11, color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  addButton: { minHeight: 44, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 11, padding: 13, borderRadius: radii.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
  recordIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  recordIconRaised: { backgroundColor: colors.delayed },
  recordIconResolved: { backgroundColor: colors.primary },
  recordTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: "800" },
  recordMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  resolveButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.primaryLight },
  resolveText: { color: colors.primaryDark, fontSize: 11, fontWeight: "900" },
});
