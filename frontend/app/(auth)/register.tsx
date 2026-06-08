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

export default function Register() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim() || undefined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Registration failed");
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
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="register-back-button">
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join thousands of riders making transport smarter.</Text>

          {error && (
            <View style={styles.errorBox} testID="register-error">
              <Ionicons name="alert-circle" size={16} color={colors.delayed} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Display name</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="What should we call you?"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                autoCapitalize="words"
                testID="register-name-input"
              />
            </View>
          </View>

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
                testID="register-email-input"
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
                autoComplete="password-new"
                testID="register-password-input"
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
            testID="register-submit-button"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create account</Text>}
          </TouchableOpacity>

          <View style={styles.bottomRow}>
            <Text style={styles.bottomText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.replace("/(auth)/login")} testID="register-go-login">
              <Text style={styles.link}> Sign in</Text>
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
