import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { BODY_DATA, BodyGender, SlotCategory, slotKey, BodyTypeItem } from "../../data/bodyTypeData";
import { BodyFigureSVG } from "../../components/BodyFigureSVG";
import { useBodyTypeImages } from "../../hooks/useBodyTypeImages";
import { resolveApiBaseUrl } from "../../api/client";

const ADMIN_KEY = process.env.EXPO_PUBLIC_ADMIN_KEY ?? "";

const { width: SW } = Dimensions.get("window");
const THUMB = Math.floor((SW - 40) / 3) - 8;
type UploadState = Record<string, "idle" | "uploading" | "done" | "error">;

function SlotGrid({
  title,
  items,
  gender,
  category,
  getImage,
  uploadState,
  onUpload,
  onReset,
}: {
  title: string;
  items: BodyTypeItem[];
  gender: BodyGender;
  category: SlotCategory;
  getImage: (k: string) => string | null;
  uploadState: UploadState;
  onUpload: (item: BodyTypeItem, g: BodyGender, c: SlotCategory) => void;
  onReset: (item: BodyTypeItem, g: BodyGender, c: SlotCategory) => void;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.slotGrid}>
        {items.map((item) => {
          const key = slotKey(gender, category, item.id);
          const imgUrl = getImage(key);
          const state = uploadState[key] ?? "idle";
          return (
            <View key={key} style={s.slot}>
              <TouchableOpacity
                style={s.thumb}
                onPress={() => onUpload(item, gender, category)}
                activeOpacity={0.8}
              >
                {state === "uploading" ? (
                  <View style={s.thumbInner}>
                    <ActivityIndicator color="#0F6E56" />
                  </View>
                ) : imgUrl ? (
                  <Image source={{ uri: imgUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <View style={s.thumbInner}>
                    <BodyFigureSVG
                      params={item.params}
                      gender={gender}
                      uid={`admin-${key}`}
                      width={THUMB - 16}
                    />
                  </View>
                )}
                <View style={s.camBadge}>
                  <Text style={{ fontSize: 11 }}>📷</Text>
                </View>
                {state === "done" ? (
                  <View style={[s.statusBadge, { backgroundColor: "#0F6E56" }]}>
                    <Text style={s.statusTxt}>✓</Text>
                  </View>
                ) : null}
                {state === "error" ? (
                  <View style={[s.statusBadge, { backgroundColor: "#EF4444" }]}>
                    <Text style={s.statusTxt}>!</Text>
                  </View>
                ) : null}
                {imgUrl ? (
                  <View style={s.customBadge}>
                    <Text style={s.customTxt}>Custom</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              <Text style={s.slotLabel}>{item.label}</Text>
              {imgUrl ? (
                <TouchableOpacity style={s.resetBtn} onPress={() => onReset(item, gender, category)}>
                  <Text style={s.resetTxt}>Reset</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function AdminBodyTypesScreen() {
  const { getImage, refresh } = useBodyTypeImages();
  const [uploadState, setUploadState] = useState<UploadState>({});
  const [refreshing, setRefreshing] = useState(false);
  const setState = (key: string, v: UploadState[string]) =>
    setUploadState((p) => ({ ...p, [key]: v }));

  const handleUpload = useCallback(
    async (item: BodyTypeItem, gender: BodyGender, category: SlotCategory) => {
      const key = slotKey(gender, category, item.id);
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Allow photo library access.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 5],
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      Alert.alert("Upload photo?", `Replace "${item.label}" for ${gender}s?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Upload",
          onPress: async () => {
            setState(key, "uploading");
            try {
              const form = new FormData();
              form.append("file", { uri: asset.uri, type: "image/jpeg", name: `${key}.jpg` } as any);
              form.append("slot_key", key);
              const res = await fetch(`${resolveApiBaseUrl()}/admin/body-type-image`, {
                method: "POST",
                body: form,
                headers: { "X-Admin-Key": ADMIN_KEY },
              });
              if (!res.ok) throw new Error(`${res.status}`);
              setState(key, "done");
              await refresh();
              setTimeout(() => setState(key, "idle"), 2000);
            } catch {
              setState(key, "error");
              Alert.alert("Upload failed", "Please try again.");
              setTimeout(() => setState(key, "idle"), 3000);
            }
          },
        },
      ]);
    },
    [refresh]
  );

  const handleReset = useCallback(
    (item: BodyTypeItem, gender: BodyGender, category: SlotCategory) => {
      const key = slotKey(gender, category, item.id);
      Alert.alert("Reset to default?", `Remove custom photo for "${item.label}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setState(key, "uploading");
            try {
              await fetch(`${resolveApiBaseUrl()}/admin/body-type-image/${key}`, {
                method: "DELETE",
                headers: { "X-Admin-Key": ADMIN_KEY },
              });
              setState(key, "done");
              await refresh();
              setTimeout(() => setState(key, "idle"), 1500);
            } catch {
              setState(key, "error");
              setTimeout(() => setState(key, "idle"), 2000);
            }
          },
        },
      ]);
    },
    [refresh]
  );

  const shared = { getImage, uploadState, onUpload: handleUpload, onReset: handleReset };

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor="#0F6E56"
          onRefresh={async () => {
            setRefreshing(true);
            await refresh();
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={s.pageTitle}>Body Type Photos</Text>
      <Text style={s.pageSub}>
        Tap any card to upload a custom photo.{"\n"}Tap "Reset" to revert to the built-in illustration.
      </Text>
      <View style={s.block}>
        <Text style={s.genderLbl}>♂ Male</Text>
        <SlotGrid
          title="Current Body Types"
          items={BODY_DATA.male.current}
          gender="male"
          category="current"
          {...shared}
        />
        <SlotGrid title="Goal Body Types" items={BODY_DATA.male.goal} gender="male" category="goal" {...shared} />
      </View>
      <View style={[s.block, { marginTop: 20 }]}>
        <Text style={s.genderLbl}>♀ Female</Text>
        <SlotGrid
          title="Current Body Types"
          items={BODY_DATA.female.current}
          gender="female"
          category="current"
          {...shared}
        />
        <SlotGrid
          title="Goal Body Types"
          items={BODY_DATA.female.goal}
          gender="female"
          category="goal"
          {...shared}
        />
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F9FAFB" },
  scroll: { padding: 16 },
  pageTitle: { fontSize: 22, fontWeight: "800", color: "#111827", marginBottom: 4 },
  pageSub: { fontSize: 13, color: "#6B7280", lineHeight: 20, marginBottom: 20 },
  block: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  genderLbl: { fontSize: 17, fontWeight: "700", color: "#111827", marginBottom: 14 },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.6,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  slotGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slot: { width: THUMB, alignItems: "center" },
  thumb: {
    width: THUMB,
    height: Math.round(THUMB * 1.4),
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#F3F4F6",
    position: "relative",
  },
  thumbInner: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  camBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 12,
    padding: 4,
  },
  statusBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTxt: { color: "#fff", fontSize: 11, fontWeight: "700" },
  customBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    backgroundColor: "#0F6E56",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  customTxt: { color: "#fff", fontSize: 8, fontWeight: "700" },
  slotLabel: { fontSize: 10, fontWeight: "600", color: "#374151", marginTop: 5, textAlign: "center" },
  resetBtn: {
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#FEE2E2",
  },
  resetTxt: { fontSize: 9, color: "#EF4444", fontWeight: "600" },
});
