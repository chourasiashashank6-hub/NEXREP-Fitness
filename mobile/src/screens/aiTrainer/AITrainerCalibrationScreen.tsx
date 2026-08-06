import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { usePoseCalibrationStore } from "../../store/poseCalibrationStore";
import type { PoseCalibration } from "../../data/aiTrainer/types";
import type { RootStackParamList } from "../../navigation/types";
import { useTranslation } from "react-i18next";
import { unlockWebSpeech } from "../../services/aiTrainer/audioCoach";
import {
  buildInjectedCalibrationScript,
  type CalibrationStepId,
} from "../../services/aiTrainer/mediaPipeCalibrationTemplate";
import {
  acquireMediaPipeServer,
  MEDIAPIPE_CALIBRATION_PAGE,
  releaseMediaPipeServer,
} from "../../services/aiTrainer/mediaPipeLocalServer";

const MINT = "#2DD4A7";
const GLASS = "rgba(10,22,18,0.62)";
const BG = "#050b16";

type Props = NativeStackScreenProps<RootStackParamList, "AITrainerCalibration">;

const STEPS = [
  { id: "tpose" as const, durationSec: 10 },
  { id: "squats" as const, durationSec: 20 },
  { id: "turn" as const, durationSec: 8 },
] as const;

export default function AITrainerCalibrationScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const planId = route.params?.planId;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [serverUri, setServerUri] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const partialRef = useRef<Partial<PoseCalibration>>({});
  const setCalibration = usePoseCalibrationStore((s) => s.setCalibration);
  const skipCalibration = usePoseCalibrationStore((s) => s.skipCalibration);

  const stepId: CalibrationStepId = STEPS[step]?.id || "tpose";

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    setServerUri(null);
    setServerError(null);
    acquireMediaPipeServer(MEDIAPIPE_CALIBRATION_PAGE)
      .then((uri) => {
        if (!cancelled) setServerUri(uri);
      })
      .catch((err) => {
        if (!cancelled) {
          setServerError(err instanceof Error ? err.message : "Camera server failed to start.");
        }
      });
    return () => {
      cancelled = true;
      releaseMediaPipeServer();
    };
  }, []);

  const continueToSession = useCallback(() => {
    if (Platform.OS === "web") unlockWebSpeech();
    if (planId != null) {
      navigation.replace("AICameraWorkoutSession", { planId });
    } else {
      navigation.goBack();
    }
  }, [navigation, planId]);

  const onMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      try {
        const parsed = JSON.parse(event.nativeEvent.data || "{}") as {
          type?: string;
          calibration?: PoseCalibration;
          step?: string;
        };
        if (parsed.type !== "stepComplete" || !parsed.calibration) return;
        const cal = parsed.calibration;
        partialRef.current = {
          ...partialRef.current,
          ...cal,
          limbs: { ...partialRef.current.limbs, ...cal.limbs },
          mobility: { ...partialRef.current.mobility, ...cal.mobility },
        };
        if (step < STEPS.length - 1) {
          setStep((s) => s + 1);
          return;
        }
        setBusy(true);
        const mergedLimbs = { ...partialRef.current.limbs, ...cal.limbs };
        const mergedMobility = { ...partialRef.current.mobility, ...cal.mobility };
        const finalCal: PoseCalibration = {
          ...partialRef.current,
          ...cal,
          limbs: mergedLimbs,
          mobility: mergedMobility,
          asymmetryFlags: cal.asymmetryFlags || [],
          calibratedAt: new Date().toISOString(),
          version: 1,
        } as PoseCalibration;
        await setCalibration(finalCal);
        setBusy(false);
        continueToSession();
      } catch {
        // ignore
      }
    },
    [continueToSession, setCalibration, step],
  );

  const onSkip = () => {
    if (Platform.OS === "web") unlockWebSpeech();
    skipCalibration();
    continueToSession();
  };

  const checklist = [
    t("aiTrainer.cal_limb", { defaultValue: "Limb proportions" }),
    t("aiTrainer.cal_baseline", { defaultValue: "Standing baseline" }),
    t("aiTrainer.cal_mobility", { defaultValue: "Mobility" }),
    t("aiTrainer.cal_depth", { defaultValue: "Personal depth range" }),
  ];

  return (
    <View style={styles.root}>
      {serverError ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>{t("mediaPipe.serverError")}</Text>
          <Text style={styles.errorSub}>{serverError}</Text>
        </View>
      ) : serverUri ? (
        <WebView
          key={`cal-step-${step}`}
          source={{ uri: serverUri }}
          injectedJavaScriptBeforeContentLoaded={buildInjectedCalibrationScript(stepId)}
          style={styles.webview}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          javaScriptEnabled
          onMessage={onMessage}
        />
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator color={MINT} size="large" />
          <Text style={styles.loadingTxt}>
            {t("mediaPipe.loadingTracker", { defaultValue: "Loading pose tracker…" })}
          </Text>
        </View>
      )}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.card, { maxWidth: Math.min(420, width - 24) }]}>
          <Text style={styles.title}>
            {t("aiTrainer.cal_title", { defaultValue: "Body calibration" })}
          </Text>
          <Text style={styles.sub}>
            {t("aiTrainer.cal_fair", {
              defaultValue: "We scale angles to your body so coaching stays fair across body types.",
            })}
          </Text>
          {checklist.map((label, i) => {
            const done = step > i || (step === STEPS.length - 1 && busy);
            const active = step === i || (i === 3 && step >= 1);
            return (
              <View key={label} style={styles.row}>
                <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]} />
                <Text style={styles.rowTxt}>{label}</Text>
              </View>
            );
          })}
          <Text style={styles.stepLabel}>
            {t("aiTrainer.cal_step", { defaultValue: "Step" })} {step + 1}/{STEPS.length}
            {busy ? "…" : ""}
          </Text>
          <Pressable style={styles.skip} onPress={onSkip}>
            <Text style={styles.skipTxt}>
              {t("aiTrainer.cal_skip", { defaultValue: "Skip for now" })}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  webview: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  loadingTxt: { color: "rgba(255,255,255,0.8)", fontWeight: "600" },
  errorTitle: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  errorSub: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-start" },
  card: {
    margin: 12,
    marginTop: 56,
    backgroundColor: GLASS,
    borderRadius: 18,
    padding: 16,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 6 },
  sub: { color: "rgba(255,255,255,0.75)", fontSize: 13, marginBottom: 12, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.25)", marginRight: 10 },
  dotActive: { backgroundColor: MINT },
  dotDone: { backgroundColor: "#0F6E56" },
  rowTxt: { color: "#fff", fontSize: 14, fontWeight: "600" },
  stepLabel: { color: MINT, marginTop: 8, fontWeight: "700" },
  skip: { marginTop: 14, alignSelf: "flex-start", paddingVertical: 8 },
  skipTxt: { color: "rgba(255,255,255,0.7)", fontWeight: "600", textDecorationLine: "underline" },
});
