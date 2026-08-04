// Driver verification: submit ID/license documents (uploaded via /api/upload).
// Identity is confirmed with a live selfie + face liveness check (no photo uploads).
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { api, type DriverVerification, type LivenessResult } from "@/src/lib/api";
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
  const [liveness, setLiveness] = useState<LivenessResult | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [checkingLiveness, setCheckingLiveness] = useState(false);

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
      if (v.liveness_status === "passed" || v.liveness_status === "failed") {
        setLiveness({ status: v.liveness_status, liveness_status: v.liveness_status, liveness_ref: v.liveness_ref, message: "" });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load verification status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pickAndUpload = useCallback(async () => {
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
      setDocuments((prev) => [...prev, uploaded.url]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, []);

  const confirmSelfie = useCallback(async () => {
    if (!capturedUri) return;
    setUploading(true);
    setMessage(null);
    try {
      const uploaded = await api.uploadFile({
        uri: capturedUri,
        name: `selfie_${Date.now()}.jpg`,
        type: "image/jpeg",
      });
      setProfilePhoto(uploaded.url);
      setShowCamera(false);
      setCapturedUri(null);
      setCheckingLiveness(true);
      const res = await api.submitDriverLiveness({ selfie_url: uploaded.url });
      setLiveness(res);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not run the liveness check.");
    } finally {
      setUploading(false);
      setCheckingLiveness(false);
    }
  }, [capturedUri]);

  const submit = useCallback(async () => {
    if (!idNumber.trim()) {
      setMessage("Enter your ID number.");
      return;
    }
    if (documents.length === 0) {
      setMessage("Upload at least one document.");
      return;
    }
    if (liveness?.status !== "passed") {
      setMessage("Complete the live selfie liveness check before submitting.");
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
      setMessage(v.verification_status === "verified" ? "You're verified! You can now go online." : "Verification submitted for review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit verification.");
    } finally {
      setBusy(false);
    }
  }, [idType, idNumber, licenseNumber, licenseExpiry, profilePhoto, documents, liveness]);

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

            <Text style={styles.section}>Live selfie (face liveness)</Text>
            <TouchableOpacity style={styles.uploadCard} onPress={() => setShowCamera(true)} disabled={uploading || checkingLiveness} testID="verify-selfie">
              <View style={styles.uploadIcon}>
                {liveness?.status === "passed" ? <Ionicons name="checkmark-circle" size={22} color={colors.empty} /> : <Ionicons name="scan" size={22} color={colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>{liveness?.status === "passed" ? "Liveness passed" : "Take a live selfie"}</Text>
                <Text style={styles.uploadMeta}>A live photo (not an uploaded one) confirms that this is really you</Text>
              </View>
              {checkingLiveness ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
            </TouchableOpacity>
            {liveness?.status === "failed" ? (
              <View style={styles.livenessFail}><Ionicons name="alert-circle" size={16} color={colors.delayed} /><Text style={styles.livenessFailText}>Liveness check failed. Retake with a clear, well-lit photo of your face.</Text></View>
            ) : null}

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
            <TouchableOpacity style={styles.uploadCard} onPress={pickAndUpload} disabled={uploading} testID="verify-doc-upload">
              <View style={styles.uploadIcon}><Ionicons name="document-attach" size={22} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>Add document</Text>
                <Text style={styles.uploadMeta}>National ID / NIN / passport / license</Text>
              </View>
              {uploading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="cloud-upload" size={20} color={colors.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.submitBtn, (busy || uploading || checkingLiveness) && { opacity: 0.6 }]} onPress={submit} disabled={busy || uploading || checkingLiveness} testID="verify-submit">
              {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.submitText}>Submit for verification</Text></>}
            </TouchableOpacity>
          </>
        )}

        {showCamera ? <SelfieCameraModal visible onClose={() => { setShowCamera(false); setCapturedUri(null); }} onCaptured={(uri) => setCapturedUri(uri)} capturedUri={capturedUri} onRetake={() => setCapturedUri(null)} onConfirm={confirmSelfie} uploading={uploading} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SelfieCameraModal({
  visible,
  onClose,
  onCaptured,
  capturedUri,
  onRetake,
  onConfirm,
  uploading,
}: {
  visible: boolean;
  onClose: () => void;
  onCaptured: (uri: string) => void;
  capturedUri: string | null;
  onRetake: () => void;
  onConfirm: () => void;
  uploading: boolean;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);

  const take = useCallback(async () => {
    if (!cameraRef.current || !ready) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (photo) onCaptured(photo.uri);
  }, [cameraRef, ready, onCaptured]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.cameraWrap}>
        {capturedUri ? (
          <>
            <Image source={{ uri: capturedUri }} style={styles.cameraPreview} />
            <View style={styles.cameraActions}>
              <TouchableOpacity style={styles.retakeBtn} onPress={onRetake} disabled={uploading}>
                <Ionicons name="refresh" size={20} color={colors.primary} />
                <Text style={styles.retakeText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, uploading && { opacity: 0.6 }]} onPress={onConfirm} disabled={uploading} testID="selfie-confirm">
                {uploading ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.confirmText}>Use this photo</Text></>}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="front"
              onCameraReady={() => setReady(true)}
            />
            {!permission?.granted ? (
              <View style={styles.cameraPermOverlay}>
                <Ionicons name="camera" size={30} color="#fff" />
                <Text style={styles.cameraPermText}>Camera access is required for the liveness selfie.</Text>
                <TouchableOpacity style={styles.confirmBtn} onPress={requestPermission}><Text style={styles.confirmText}>Grant access</Text></TouchableOpacity>
              </View>
            ) : (
              <View style={styles.cameraOverlay}>
                <View style={styles.cameraFrame} />
                <Text style={styles.cameraHint}>Center your face in the frame</Text>
                <View style={styles.cameraActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.shutterBtn} onPress={take} testID="selfie-capture">
                    <Ionicons name="camera" size={26} color="#fff" />
                  </TouchableOpacity>
                  <View style={{ width: 64 }} />
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
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
  uploadTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" },
  uploadMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", marginTop: 2 },
  livenessFail: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radii.md, marginTop: 10, backgroundColor: `${colors.delayed}1A`, alignItems: "center" },
  livenessFailText: { flex: 1, color: colors.delayed, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 12, marginTop: 8 },
  docName: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  submitBtn: { minHeight: 54, marginTop: 22, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  cameraWrap: { flex: 1, backgroundColor: "#000" },
  cameraPreview: { flex: 1, resizeMode: "cover" },
  cameraPermOverlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 32 },
  cameraPermText: { color: "#fff", fontSize: 14, fontWeight: "700", textAlign: "center" },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "space-between", paddingVertical: 60 },
  cameraFrame: { width: 240, height: 240, borderRadius: 120, borderWidth: 3, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.08)" },
  cameraHint: { color: "#fff", fontSize: 13, fontWeight: "700", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  cameraActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 28, gap: 18 },
  shutterBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#fff" },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  cancelText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  retakeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 16 },
  retakeText: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  confirmBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, borderRadius: radii.pill, paddingVertical: 12, paddingHorizontal: 20 },
  confirmText: { color: "#fff", fontSize: 14, fontWeight: "900" },
});
