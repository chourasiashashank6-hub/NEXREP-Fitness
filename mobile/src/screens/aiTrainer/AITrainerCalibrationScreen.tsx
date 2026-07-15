import { useCallback, useMemo, useRef, useState } from "react";
import {
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

const MINT = "#2DD4A7";
const GLASS = "rgba(10,22,18,0.62)";
const BG = "#050b16";

type Props = NativeStackScreenProps<RootStackParamList, "AITrainerCalibration">;

const STEPS = [
  { id: "tpose", durationSec: 10 },
  { id: "squats", durationSec: 20 },
  { id: "turn", durationSec: 8 },
] as const;

function buildCalibrationHtml(stepIndex: number): string {
  const step = STEPS[stepIndex]?.id || "tpose";
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#050b16;overflow:hidden;font-family:-apple-system,sans-serif}
video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
#scan{position:absolute;left:0;right:0;height:2px;background:${MINT};box-shadow:0 0 12px ${MINT};animation:scan 2.4s linear infinite;z-index:5}
@keyframes scan{0%{top:8%}100%{top:92%}}
#hud{position:absolute;left:12px;right:12px;bottom:18px;z-index:8;background:${GLASS};backdrop-filter:blur(14px);border-radius:18px;padding:14px;color:#fff}
#ring{position:absolute;top:18px;right:18px;width:64px;height:64px;z-index:8}
</style></head><body>
<video id="v" autoplay playsinline muted></video>
<canvas id="c"></canvas>
<div id="scan"></div>
<svg id="ring" viewBox="0 0 36 36" style="display:${step === "turn" ? "block" : "none"}">
  <path d="M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 1 1 0-31" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="3"/>
  <path id="arc" d="M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 1 1 0-31" fill="none" stroke="${MINT}" stroke-width="3"
    stroke-dasharray="97.4" stroke-dashoffset="97.4" stroke-linecap="round"/>
</svg>
<div id="hud"><div id="msg">Starting camera…</div></div>
<script type="module">
import{FilesetResolver,PoseLandmarker}from"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34";
const STEP=${JSON.stringify(step)};
const post=(type,payload={})=>{try{window.ReactNativeWebView?.postMessage(JSON.stringify({type,...payload}))}catch{}};
const video=document.getElementById("v");
const canvas=document.getElementById("c");
const ctx=canvas.getContext("2d");
const msg=document.getElementById("msg");
const setMsg=t=>{msg.textContent=t};
let pose=null,raf=null,stream=null,last=-1;
const samples=[];
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const ang=(a,b,c)=>{const bax=a.x-b.x,bay=a.y-b.y,bcx=c.x-b.x,bcy=c.y-b.y;return Math.atan2(Math.abs(bax*bcy-bay*bcx),bax*bcx+bay*bcy)*180/Math.PI};

function capture(lms){
  const lS=lms[11],rS=lms[12],lH=lms[23],rH=lms[24];
  if(!lS||!rS||!lH||!rH)return;
  const shoulderMid=mid(lS,rS),hipMid=mid(lH,rH);
  const torsoLen=dist(shoulderMid,hipMid)||0.3;
  const shoulderWidth=Math.abs(lS.x-rS.x);
  const hipWidth=Math.abs(lH.x-rH.x);
  const upperArmL=lms[13]?dist(lS,lms[13]):0;
  const upperArmR=lms[14]?dist(rS,lms[14]):0;
  const thighL=lms[25]?dist(lH,lms[25]):0;
  const thighR=lms[26]?dist(rH,lms[26]):0;
  const shankL=lms[25]&&lms[27]?dist(lms[25],lms[27]):0;
  const shankR=lms[26]&&lms[28]?dist(lms[26],lms[28]):0;
  let knee=null;
  if(lms[23]&&lms[25]&&lms[27])knee=ang(lms[23],lms[25],lms[27]);
  if(lms[24]&&lms[26]&&lms[28]){
    const k2=ang(lms[24],lms[26],lms[28]);
    knee=knee==null?k2:(knee+k2)/2;
  }
  const ratio=shoulderWidth/Math.max(0.05,torsoLen);
  samples.push({torsoLen,shoulderWidth,hipWidth,upperArmL,upperArmR,thighL,thighR,shankL,shankR,knee,ratio,t:performance.now()});
  if(STEP==="turn"){
    const progress=Math.min(1,samples.length/40);
    const arc=document.getElementById("arc");
    if(arc)arc.style.strokeDashoffset=String(97.4*(1-progress));
    post("turnProgress",{progress});
  }
}

function avg(key){
  const vals=samples.map(s=>s[key]).filter(v=>Number.isFinite(v)&&v>0);
  if(!vals.length)return 0;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
function max(key){
  const vals=samples.map(s=>s[key]).filter(v=>Number.isFinite(v)&&v>0);
  return vals.length?Math.max(...vals):0;
}

function finish(){
  const torsoLen=avg("torsoLen")||0.31;
  const depthRaw=Math.min(...samples.map(s=>s.knee).filter(v=>Number.isFinite(v)),180);
  const depthTargetDeg=Math.max(80,Math.min(105,Number.isFinite(depthRaw)?depthRaw:95));
  const cal={
    torsoLen,
    shoulderWidth:avg("shoulderWidth")||0.19,
    hipWidth:avg("hipWidth")||0.14,
    limbs:{
      upperArmL:max("upperArmL")||0.13,
      upperArmR:max("upperArmR")||0.13,
      thighL:max("thighL")||0.2,
      thighR:max("thighR")||0.2,
      shankL:max("shankL")||0.19,
      shankR:max("shankR")||0.19
    },
    asymmetryFlags:[],
    mobility:{depthTargetDeg,hingeMaxDeg:95,dorsiflexionProxyDeg:28},
    confidenceByAngle:{"0":0.95,"45":0.9,"90":0.85,"135":0.9,"180":0.95},
    calibratedAt:new Date().toISOString(),
    version:1
  };
  const dArm=Math.abs(cal.limbs.upperArmL-cal.limbs.upperArmR)/Math.max(cal.limbs.upperArmL,0.01);
  if(dArm>0.05)cal.asymmetryFlags.push("upper_arm");
  post("stepComplete",{step:STEP,calibration:cal,sampleCount:samples.length});
}

const loop=()=>{
  if(!pose)return;
  if(video.currentTime!==last){
    last=video.currentTime;
    const w=video.videoWidth||720,h=video.videoHeight||1280;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
    const res=pose.detectForVideo(video,performance.now());
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const lms=res?.landmarks?.[0];
    if(lms?.length){
      ctx.strokeStyle="${MINT}";ctx.lineWidth=2;
      const pairs=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
      for(const[a,b]of pairs){
        const A=lms[a],B=lms[b];if(!A||!B)continue;
        ctx.beginPath();ctx.moveTo(A.x*w,A.y*h);ctx.lineTo(B.x*w,B.y*h);ctx.stroke();
      }
      capture(lms);
      setMsg(STEP==="tpose"?"Hold a front T-pose — arms out, body centered":
        STEP==="squats"?"Side-on: do 3 slow bodyweight squats":
        "Turn slowly in a full circle");
    }else setMsg("Step into frame — full body visible");
  }
  raf=requestAnimationFrame(loop);
};

(async()=>{
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});
    video.srcObject=stream;await video.play();
    const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm");
    pose=await PoseLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},
      runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:0.35,minPosePresenceConfidence:0.35,minTrackingConfidence:0.35
    });
    post("ready");loop();
    const wait=STEP==="tpose"?10000:STEP==="squats"?20000:8000;
    setTimeout(finish,wait);
  }catch(e){post("error",{message:e?.message||"Calibration camera failed"});}
})();
</script></body></html>`;
}

export default function AITrainerCalibrationScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const planId = route.params?.planId;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const partialRef = useRef<Partial<PoseCalibration>>({});
  const setCalibration = usePoseCalibrationStore((s) => s.setCalibration);
  const skipCalibration = usePoseCalibrationStore((s) => s.skipCalibration);

  const html = useMemo(() => buildCalibrationHtml(step), [step]);

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
        const finalCal: PoseCalibration = {
          torsoLen: cal.torsoLen,
          shoulderWidth: cal.shoulderWidth,
          hipWidth: cal.hipWidth,
          limbs: cal.limbs,
          asymmetryFlags: cal.asymmetryFlags || [],
          mobility: cal.mobility,
          confidenceByAngle: cal.confidenceByAngle,
          calibratedAt: new Date().toISOString(),
          version: 1,
          ...partialRef.current,
          limbs: { ...cal.limbs, ...partialRef.current.limbs },
          mobility: { ...cal.mobility, ...partialRef.current.mobility },
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
      <WebView
        key={`cal-step-${step}`}
        source={{ html }}
        style={styles.webview}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        onMessage={onMessage}
      />
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
