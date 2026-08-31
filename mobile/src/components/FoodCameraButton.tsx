import { useState } from "react";
import { Alert, Linking, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { prepareFoodImagePayload } from "../utils/foodImagePayload";
import { GREEN, GREEN_LIGHT, BG, TEXT, BORDER, WHITE } from "../theme/colors";

const askToOpenSettings = () => {
  Alert.alert(i18n.t("components.foodCamera.permissionNeeded"), i18n.t("components.foodCamera.permissionBody"), [
    { text: i18n.t("common.cancel"), style: "cancel" },
    {
      text: i18n.t("components.foodCamera.openSettings"),
      onPress: () => {
        void Linking.openSettings();
      },
    },
  ]);
};

const requestAndroidPermission = async (permission: string): Promise<boolean> => {
  if (Platform.OS !== "android") return true;
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
};

type FoodCameraButtonProps = {
  disabled?: boolean;
  onImageSelected: (payload: { base64: string; mimeType?: string }) => Promise<void> | void;
  variant?: "icon" | "scanPill";
};

export const FoodCameraButton = ({ disabled, onImageSelected, variant = "icon" }: FoodCameraButtonProps) => {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const isWeb = Platform.OS === "web";
  const waitForModalToClose = () => new Promise<void>((resolve) => setTimeout(resolve, 180));

  const deriveBase64FromUri = async (uri?: string): Promise<string | null> => {
    if (!uri || !isWeb) return null;
    try {
      const commaIdx = uri.indexOf(",");
      if (uri.startsWith("data:") && commaIdx > 0) {
        return uri.slice(commaIdx + 1);
      }
      const response = await fetch(uri);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("components.foodCamera.uploadedFileError")));
        reader.readAsDataURL(blob);
      });
      const dataCommaIdx = dataUrl.indexOf(",");
      if (dataCommaIdx < 0) return null;
      return dataUrl.slice(dataCommaIdx + 1);
    } catch {
      return null;
    }
  };

  const deriveBase64FromWebFile = async (file?: File): Promise<string | null> => {
    if (!file || !isWeb) return null;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("components.foodCamera.uploadedFileError")));
        reader.readAsDataURL(file);
      });
      const commaIdx = dataUrl.indexOf(",");
      if (commaIdx < 0) return null;
      return dataUrl.slice(commaIdx + 1);
    } catch {
      return null;
    }
  };

  const resolveAssetBase64 = async (asset?: ImagePicker.ImagePickerAsset): Promise<string | null> => {
    if (!asset) return null;
    if (asset.base64) return asset.base64;
    const webFile = (asset as ImagePicker.ImagePickerAsset & { file?: File }).file;
    return (await deriveBase64FromWebFile(webFile)) || (await deriveBase64FromUri(asset.uri));
  };

  const emitPreparedImage = async (base64: string, mimeType?: string) => {
    const prepared = await prepareFoodImagePayload(base64, mimeType);
    if (!prepared.base64 || prepared.base64.length < 64) {
      Alert.alert(t("components.foodCamera.imageError"), t("components.foodCamera.imageReadError"));
      return;
    }
    await onImageSelected(prepared);
  };

  const pickFromCamera = async () => {
    try {
      const cameraGranted = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (!cameraGranted) {
        askToOpenSettings();
        return;
      }

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        askToOpenSettings();
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: isWeb ? 0.65 : 0.7,
        base64: true,
        exif: false,
        cameraType: ImagePicker.CameraType.back,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const resolvedBase64 = await resolveAssetBase64(asset);
      if (!resolvedBase64) {
        Alert.alert(t("components.foodCamera.imageError"), t("components.foodCamera.imageReadError"));
        return;
      }
      await emitPreparedImage(resolvedBase64, asset?.mimeType ?? "image/jpeg");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("components.foodCamera.cameraOpenError");
      Alert.alert(t("components.foodCamera.cameraError"), message);
    }
  };

  const pickFromGallery = async () => {
    try {
      if (Platform.OS === "android") {
        const galleryPermission =
          Platform.Version >= 33
            ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
            : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
        const granted = await requestAndroidPermission(galleryPermission);
        if (!granted) {
          askToOpenSettings();
          return;
        }
      }

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        askToOpenSettings();
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: isWeb ? 0.65 : 0.7,
        base64: true,
        exif: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const resolvedBase64 = await resolveAssetBase64(asset);
      if (!resolvedBase64) {
        Alert.alert(t("components.foodCamera.imageError"), t("components.foodCamera.imageReadError"));
        return;
      }
      await emitPreparedImage(resolvedBase64, asset?.mimeType ?? "image/jpeg");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("components.foodCamera.galleryOpenError");
      Alert.alert(t("components.foodCamera.galleryError"), message);
    }
  };

  const onSelectOption = async (type: "camera" | "gallery") => {
    setSheetOpen(false);
    if (!isWeb) {
      await waitForModalToClose();
    }
    if (type === "camera") {
      await pickFromCamera();
      return;
    }
    await pickFromGallery();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("components.foodCamera.accessibility")}
        onPress={() => !disabled && setSheetOpen(true)}
        style={({ pressed }) => [
          variant === "scanPill" ? styles.scanPill : styles.iconBtn,
          disabled && styles.disabled,
          pressed && !disabled ? styles.pressed : null,
        ]}
      >
        <Ionicons name="camera-outline" size={variant === "scanPill" ? 15 : 20} color="#F4F4F5" />
        {variant === "scanPill" ? <Text style={styles.scanLabel}>{t("components.foodCamera.scan")}</Text> : null}
      </Pressable>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetOpen(false)} />
          <View style={[styles.card, Platform.select({ ios: styles.cardIOS, android: styles.cardAndroid })]}>
            <View style={styles.handle} />
            <Text style={styles.title}>{t("components.foodCamera.title")}</Text>
            <Text style={styles.subtitle}>{t("components.foodCamera.subtitle")}</Text>
            <View style={styles.optionList}>
            {!isWeb ? (
              <Pressable style={[styles.row, styles.primaryRow]} onPress={() => void onSelectOption("camera")}>
                <View style={styles.primaryIconTile}>
                  <Ionicons name="camera-outline" size={18} color=WHITE />
                </View>
                <Text style={[styles.rowText, styles.primaryRowText]}>{t("components.foodCamera.takePhoto")}</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.row, styles.secondaryRow]} onPress={() => void onSelectOption("gallery")}>
              <View style={styles.secondaryIconTile}>
                <Ionicons name="image-outline" size={18} color=TEXT />
              </View>
              <Text style={[styles.rowText, styles.secondaryRowText]}>{t("components.foodCamera.uploadImage")}</Text>
            </Pressable>
            </View>
            <Pressable style={[styles.row, styles.cancelRow]} onPress={() => setSheetOpen(false)}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#2A2A2A",
    alignItems: "center",
    justifyContent: "center",
  },
  scanPill: {
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scanLabel: {
    color: WHITE,
    fontSize: 11,
    fontWeight: "700",
  },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: WHITE,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 24,
  },
  cardIOS: {
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  cardAndroid: { elevation: 6 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 99,
    backgroundColor: "#E5E4E0",
    alignSelf: "center",
    marginBottom: 18,
  },
  title: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
  },
  subtitle: {
    color: "#BBBBBB",
    fontSize: 11,
    marginTop: 5,
    marginBottom: 18,
  },
  optionList: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  primaryRow: {
    backgroundColor: GREEN_LIGHT,
    borderWidth: 1,
    borderColor: GREEN,
  },
  secondaryRow: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  primaryIconTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryIconTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    fontSize: 13,
    fontWeight: "700",
  },
  primaryRowText: { color: GREEN },
  secondaryRowText: { color: TEXT },
  cancelRow: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 18,
    paddingTop: 14,
    paddingBottom: 0,
    justifyContent: "center",
  },
  cancelText: {
    color: "#D85A30",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
