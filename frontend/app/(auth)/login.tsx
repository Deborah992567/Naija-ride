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
import { useAuth } from "@/src/lib/auth";

export default function Login() {
  const router = useRouter();
  const { signIn, signInGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function google() {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInGoogle();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Google sign-in failed");
    } finally {
      setGoogleLoading(false);
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
          <View style={styles.brand}>
            <View style={styles.logoBadge}>
              <Ionicons name="bus" size={28} color="#fff" />
            </View>
            <Text style={styles.brandText}>NaijaMove</Text>
          </View>

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to track buses, danfo, keke and shuttles in real time.</Text>

          {error && (
            <View style={styles.errorBox} testID="login-error">
              <Ionicons name="alert-circle" size={16} color={colors.delayed} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

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
                testID="login-email-input"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoComplete="password"
                testID="login-password-input"
              />
              <TouchableOpacity onPress={() => setShowPw((v) => !v)}>
                <Ionicons
                  name={showPw ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            onPress={submit}
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            disabled={loading}
            testID="login-submit-button"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.line} />
          </View>

          <TouchableOpacity
            onPress={google}
            style={styles.googleBtn}
            disabled={googleLoading}
            testID="login-google-button"
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color="#DB4437" />
                <Text style={styles.googleText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.bottomRow}>
            <Text style={styles.bottomText}>Don&apos;t have an account?</Text>
            <TouchableOpacity onPress={() => router.push("/(auth)/register")} testID="login-go-register">
              <Text style={styles.link}> Create one</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.xl },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: { fontSize: 22, fontWeight: "900", color: colors.textPrimary, letterSpacing: 0.3 },
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
  field: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, marginBottom: 6, letterSpacing: 0.2 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: "transparent",
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
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleText: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  bottomRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  bottomText: { color: colors.textSecondary, fontSize: 14 },
  link: { color: colors.primary, fontWeight: "800", fontSize: 14 },
});
