import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { fetchXpSummary } from "../api/xp";
import { getStrengthProgress } from "../api/strength";
import { getWorkoutHistory } from "../api/workout";
import { fetchWeightHistory } from "../api/weight";
import { ScreenContainer } from "../components/ScreenContainer";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { navigationRef } from "../navigation/navigationRef";
import {
  deleteProgressPhotoEntry,
  listMergedProgressPhotos,
  updateProgressPhotoEntryAngle,
  type ProgressPhotoAngle,
  type ProgressPhotoListEntry,
} from "../services/progressPhotoStorage";
import { buildTransformationSummary } from "../utils/buildTransformationSummary";
import { GREEN, GREEN_LIGHT, BG, TEXT, MUTED, BORDER, WHITE } from "../theme/colors";

const pad2 = (n: number) => String(n).padStart(2, "0");
const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export function TransformationTimelineScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { hasFeatureAccess } = useFeatureAccess();
  const canCompare = hasFeatureAccess("progress_photo_comparison");
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<ProgressPhotoListEntry[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryView, setSummaryView] = useState<ReturnType<typeof buildTransformationSummary> | null>(null);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 90);
    return { fromDate: toIsoDate(from), toDate: toIsoDate(to) };
  }, []);

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try {
      setPhotos(await listMergedProgressPhotos());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPhotos();
    }, [loadPhotos]),
  );

  const openCapture = () => {
    navigationRef.navigate("ProgressPhotoCapture" as never);
  };

  const loadSummary = async () => {
    if (!canCompare) {
      navigation.getParent()?.navigate("Profile", { screen: "Subscription" });
      return;
    }
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const [weight, strength, workouts, xp] = await Promise.all([
        fetchWeightHistory(365).catch(() => null),
        getStrengthProgress().catch(() => null),
        getWorkoutHistory({ range: "all", limit: 200 }).catch(() => null),
        fetchXpSummary().catch(() => null),
      ]);
      setSummaryView(
        buildTransformationSummary({
          fromDate: range.fromDate,
          toDate: range.toDate,
          weightEntries: (weight?.entries ?? []).map((entry) => ({
            log_date: entry.log_date,
            weight_kg: entry.weight_kg,
          })),
          strengthProgress: strength,
          workoutItems: workouts?.items ?? [],
          xpSummary: xp,
        }),
      );
    } catch {
      setSummaryError(t("transformation.summary.loadFailed"));
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    if (canCompare) void loadSummary();
  }, [canCompare, range.fromDate, range.toDate]);

  const formatWeightDelta = (delta: number | null) => {
    if (delta == null) return t("transformation.summary.noWeightData");
    if (delta === 0) return t("transformation.summary.weightStable");
    return delta > 0
      ? t("transformation.summary.weightUp", { kg: Math.abs(delta).toFixed(1) })
      : t("transformation.summary.weightDown", { kg: Math.abs(delta).toFixed(1) });
  };

  const togglePhotoAngle = (photo: ProgressPhotoListEntry) => {
    const nextAngle: ProgressPhotoAngle = photo.angle === "front" ? "side" : "front";
    void (async () => {
      try {
        await updateProgressPhotoEntryAngle(photo, nextAngle);
        await loadPhotos();
      } catch {
        Alert.alert(t("common.error"), t("transformation.gallery.angleUpdateFailed"));
      }
    })();
  };

  const confirmDeletePhoto = (photo: ProgressPhotoListEntry) => {
    Alert.alert(t("transformation.gallery.deleteConfirmTitle"), t("transformation.gallery.deleteConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("transformation.gallery.delete"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteProgressPhotoEntry(photo);
              await loadPhotos();
            } catch {
              Alert.alert(t("common.error"), t("transformation.gallery.deleteFailed"));
            }
          })();
        },
      },
    ]);
  };

  return (
    <ScreenContainer bg={BG}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t("transformation.title")}</Text>
          <Text style={styles.sub}>{t("transformation.subtitle")}</Text>
        </View>
        <Pressable style={styles.captureBtn} onPress={openCapture}>
          <Text style={styles.captureBtnText}>+</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={GREEN} style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>{t("transformation.summary.title")}</Text>
            {!canCompare ? (
              <Pressable style={styles.proGate} onPress={() => navigation.getParent()?.navigate("Profile", { screen: "Subscription" })}>
                <Text style={styles.proGateTitle}>{t("transformation.summary.proGateTitle")}</Text>
                <Text style={styles.proGateBody}>{t("transformation.summary.proGateBody")}</Text>
              </Pressable>
            ) : summaryLoading ? (
              <ActivityIndicator color={GREEN} />
            ) : summaryError ? (
              <Text style={styles.errorText}>{summaryError}</Text>
            ) : summaryView ? (
              <View style={styles.summaryGrid}>
                <View style={styles.summaryTile}>
                  <Text style={styles.summaryLabel}>{t("transformation.summary.weight")}</Text>
                  <Text style={styles.summaryValue}>{formatWeightDelta(summaryView.weightDeltaKg)}</Text>
                </View>
                <View style={styles.summaryTile}>
                  <Text style={styles.summaryLabel}>{t("transformation.summary.workouts")}</Text>
                  <Text style={styles.summaryValue}>{summaryView.workoutCount}</Text>
                </View>
                <View style={styles.summaryTile}>
                  <Text style={styles.summaryLabel}>{t("transformation.summary.prs")}</Text>
                  <Text style={styles.summaryValue}>{summaryView.prCount}</Text>
                </View>
                {summaryView.level ? (
                  <View style={styles.summaryTile}>
                    <Text style={styles.summaryLabel}>{t("transformation.summary.level")}</Text>
                    <Text style={styles.summaryValue}>{summaryView.level}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {canCompare ? (
              <Pressable style={styles.refreshSummaryBtn} onPress={() => void loadSummary()} disabled={summaryLoading}>
                <Text style={styles.refreshSummaryText}>{t("transformation.summary.refresh")}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.sectionTitle}>{t("transformation.gallery.title")}</Text>
          {photos.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("transformation.gallery.emptyTitle")}</Text>
              <Text style={styles.emptyBody}>{t("transformation.gallery.emptyBody")}</Text>
              <Pressable style={styles.primaryBtn} onPress={openCapture}>
                <Text style={styles.primaryBtnText}>{t("transformation.gallery.captureCta")}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.galleryGrid}>
              {photos.map((photo) => (
                <View key={photo.id} style={styles.photoCard}>
                  <Image source={{ uri: photo.displayUri }} style={styles.photoImage} resizeMode="cover" />
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => confirmDeletePhoto(photo)}
                    accessibilityRole="button"
                    accessibilityLabel={t("transformation.gallery.delete")}
                  >
                    <Ionicons name="trash-outline" size={16} color={WHITE} />
                  </Pressable>
                  <View style={styles.photoMeta}>
                    <Text style={styles.photoDate}>{photo.takenAt.slice(0, 10)}</Text>
                    <Pressable onPress={() => togglePhotoAngle(photo)} accessibilityRole="button">
                      <Text style={styles.photoAngle}>
                        {t(`transformation.angles.${photo.angle}`)} · {t("transformation.gallery.tapToChangeAngle")}
                      </Text>
                    </Pressable>
                    {photo.backedUp ? <Text style={styles.photoBackedUp}>{t("transformation.gallery.backedUp")}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", color: TEXT },
  sub: { fontSize: 13, color: MUTED, marginTop: 2 },
  captureBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  captureBtnText: { color: WHITE, fontSize: 24, lineHeight: 28, fontWeight: "700" },
  loader: { marginTop: 40 },
  body: { padding: 16, gap: 16, paddingBottom: 40 },
  summaryCard: { backgroundColor: WHITE, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: TEXT },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  summaryTile: { minWidth: "45%", flexGrow: 1, backgroundColor: GREEN_LIGHT, borderRadius: 12, padding: 12 },
  summaryLabel: { fontSize: 12, color: MUTED, fontWeight: "700" },
  summaryValue: { fontSize: 18, fontWeight: "800", color: TEXT, marginTop: 4 },
  proGate: { backgroundColor: GREEN_LIGHT, borderRadius: 12, padding: 14, gap: 4 },
  proGateTitle: { fontSize: 14, fontWeight: "800", color: GREEN },
  proGateBody: { fontSize: 13, color: MUTED, lineHeight: 18 },
  refreshSummaryBtn: { alignSelf: "flex-start" },
  refreshSummaryText: { color: GREEN, fontWeight: "700", fontSize: 13 },
  errorText: { color: "#D85A30", fontSize: 13 },
  emptyCard: { backgroundColor: WHITE, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: BORDER, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: TEXT },
  emptyBody: { fontSize: 13, color: MUTED, lineHeight: 18 },
  primaryBtn: { marginTop: 8, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  primaryBtnText: { color: WHITE, fontWeight: "800" },
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  photoCard: { width: "47%", backgroundColor: WHITE, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: BORDER, position: "relative" },
  photoImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: "#DDD" },
  deleteBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoMeta: { padding: 10, gap: 2 },
  photoDate: { fontSize: 13, fontWeight: "700", color: TEXT },
  photoAngle: { fontSize: 12, color: MUTED },
  photoBackedUp: { fontSize: 11, color: GREEN, fontWeight: "700" },
});
