// Profile: user info, invite friends, account status, sign out, delete account.
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Share, Alert, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/lib/auth";
import { api, type ReferralOut } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut, refresh, deleteAccount } = useAuth();
  const [referrals, setReferrals] = useState<ReferralOut | null>(null);
  const [referralLoading, setReferralLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
      (async () => {
        try {
          setReferrals(await api.myReferrals());
        } catch {
          setReferrals(null);
        } finally {
          setReferralLoading(false);
        }
      })();
    }, [refresh]),
  );

  const shareInvite = useCallback(async () => {
    if (!referrals) return;
    const message = `Join me on Naija Ride and get a ₦${referrals.referred_reward} welcome bonus! Use my invite code ${referrals.referral_code} when you sign up.`;
    try {
      await Share.share({ message });
    } catch {
      Alert.alert("Could not open share sheet");
    }
  }, [referrals]);

  const confirmDelete = useCallback(async () => {
    setDeleteError(null);
    if (user?.provider !== "google" && !deletePassword) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteAccount(deletePassword || undefined);
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete account. Try again.");
      setDeleteBusy(false);
    }
  }, [deletePassword, deleteAccount, user]);

  const openDelete = useCallback(() => {
    setDeleteError(null);
    setDeletePassword("");
    setDeleteOpen(true);
  }, []);

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
          {user.state ? (
            <View style={styles.providerChip}>
              <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.providerText}>{user.state}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue} testID="profile-karma">{user.karma}</Text>
            <Text style={styles.statLabel}>Karma</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>★</Text>
            <Text style={styles.statLabel}>{user.karma >= 10 ? "Trusted" : "Rising"}</Text>
          </View>
        </View>

        <View style={styles.inviteCard} testID="profile-invite">
          <View style={styles.inviteIcon}><Ionicons name="gift" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inviteTitle}>Invite friends, earn ₦{referrals?.referrer_reward ?? 500}</Text>
            <Text style={styles.inviteSubtitle}>They get ₦{referrals?.referred_reward ?? 300} — you get ₦{referrals?.referrer_reward ?? 500} when they join with your code.</Text>
            <View style={styles.codeRow}>
              <Text style={styles.codeText} testID="profile-referral-code">{referralLoading ? "…" : referrals?.referral_code ?? "—"}</Text>
              <Text style={styles.referralsCount}>{referrals?.referrals.length ?? 0} joined</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.shareBtn} onPress={shareInvite} disabled={!referrals} testID="profile-share-invite">
            <Ionicons name="share-social" size={16} color="#fff" />
            <Text style={styles.shareText}>Invite</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>Account</Text>
        <View style={styles.soonList}>
          <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/notifications")} testID="profile-notifications">
            <Ionicons name="notifications-outline" size={18} color={colors.primary} />
            <Text style={styles.soonRowText}>Notifications</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/safety")} testID="profile-safety">
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
            <Text style={styles.soonRowText}>Safety &amp; SOS</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/wallet")} testID="profile-wallet">
            <Ionicons name="wallet-outline" size={18} color={colors.primary} />
            <Text style={styles.soonRowText}>Wallet &amp; earnings</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/history")} testID="profile-history">
            <Ionicons name="time-outline" size={18} color={colors.primary} />
            <Text style={styles.soonRowText}>Trip history</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/support")} testID="profile-support">
            <Ionicons name="headset-outline" size={18} color={colors.primary} />
            <Text style={styles.soonRowText}>Support &amp; help</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/assistant")} testID="profile-assistant">
            <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
            <Text style={styles.soonRowText}>AI assistant</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </TouchableOpacity>
          {user.role === "driver" ? (
            <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/verify-driver")} testID="profile-verify-driver">
              <Ionicons name="id-card-outline" size={18} color={colors.primary} />
              <Text style={styles.soonRowText}>Driver verification</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.section}>{user.role === "driver" ? "Driver" : "Rider"}</Text>
        <View style={styles.soonList}>
          {user.role === "driver" ? (
            <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/(tabs)/ride")} testID="profile-ride-as-passenger">
              <Ionicons name="car-outline" size={18} color={colors.primary} />
              <Text style={styles.soonRowText}>Ride as passenger</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.soonRow} onPress={() => router.push("/(tabs)/drive")} testID="profile-become-driver">
              <Ionicons name="car-sport-outline" size={18} color={colors.primary} />
              <Text style={styles.soonRowText}>Become a driver</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity onPress={openDelete} style={styles.deleteRow} testID="profile-delete-account">
          <Ionicons name="trash-outline" size={18} color={colors.delayed} />
          <Text style={styles.deleteRowText}>Delete account</Text>
          <Ionicons name="chevron-forward" size={17} color={colors.delayed} />
        </TouchableOpacity>

        <TouchableOpacity onPress={signOut} style={styles.signOutBtn} testID="profile-sign-out">
          <Ionicons name="log-out-outline" size={18} color={colors.delayed} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>NaijaMove · Built for riders, by riders</Text>
      </ScrollView>

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><Ionicons name="warning" size={22} color="#fff" /></View>
            <Text style={styles.modalTitle}>Delete your account?</Text>
            <Text style={styles.modalBody}>
              This permanently deletes your account, driver profile, wallet, notifications and chat history.
              This action cannot be undone.
            </Text>
            {user?.provider !== "google" ? (
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                placeholder="Enter your password"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                style={styles.deleteInput}
                testID="delete-account-password"
              />
            ) : null}
            {deleteError ? <Text style={styles.deleteError} testID="delete-account-error">{deleteError}</Text> : null}
            <TouchableOpacity
              onPress={confirmDelete}
              style={[styles.deleteBtn, deleteBusy && { opacity: 0.7 }]}
              disabled={deleteBusy}
              testID="delete-account-confirm"
            >
              {deleteBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteBtnText}>Yes, delete my account</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDeleteOpen(false)} style={styles.cancelBtn} testID="delete-account-cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  inviteCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: 14,
  },
  inviteIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  inviteTitle: { color: "#fff", fontSize: 14, fontWeight: "900" },
  inviteSubtitle: { color: "#D1FAE5", fontSize: 11, fontWeight: "600", marginTop: 2, lineHeight: 15 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 7 },
  codeText: { color: "#fff", fontSize: 15, fontWeight: "900", letterSpacing: 1.2 },
  referralsCount: { color: "#D1FAE5", fontSize: 10, fontWeight: "700" },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.secondary },
  shareText: { color: colors.textPrimary, fontSize: 12, fontWeight: "900" },
  section: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: 10 },
  soonList: { gap: 8 },
  soonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
  },
  soonRowText: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: "700" },
  soonTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.input },
  soonTagText: { fontSize: 10, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase" },
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
  deleteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.md,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: radii.md,
    padding: 14,
  },
  deleteRowText: { flex: 1, color: colors.delayed, fontSize: 14, fontWeight: "700" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.bg,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  modalIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.delayed,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  modalTitle: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  modalBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 21, marginTop: 8, marginBottom: spacing.md },
  deleteInput: {
    backgroundColor: colors.input,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    height: 50,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  deleteError: { color: colors.delayed, fontSize: 13, fontWeight: "700", marginBottom: spacing.md },
  deleteBtn: {
    backgroundColor: colors.delayed,
    height: 52,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 4,
  },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: "700" },
  footer: { textAlign: "center", color: colors.textSecondary, fontSize: 11, marginTop: spacing.lg, fontWeight: "600" },
});
