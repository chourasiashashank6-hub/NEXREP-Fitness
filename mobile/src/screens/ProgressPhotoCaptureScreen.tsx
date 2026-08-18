import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type CameraViewRef } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { uploadProgressPhotoBackup } from "../api/progressPhotos";
import type { RootStackParamList } from "../navigation/types";
import {
  markLocalProgressPhotoBackedUp,
  saveLocalProgressPhoto,
  readLocalProgressPhotoBase64,
  type ProgressPhotoAngle,
} from "../services/progressPhotoStorage";
import { apiErrorMessage, notifyUser } from "../utils/notify";

const GREEN = "#0F6E56";
const TEXT = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.72)";

type CameraFacing = "front" | "back";

export default function ProgressPhotoCaptureScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "ProgressPhotoCapture">>();
  const initialAngle = route.params?.angle ?? "front";
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraViewRef>(null);
  const [angle, setAngle] = useState<ProgressPhotoAngle>(initialAngle);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("front");
  const [capturing, setCapturing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [backupToCloud, setBackupToCloud] = useState(false);
  const [saving, setSaving] = useState(false);

  const ensurePermission = useCallback(async () => {
    if (permission?.granted) return true;
    const result = await requestPermission();
    return Boolean(result?.granted);
  }, [permission?.granted, requestPermission]);

  const toggleCameraFacing = () => {
    setCameraFacing((current) => (current === "front" ? "back" : "front"));
  };

  const capture = async () => {
    if (Platform.OS === "web") {
      const picked = await ImagePicker.launchCameraAsync({ quality: 0.85, base64: false });
      if (picked.canceled || !picked.assets?.[0]?.uri) return;
      setPreviewUri(picked.assets[0].uri);
      return;
    }
    const ok = await ensurePermission();
    if (!ok) {
      notifyUser(t("common.error"), t("transformation.capture.permissionDenied"));
      return;
    }
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.85, skipProcessing: false });
      if (photo?.uri) setPreviewUri(photo.uri);
    } catch {
      notifyUser(t("common.error"), t("transformation.capture.captureFailed"));
    } finally {
      setCapturing(false);
    }
  };

  const savePhoto = async () => {
    if (!previewUri) return;
    setSaving(true);
    try {
      const saved = await saveLocalProgressPhoto({ sourceUri: previewUri, angle });
      if (backupToCloud) {
        const base64 = await readLocalProgressPhotoBase64(saved.localUri);
        const remote = await uploadProgressPhotoBackup({
          base64,
          takenAt: saved.takenAt,
          angle: saved.angle,
        });
        await markLocalProgressPhotoBackedUp(saved.id, { id: remote.id, storagePath: remote.storage_path });
      }
      navigation.goBack();
    } catch (error) {
      notifyUser(t("common.error"), apiErrorMessage(error, t("transformation.capture.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  if (previewUri) {
    return (
      <View style={styles.root}>
        <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />
        <View style={styles.previewChrome}>
          <Text style={styles.previewTitle}>{t("transformation.capture.previewTitle")}</Text>
          <Pressable style={styles.toggleRow} onPress={() => setBackupToCloud((v) => !v)}>
            <View style={[styles.checkbox, backupToCloud && styles.checkboxOn]} />
            <Text style={styles.toggleLabel}>{t("transformation.capture.backupOptIn")}</Text>
          </Pressable>
          <View style={styles.actions}>
            <Pressable style={styles.secondaryBtn} onPress={() => setPreviewUri(null)} disabled={saving}>
              <Text style={styles.secondaryBtnText}>{t("transformation.capture.retake")}</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={() => void savePhoto()} disabled={saving}>
              {saving ? <ActivityIndicator color={TEXT} /> : <Text style={styles.primaryBtnText}>{t("transformation.capture.save")}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (Platform.OS !== "web" && !permission?.granted) {
    return (
      <View style={styles.permissionWrap}>
        <Text style={styles.permissionTitle}>{t("transformation.capture.permissionTitle")}</Text>
        <Text style={styles.permissionBody}>{t("transformation.capture.permissionBody")}</Text>
        <Pressable style={styles.primaryBtn} onPress={() => void ensurePermission()}>
          <Text style={styles.primaryBtnText}>{t("transformation.capture.allowCamera")}</Text>
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.closeBtnText}>{t("common.cancel")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {Platform.OS === "web" ? (
        <View style={styles.webFallback}>
          <Text style={styles.webFallbackText}>{t("transformation.capture.webFallback")}</Text>
          <Pressable style={styles.primaryBtn} onPress={() => void capture()}>
            <Text style={styles.primaryBtnText}>{t("transformation.capture.openCamera")}</Text>
          </Pressable>
        </View>
      ) : (
        <CameraView ref={cameraRef} style={styles.camera} facing={cameraFacing} mirror={cameraFacing === "front"}>
          <View style={styles.overlay} pointerEvents="none">
            <Text style={styles.guideText}>{t("transformation.capture.framingHint")}</Text>
          </View>
        </CameraView>
      )}
      <View style={styles.topBar}>
        <Pressable style={styles.iconBtn} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.closeBtnText}>×</Text>
        </Pressable>
        {Platform.OS !== "web" ? (
          <Pressable
            style={styles.iconBtn}
            onPress={toggleCameraFacing}
            accessibilityRole="button"
            accessibilityLabel={t("transformation.capture.flipCamera")}
          >
            <Ionicons name="camera-reverse-outline" size={22} color={TEXT} />
          </Pressable>
        ) : (
          <View style={styles.iconBtnPlaceholder} />
        )}
      </View>
      <View style={styles.controls}>
        <View style={styles.angleRow}>
          {(["front", "side"] as ProgressPhotoAngle[]).map((value) => (
            <Pressable
              key={value}
              style={[styles.anglePill, angle === value && styles.anglePillOn]}
              onPress={() => setAngle(value)}
            >
              <Text style={[styles.angleText, angle === value && styles.angleTextOn]}>{t(`transformation.angles.${value}`)}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.shutter} onPress={() => void capture()} disabled={capturing}>
          {capturing ? <ActivityIndicator color={GREEN} /> : <View style={styles.shutterInner} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: { flex: 1, justifyContent: "flex-end", paddingBottom: 180 },
  guideText: { color: TEXT, fontSize: 14, fontWeight: "600", textAlign: "center", paddingHorizontal: 24 },
  topBar: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 24,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnPlaceholder: { width: 40, height: 40 },
  controls: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 36, paddingHorizontal: 20, gap: 16 },
  closeBtn: { marginTop: 8 },
  closeBtnText: { color: TEXT, fontSize: 24, lineHeight: 28 },
  angleRow: { flexDirection: "row", justifyContent: "center", gap: 10 },
  anglePill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.14)" },
  anglePillOn: { backgroundColor: GREEN },
  angleText: { color: MUTED, fontWeight: "700", fontSize: 13 },
  angleTextOn: { color: TEXT },
  shutter: { alignSelf: "center", width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: TEXT, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: TEXT },
  permissionWrap: { flex: 1, backgroundColor: "#111", alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  permissionTitle: { color: TEXT, fontSize: 20, fontWeight: "800", textAlign: "center" },
  permissionBody: { color: MUTED, fontSize: 14, textAlign: "center", lineHeight: 20 },
  primaryBtn: { backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, minWidth: 160, alignItems: "center" },
  primaryBtnText: { color: TEXT, fontWeight: "800", fontSize: 15 },
  secondaryBtn: { borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20 },
  secondaryBtnText: { color: TEXT, fontWeight: "700" },
  preview: { flex: 1 },
  previewChrome: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 36, backgroundColor: "rgba(0,0,0,0.72)", gap: 12 },
  previewTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: TEXT },
  checkboxOn: { backgroundColor: GREEN, borderColor: GREEN },
  toggleLabel: { color: TEXT, flex: 1, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  webFallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  webFallbackText: { color: MUTED, textAlign: "center", lineHeight: 20 },
});
