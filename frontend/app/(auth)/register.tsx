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
  Modal,
  FlatList,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing } from "@/src/lib/theme";
import { api, type VehicleType } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";

export const NIGERIAN_STATES = [
  "FCT (Abuja)",
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
];

export default function Register() {
  const router = useRouter();
  const { signUp, refresh } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState("");
  const [referral, setReferral] = useState("");
  const [role, setRole] = useState<"user" | "rider" | "driver">("user");
  const [vehicle, setVehicle] = useState<VehicleType>("car");
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState("");
  const [model, setModel] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
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
    if (!state) {
      setError("Please choose your state");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim() || undefined, state, referral.trim() || undefined);
      if (role !== "user") {
        await api.driverRegister({
          vehicle_type: vehicle,
          vehicle_plate: plate.trim() || undefined,
          vehicle_color: color.trim() || undefined,
          vehicle_model: model.trim() || undefined,
          phone: phone.trim() || undefined,
        });
        await refresh();
      }
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

          <View style={styles.field}>
            <Text style={styles.label}>Your state</Text>
            <TouchableOpacity
              onPress={() => setStateOpen(true)}
              style={styles.inputWrap}
              testID="register-state-field"
            >
              <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.input, !state && { color: colors.textSecondary }]}>
                {state || "Choose your state"}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Referral code (optional)</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="gift-outline" size={18} color={colors.textSecondary} />
              <TextInput
                value={referral}
                onChangeText={setReferral}
                placeholder="Got an invite? Enter the code"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                autoCapitalize="characters"
                testID="register-referral-input"
              />
            </View>
            <Text style={styles.referralHint}>Both you and your friend get a wallet bonus.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>I want to sign up as</Text>
            <View style={styles.roleRow}>
              <TouchableOpacity
                onPress={() => setRole("user")}
                style={[styles.roleCard, role === "user" && styles.roleCardActive]}
                testID="register-role-user"
              >
                <View style={[styles.roleIcon, role === "user" && styles.roleIconActive]}>
                  <Ionicons name="person" size={20} color={role === "user" ? "#fff" : colors.textSecondary} />
                </View>
                <Text style={[styles.roleTitle, role === "user" && styles.roleTitleActive]}>User</Text>
                <Text style={styles.roleSubtitle}>Request rides, send deliveries, book moves</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setRole("rider"); setVehicle("bike"); }}
                style={[styles.roleCard, role === "rider" && styles.roleCardActive]}
                testID="register-role-rider"
              >
                <View style={[styles.roleIcon, role === "rider" && styles.roleIconActive]}>
                  <Ionicons name="bicycle" size={20} color={role === "rider" ? "#fff" : colors.textSecondary} />
                </View>
                <Text style={[styles.roleTitle, role === "rider" && styles.roleTitleActive]}>Rider</Text>
                <Text style={styles.roleSubtitle}>Earn by delivering parcels on your bike</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setRole("driver"); setVehicle("car"); }}
                style={[styles.roleCard, role === "driver" && styles.roleCardActive]}
                testID="register-role-driver"
              >
                <View style={[styles.roleIcon, role === "driver" && styles.roleIconActive]}>
                  <Ionicons name="car-sport" size={20} color={role === "driver" ? "#fff" : colors.textSecondary} />
                </View>
                <Text style={[styles.roleTitle, role === "driver" && styles.roleTitleActive]}>Driver</Text>
                <Text style={styles.roleSubtitle}>Earn by driving passengers in your car</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.referralHint}>You can always switch roles later from your profile.</Text>
          </View>

          {role !== "user" ? (
            <View style={styles.field}>
              <Text style={styles.label}>{role === "rider" ? "Your bike" : "Your car"}</Text>
              <View style={styles.vehicleRow}>
                <View style={[styles.vehicleCard, styles.vehicleCardActive]} testID={`register-vehicle-${vehicle}`}>
                  <Ionicons name={vehicle === "car" ? "car" : "bicycle"} size={20} color={colors.primary} />
                  <Text style={[styles.vehicleLabel, styles.vehicleLabelActive]}>{vehicle === "car" ? "Car" : "Bike"}</Text>
                </View>
              </View>
              <TextInput
                style={styles.fieldInput}
                placeholder="Plate number (e.g. LAG-123)"
                placeholderTextColor={colors.textSecondary}
                value={plate}
                onChangeText={setPlate}
                autoCapitalize="characters"
                testID="register-plate-input"
              />
              <TextInput
                style={styles.fieldInput}
                placeholder="Colour (e.g. Blue)"
                placeholderTextColor={colors.textSecondary}
                value={color}
                onChangeText={setColor}
                testID="register-color-input"
              />
              <TextInput
                style={styles.fieldInput}
                placeholder="Model (e.g. Toyota Camry)"
                placeholderTextColor={colors.textSecondary}
                value={model}
                onChangeText={setModel}
                testID="register-model-input"
              />
              <TextInput
                style={styles.fieldInput}
                placeholder="Phone number"
                placeholderTextColor={colors.textSecondary}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                testID="register-phone-input"
              />
            </View>
          ) : null}

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

      <Modal
        visible={stateOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setStateOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose your state</Text>
              <TouchableOpacity onPress={() => setStateOpen(false)} testID="register-state-close">
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={NIGERIAN_STATES}
              keyExtractor={(s) => s}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => {
                    setState(item);
                    setStateOpen(false);
                  }}
                  style={styles.stateRow}
                  testID={`register-state-${item}`}
                >
                  <Text style={[styles.stateText, state === item && { color: colors.primary, fontWeight: "800" }]}>
                    {item}
                  </Text>
                  {state === item && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
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
  fieldInput: {
    minHeight: 52,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  referralHint: { fontSize: 11, color: colors.textSecondary, marginTop: 6, fontWeight: "600" },
  roleRow: { flexDirection: "row", gap: 10 },
  roleCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 14,
    gap: 4,
  },
  roleCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.input,
    alignItems: "center",
    justifyContent: "center",
  },
  roleIconActive: { backgroundColor: colors.primary },
  roleTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "900" },
  roleTitleActive: { color: colors.primary },
  roleSubtitle: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  vehicleRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  vehicleCard: {
    flex: 1,
    minHeight: 56,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  vehicleCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  vehicleLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  vehicleLabelActive: { color: colors.primary },
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
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: "75%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stateText: { fontSize: 15, color: colors.textPrimary },
});
