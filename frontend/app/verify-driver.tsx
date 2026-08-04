// Driver verification: submit ID/license documents (uploaded via /api/upload).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api, type DriverVerification } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/lib/theme";

const ID_TYPES = [
  { key: "national_id", label: "National ID" },
  { key: "nin", label: "NIN" },
  { key: "passport", label: "Passport" },
  { key: "driver_license", label: "Driver's license" },
];

const STATUS_INFO: Record<string, { color: string; text: string }> = {
  unverified: { color: colors.textSecondary, text: "You haven't submitted your documents yet." },
  pending: { color: colors.moderate, text: "Documents under review. You'll be notified when approved." },
  verified: { color: colors.empty, text: "You're verified and can accept jobs." },
  rejected: { color: colors.delayed, text: "Your submission was rejected." },
};

export default function VerifyDriverScreen() {
  const [verification, setVerification] = useState<DriverVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [idType, setIdType] = useState("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [documents, setDocuments] = useState<string[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api.getDriverVerification();
      setVerification(v);
      setIdType(v.id_type ?? "national_id");
      setIdNumber(v.id_number ?? "");
      setLicenseNumber(v.license_number ?? "");
      setLicenseExpiry(v.license_expiry ?? "");
      setProfilePhoto(v.profile_photo);
      setDocuments(v.document_urls ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load verification status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pickAndUpload = useCallback(async (mode: "photo" | "doc") => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload your documents.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setUploading(true);
    setMessage(null);
    try {
      const uploaded = await api.uploadFile({
        uri: asset.uri,
        name: asset.fileName ?? `upload_${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      });
      if (mode === "photo") {
        setProfilePhoto(uploaded.url);
        setPhotoPreview(asset.uri);
      } else {
        setDocuments((prev) => [...prev, uploaded.url]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, []);

  const submit = useCallback(async () => {
    if (!idNumber.trim()) {
      setMessage("Enter your ID number.");
      return;
    }
    if (documents.length === 0) {
      setMessage("Upload at least one document.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const v = await api.submitDriverVerification({
        id_type: idType,
        id_number: idNumber.trim(),
        license_number: licenseNumber.trim() || null,
        license_expiry: licenseExpiry || null,
        profile_photo: profilePhoto,
        document_urls: documents,
      });
      setVerification(v);
      setMessage("Verification submitted for review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit verification.");
    } finally {
      setBusy(false);
    }
  }, [idType, idNumber, licenseNumber, licenseExpiry, profilePhoto, documents]);

  const status = verification?.verification_status ?? "unverified";
  const statusInfo = STATUS_INFO[status] ?? STATUS_INFO.unverified;
  const canEdit = status === "unverified" || status === "rejected";

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="shield-checkmark" size={22} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Driver verification</Text>
            <Text style={styles.subtitle}>Prove your identity to start earning</Text>
          </View>
        </View>

        <View style={[styles.statusBanner, { backgroundColor: `${statusInfo.color}1A` }]}>
          <Ionicons name="document-text" size={18} color={statusInfo.color} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: statusInfo.color }]}>{status[0].toUpperCase() + status.slice(1)}</Text>
            <Text style={styles.statusText}>{statusInfo.text}</Text>
          </View>
        </View>
        {verification?.verification_note ? (
          <View style={styles.noteCard}><Ionicons name="chatbox-ellipses" size={16} color={colors.textSecondary} /><Text style={styles.noteText}>Admin note: {verification.verification_note}</Text></View>
        ) : null}

        {message ? <View style={styles.status}><Ionicons name="information-circle" size={16} color={colors.primary} /><Text style={styles.statusMsgText}>{message}</Text></View> : null}

        {!canEdit ? (
          <View style={styles.status}><Ionicons name="lock-closed" size={16} color={colors.textSecondary} /><Text style={styles.statusMsgText}>Documents cannot be edited while your status is {status}.</Text></View>
        ) : (
          <>
            <Text style={styles.section}>ID type</Text>
            <View style={styles.idRow}>
              {ID_TYPES.map((t) => (
                <TouchableOpacity key={t.key} onPress={() => setIdType(t.key)} style={[styles.idChip, idType === t.key && styles.idChipActive]}>
                  <Text style={[styles.idChipText, idType === t.key && styles.idChipTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.formCard}>
              <TextInput style={styles.input} placeholder="ID number" placeholderTextColor={colors.textSecondary} value={idNumber} onChangeText={setIdNumber} />
              <TextInput style={styles.input} placeholder="Driver's license number (optional)" placeholderTextColor={colors.textSecondary} value={licenseNumber} onChangeText={setLicenseNumber} />
              <TextInput style={styles.input} placeholder="License expiry (e.g. 2028-05-30)" placeholderTextColor={colors.textSecondary} autoCapitalize="none" value={licenseExpiry} onChangeText={setLicenseExpiry} />
            </View>

            <Text style={styles.section}>Profile photo</Text>
            <TouchableOpacity style={styles.uploadCard} onPress={() => pickAndUpload("photo")} disabled={uploading} testID="verify-photo-upload">
              {photoPreview ? <Image source={{ uri: photoPreview }} style={styles.preview} /> : profilePhoto ? <Image source={{ uri: profilePhoto }} style={styles.preview} /> : <View style={styles.uploadIcon}><Ionicons name="camera" size={22} color={colors.primary} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>{photoPreview || profilePhoto ? "Change profile photo" : "Upload profile photo"}</Text>
                <Text style={styles.uploadMeta}>JPG, PNG or WEBP up to 5 MB</Text>
              </View>
              {uploading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="cloud-upload" size={20} color={colors.primary} />}
            </TouchableOpacity>

            <Text style={styles.section}>Documents ({documents.length})</Text>
            {documents.map((url, i) => (
              <View key={url} style={styles.docRow}>
                <Ionicons name="document" size={16} color={colors.primary} />
                <Text style={styles.docName} numberOfLines={1}>Document {i + 1} — {url.split("/").pop()}</Text>
                <TouchableOpacity onPress={() => setDocuments((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.delayed} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.uploadCard} onPress={() => pickAndUpload("doc")} disabled={uploading} testID="verify-doc-upload">
              <View style={styles.uploadIcon}><Ionicons name="document-attach" size={22} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>Add document</Text>
                <Text style={styles.uploadMeta}>National ID / NIN / passport / license</Text>
              </View>
              {uploading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="cloud-upload" size={20} color={colors.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.submitBtn, (busy || uploading) && { opacity: 0.6 }]} onPress={submit} disabled={busy || uploading} testID="verify-submit">
              {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.submitText}>Submit for review</Text></>}
            </TouchableOpacity>
          </>
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
  statusBanner: { flexDirection: "row", gap: 10, padding: 14, borderRadius: radii.lg, marginTop: spacing.md, alignItems: "center" },
  statusTitle: { fontSize: 15, fontWeight: "900", textTransform: "capitalize" },
  statusText: { color: colors.textPrimary, fontSize: 12, fontWeight: "600", marginTop: 2, lineHeight: 17 },
  noteCard: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 10, backgroundColor: colors.input, alignItems: "center" },
  noteText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  status: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.lg, marginTop: 12, backgroundColor: colors.primaryLight, alignItems: "center" },
  statusMsgText: { flex: 1, color: colors.primaryDark, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  section: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 9 },
  idRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  idChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  idChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  idChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  idChipTextActive: { color: colors.primary },
  formCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, marginTop: 14, gap: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, fontWeight: "600", backgroundColor: colors.input },
  uploadCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, marginTop: 10 },
  uploadIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  preview: { width: 44, height: 44, borderRadius: 22 },
  uploadTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" },
  uploadMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 12, marginTop: 8 },
  docName: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  submitBtn: { minHeight: 54, marginTop: 22, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "900" },
});
