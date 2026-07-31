import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestReset() {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Enter your email address first");
      return;
    }
    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setInfo(res.message);
      if (res.reset_token) {
        // Dev build: the token is returned so the flow is usable without email.
        setToken(res.reset_token);
        setStep(2);
      } else {
        setStep(2);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not request a reset");
    } finally {
      setLoading(false);
    }
  }

  async function doReset() {
    setError(null);
    if (!token || password.length < 6) {
      setError("Enter the reset code and a password of at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await api.resetPassword(token.trim(), password);
      setInfo(res.message);
      setTimeout(() => router.replace("/(auth)/login"), 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not reset your password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="forgot-back-button">
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.title}>Reset password</Text>
          <Text style={styles.subtitle}>
            {step === 1
              ? "Enter your account email and we'll send a reset code."
              : "Enter the reset code and choose a new password."}
          </Text>

          {error && (
            <View style={styles.errorBox} testID="forgot-error">
              <Ionicons name="alert-circle" size={16} color={colors.delayed} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {info && (
            <View style={styles.infoBox} testID="forgot-info">
              <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              <Text style={styles.infoText}>{info}</Text>
            </View>
          )}

          {step === 1 ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    testID="forgot-email-input"
                  />
                </View>
              </View>
              <TouchableOpacity
                onPress={requestReset}
                style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
                disabled={loading}
                testID="forgot-submit-button"
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send reset code</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Reset code</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="key-outline" size={18} color={colors.textSecondary} />
                  <TextInput
                    value={token}
                    onChangeText={setToken}
                    placeholder="Paste the code here"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                    autoCapitalize="none"
                    testID="reset-token-input"
                  />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>New password</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="At least 6 characters"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="password-new"
                    testID="reset-password-input"
                  />
                </View>
              </View>
              <TouchableOpacity
                onPress={doReset}
                style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
                disabled={loading}
                testID="reset-submit-button"
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Update password</Text>}
              </TouchableOpacity>
            </>
          )}

          <View style={styles.bottomRow}>
            <Text style={styles.bottomText}>Remembered it?</Text>
            <TouchableOpacity onPress={() => router.replace("/(auth)/login")} testID="forgot-go-login">
              <Text style={styles.link}> Back to sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 32, fontWeight: "900", color: colors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 22 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEE2E2",
    padding: 12,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.delayed, fontSize: 13, flex: 1, fontWeight: "600" },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primaryLight,
    padding: 12,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  infoText: { color: colors.primaryDark, fontSize: 13, flex: 1, fontWeight: "600" },
  field: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    height: 52,
  },
  input: { flex: 1, fontSize: 15, color: colors.textPrimary, paddingVertical: 0 },
  primaryBtn: {
    backgroundColor: colors.primary,
    height: 54,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  bottomRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  bottomText: { color: colors.textSecondary, fontSize: 14 },
  link: { color: colors.primary, fontWeight: "800", fontSize: 14 },
});
