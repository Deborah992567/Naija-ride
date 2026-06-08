// Profile: user info, karma, recent reports, sign out.
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/lib/auth";
import { api, type Report } from "@/src/lib/api";
import { colors, radii, spacing, vehicleMeta } from "@/src/lib/theme";
import { formatRelative } from "@/src/lib/time";

export default function ProfileScreen() {
  const { user, signOut, refresh } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const all = await api.listReports(undefined, 60 * 24 * 14); // last 2 weeks
      setReports(all.filter((r) => r.user_id === user.user_id).slice(0, 20));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      load();
    }, [refresh, load]),
  );

  if (!user) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const initials = (user.name || user.email)
    .split(/[\s.@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          {user.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <Text style={styles.name} testID="profile-name">{user.name || user.email}</Text>
          <Text style={styles.email}>{user.email}</Text>
          <View style={styles.providerChip}>
            <Ionicons
              name={user.provider === "google" ? "logo-google" : "mail"}
              size={12}
              color={colors.textSecondary}
            />
            <Text style={styles.providerText}>
              Signed in via {user.provider === "google" ? "Google" : "Email"}
            </Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue} testID="profile-karma">{user.karma}</Text>
            <Text style={styles.statLabel}>Karma</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{reports.length}</Text>
            <Text style={styles.statLabel}>Reports</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>★</Text>
            <Text style={styles.statLabel}>{user.karma >= 10 ? "Trusted" : "Rising"}</Text>
          </View>
        </View>

        <Text style={styles.section}>Recent reports</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : reports.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="megaphone-outline" size={32} color={colors.border} />
            <Text style={styles.emptyTitle}>No reports yet</Text>
            <Text style={styles.emptyText}>Help your community — submit a sighting or delay from the Report tab.</Text>
          </View>
        ) : (
          reports.map((r) => {
            const meta = vehicleMeta[r.vehicle_type] || vehicleMeta.bus;
            return (
              <View key={r.report_id} style={styles.reportCard}>
                <View style={[styles.reportIcon, { backgroundColor: meta.color }]}>
                  <Ionicons name={meta.icon} size={14} color={r.vehicle_type === "danfo" ? "#1A1A1A" : "#fff"} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportTitle} numberOfLines={1}>
                    {r.type === "delay" ? `Delay +${r.delay_minutes}m` : r.type === "fare" ? `Fare ₦${r.fare}` : `${meta.label} ${r.type}`}
                  </Text>
                  <Text style={styles.reportSub}>{formatRelative(r.created_at)}</Text>
                </View>
                {r.crowd_level && (
                  <View style={styles.reportTag}>
                    <Text style={styles.reportTagText}>{r.crowd_level}</Text>
                  </View>
                )}
              </View>
            );
          })
        )}

        <TouchableOpacity onPress={signOut} style={styles.signOutBtn} testID="profile-sign-out">
          <Ionicons name="log-out-outline" size={18} color={colors.delayed} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>NaijaMove · Built for riders, by riders</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120 },
  headerCard: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: "center",
  },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { color: "#fff", fontSize: 30, fontWeight: "900" },
  name: { marginTop: 12, fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  email: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  providerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.input,
  },
  providerText: { fontSize: 11, color: colors.textSecondary, fontWeight: "700" },
  statRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
  },
  statValue: { fontSize: 22, fontWeight: "900", color: colors.primary },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "700", marginTop: 4, letterSpacing: 0.4 },
  section: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: 10 },
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary, marginTop: 6 },
  emptyText: { fontSize: 12, color: colors.textSecondary, textAlign: "center", paddingHorizontal: 30 },
  reportCard: {
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
  reportIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  reportTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, textTransform: "capitalize" },
  reportSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  reportTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.input },
  reportTagText: { fontSize: 10, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase" },
  signOutBtn: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  signOutText: { color: colors.delayed, fontSize: 14, fontWeight: "800" },
  footer: { textAlign: "center", color: colors.textSecondary, fontSize: 11, marginTop: spacing.lg, fontWeight: "600" },
});
