import { useState } from "react";
import { Alert, Linking, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { prepareFoodImagePayload } from "../utils/foodImagePayload";

const askToOpenSettings = () => {
  Alert.alert("Permission needed", "Please allow camera or photo library access in settings to scan food.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Open Settings",
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
};

export const FoodCameraButton = ({ disabled, onImageSelected }: FoodCameraButtonProps) => {
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
        reader.onerror = () => reject(new Error("Failed to read uploaded file."));
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
        reader.onerror = () => reject(new Error("Failed to read uploaded file."));
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
      Alert.alert("Image error", "Could not read image data. Please try again.");
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
        Alert.alert("Image error", "Could not read image data. Please try again.");
        return;
      }
      await emitPreparedImage(resolvedBase64, asset?.mimeType ?? "image/jpeg");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open camera.";
      Alert.alert("Camera error", message);
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
        Alert.alert("Image error", "Could not read image data. Please try again.");
        return;
      }
      await emitPreparedImage(resolvedBase64, asset?.mimeType ?? "image/jpeg");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open gallery.";
      Alert.alert("Gallery error", message);
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
        accessibilityLabel="Analyze food from photo"
        onPress={() => !disabled && setSheetOpen(true)}
        style={({ pressed }) => [styles.iconBtn, disabled && styles.disabled, pressed && !disabled ? styles.pressed : null]}
      >
        <Ionicons name="camera-outline" size={20} color="#F4F4F5" />
      </Pressable>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetOpen(false)} />
          <View style={[styles.card, Platform.select({ ios: styles.cardIOS, android: styles.cardAndroid })]}>
            <Text style={styles.title}>Add food photo</Text>
            {!isWeb ? (
              <Pressable style={styles.row} onPress={() => void onSelectOption("camera")}>
                <Text style={styles.rowText}>Take Photo</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.row} onPress={() => void onSelectOption("gallery")}>
              <Text style={styles.rowText}>{isWeb ? "Upload Image" : "Choose from Gallery"}</Text>
            </Pressable>
            <Pressable style={[styles.row, styles.cancelRow]} onPress={() => setSheetOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
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
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    padding: 16,
  },
  card: {
    backgroundColor: "#0f1620",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  cardIOS: {
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  cardAndroid: { elevation: 6 },
  title: {
    color: "#F4F4F5",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
    paddingHorizontal: 6,
  },
  row: {
    paddingVertical: 13,
    paddingHorizontal: 8,
  },
  rowText: {
    color: "#F4F4F5",
    fontSize: 15,
    fontWeight: "600",
  },
  cancelRow: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    marginTop: 2,
  },
  cancelText: {
    color: "#F87171",
    fontSize: 15,
    fontWeight: "700",
  },
});
