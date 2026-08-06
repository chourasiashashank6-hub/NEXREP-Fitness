import { MEDIAPIPE_VERSION } from "./mediaPipeHtmlTemplate";
import { WEBVIEW_CAMERA_CONTROLS_JS } from "./webviewCameraControls";
import { CALIBRATION_CAPTURE_RUNTIME_JS } from "../../utils/calibrationWebViewRuntime";

const MINT = "#2DD4A7";

export type CalibrationStepId = "tpose" | "squats" | "turn";

export function buildInjectedCalibrationScript(
  step: CalibrationStepId,
  facingMode: "user" | "environment" = "user",
  zoomLevel = 1,
  frontShoulderRatio?: number,
): string {
  const json = JSON.stringify({
    STEP: step,
    FACING_MODE: facingMode,
    ZOOM_LEVEL: zoomLevel,
    FRONT_SHOULDER_RATIO: frontShoulderRatio ?? null,
    ENABLE_CAMERA_DIAGNOSTICS: typeof __DEV__ !== "undefined" && __DEV__,
  }).replace(/<\/script/gi, "<\\/script");
  return `window.__CAL_CONFIG__=${json};true;`;
}

/** Static calibration page — step id is supplied via `window.__CAL_CONFIG__`. */
export function buildStaticCalibrationHtml(): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#050b16;overflow:hidden;font-family:-apple-system,sans-serif}
video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
body.mp-mirror video,body.mp-mirror canvas{transform:scaleX(-1)}
#scan{position:absolute;left:0;right:0;height:2px;background:${MINT};box-shadow:0 0 12px ${MINT};animation:scan 2.4s linear infinite;z-index:5;display:none}
#scan.active{display:block}
#hud{display:none!important}
#meterWrap{height:8px;background:rgba(255,255,255,.15);border-radius:4px;margin-top:10px;overflow:hidden}
#meterBar{height:100%;width:0%;background:${MINT};border-radius:4px;transition:width .12s linear}
#meterLbl{margin-top:6px;font-size:12px;font-weight:600;color:rgba(255,255,255,.85)}
#ring{display:none!important}
</style></head><body>
<video id="v" autoplay playsinline muted></video>
<canvas id="c"></canvas>
<div id="scan"></div>
<svg id="ring" viewBox="0 0 36 36">
  <path d="M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 1 1 0-31" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="3"/>
  <path id="arc" d="M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 1 1 0-31" fill="none" stroke="${MINT}" stroke-width="3"
    stroke-dasharray="97.4" stroke-dashoffset="97.4" stroke-linecap="round"/>
</svg>
<div id="hud"><div id="msg">Starting camera…</div><div id="meterWrap"><div id="meterBar"></div></div><div id="meterLbl"></div></div>
<script type="module">
import{FilesetResolver,PoseLandmarker}from"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}";
const CONFIG=window.__CAL_CONFIG__||{};
const STEP=CONFIG.STEP||"tpose";
const FACING_MODE=CONFIG.FACING_MODE||"user";
const ZOOM_LEVEL=Number(CONFIG.ZOOM_LEVEL)||1;
const FRONT_SHOULDER_RATIO=CONFIG.FRONT_SHOULDER_RATIO!=null?Number(CONFIG.FRONT_SHOULDER_RATIO):null;
const VIS_MIN=0.5;
const GATE_STREAK=12;
const TPOSE_HOLD_FRAMES=90;
${CALIBRATION_CAPTURE_RUNTIME_JS}
${WEBVIEW_CAMERA_CONTROLS_JS}
window.__mpEnableCameraDiagnostics=!!CONFIG.ENABLE_CAMERA_DIAGNOSTICS;
if(FACING_MODE==="user")document.body.classList.add("mp-mirror");
window.__mpCamState.facing=FACING_MODE;
window.__mpCamState.zoom=ZOOM_LEVEL;
const post=(type,payload={})=>{try{window.ReactNativeWebView?.postMessage(JSON.stringify({type,...payload}))}catch{}};
const video=document.getElementById("v");
const canvas=document.getElementById("c");
const ctx=canvas.getContext("2d");
window.__mpCamVideo=video;
window.__mpCamCanvas=canvas;
const msgEl=document.getElementById("msg");
const meterBar=document.getElementById("meterBar");
const meterLbl=document.getElementById("meterLbl");
const scanEl=document.getElementById("scan");
const setMsg=t=>{msgEl.textContent=t};
const setMeter=(p,lbl)=>{meterBar.style.width=Math.round(Math.max(0,Math.min(1,p))*100)+"%";if(lbl)meterLbl.textContent=lbl};
let pose=null,raf=null,stream=null,last=-1;
const samples=[];
let calPaused=true;
window.__calPauseCapture=function(){calPaused=true;capturePhase="seek_pose";gateStreak=0;holdStreak=0;};
window.__calResumeCapture=function(){calPaused=false;capturePhase="seek_pose";gateStreak=0;};
let stepReadySent=false;
let capturePhase="seek_pose";
let gateStreak=0;
let holdStreak=0;
let squatRepCount=0;
let squatRepState=createSquatRepState();
let minKneeSeen=180;
let turnFrontRatio=FRONT_SHOULDER_RATIO;
let lastProgressPost=0;
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const ang=(a,b,c)=>{const bax=a.x-b.x,bay=a.y-b.y,bcx=c.x-b.x,bcy=c.y-b.y;return Math.atan2(Math.abs(bax*bcy-bay*bcx),bax*bcx+bay*bcy)*180/Math.PI};

function vis(lm){return(lm?.visibility??0)>=VIS_MIN}
function fullBodyVisible(lms){
  return [11,12,23,24,25,26,27,28].every(i=>vis(lms[i]));
}
function getKneeAngle(lms){
  let knee=null;
  if(lms[23]&&lms[25]&&lms[27])knee=ang(lms[23],lms[25],lms[27]);
  if(lms[24]&&lms[26]&&lms[28]){const k2=ang(lms[24],lms[26],lms[28]);knee=knee==null?k2:(knee+k2)/2;}
  return knee;
}
function isTpose(lms){
  if(!fullBodyVisible(lms))return false;
  const lS=lms[11],rS=lms[12],lE=lms[13],rE=lms[14],lW=lms[15],rW=lms[16];
  if(!lS||!rS||!lE||!rE||!lW||!rW)return false;
  if(![lS,rS,lE,rE,lW,rW].every(vis))return false;
  const shoulderY=(lS.y+rS.y)/2;
  if(Math.abs(lW.y-shoulderY)>0.1||Math.abs(rW.y-shoulderY)>0.1)return false;
  const spread=Math.abs(lW.x-rW.x),shoulderSpread=Math.abs(lS.x-rS.x);
  if(spread<shoulderSpread*1.35)return false;
  const elL=ang(lS,lE,lW),elR=ang(rS,rE,rW);
  return elL>=140&&elR>=140;
}
function isStanding(lms){
  if(!fullBodyVisible(lms))return false;
  const k=getKneeAngle(lms);
  return k!=null&&k>155;
}
function poseGateOk(lms){
  if(STEP==="tpose")return isTpose(lms);
  if(STEP==="squats")return isStanding(lms);
  return fullBodyVisible(lms);
}
function emitProgress(payload){
  const now=performance.now();
  if(now-lastProgressPost<120)return;
  lastProgressPost=now;
  post("calProgress",{step:STEP,phase:capturePhase,...payload});
}

function capture(lms){
  const lS=lms[11],rS=lms[12],lH=lms[23],rH=lms[24];
  if(!lS||!rS||!lH||!rH)return;
  const lVis=((lS.visibility??0)+(rS.visibility??0))/2;
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
  let knee=null,hip=null,ankleFlex=null;
  if(lms[23]&&lms[25]&&lms[27])knee=ang(lms[23],lms[25],lms[27]);
  if(lms[24]&&lms[26]&&lms[28]){const k2=ang(lms[24],lms[26],lms[28]);knee=knee==null?k2:(knee+k2)/2;}
  if(lms[11]&&lms[23]&&lms[25])hip=ang(lms[11],lms[23],lms[25]);
  if(lms[12]&&lms[24]&&lms[26]){const h2=ang(lms[12],lms[24],lms[26]);hip=hip==null?h2:Math.min(hip,h2);}
  if(lms[25]&&lms[27]&&lms[31])ankleFlex=ang(lms[25],lms[27],lms[31]);
  if(lms[26]&&lms[28]&&lms[32]){const a2=ang(lms[26],lms[28],lms[32]);ankleFlex=ankleFlex==null?a2:Math.min(ankleFlex,a2);}
  const torsoLean=Math.abs(Math.atan2(shoulderMid.x-hipMid.x,hipMid.y-shoulderMid.y)*180/Math.PI);
  const ratio=shoulderWidth/Math.max(0.05,torsoLen);
  const nose=lms[0];
  samples.push({torsoLen,shoulderWidth,hipWidth,upperArmL,upperArmR,thighL,thighR,shankL,shankR,knee,hip,ankleFlex,ratio,torsoLean,lVis,t:performance.now(),noseX:nose?.x,shoulderMidX:shoulderMid.x});
}

function markStepReady(reason){
  if(stepReadySent)return;
  stepReadySent=true;
  capturePhase="ready";
  scanEl.classList.remove("active");
  post("stepReady",{step:STEP,sampleCount:samples.length,reason});
}

function processFrame(lms){
  if(calPaused){
    setMsg("Watch the pose demo…");
    setMeter(0,"");
    emitProgress({gatePassed:false,statusText:"Demo"});
    return;
  }
  if(!lms?.length){
    gateStreak=0;
    setMsg("Step into frame — full body visible");
    setMeter(0,"");
    emitProgress({gatePassed:false,statusText:"Get into position"});
    return;
  }
  if(capturePhase==="seek_pose"){
    scanEl.classList.remove("active");
    if(poseGateOk(lms)){gateStreak++;}else{gateStreak=0;}
    const gateProg=Math.min(1,gateStreak/GATE_STREAK);
  if(STEP==="tpose")setMsg("Raise arms to a T-pose — full body in frame");
  else if(STEP==="squats")setMsg("Stand side-on, full body visible");
  else setMsg("Face the camera — full body visible");
    setMeter(gateProg,"Get into position…");
    emitProgress({gatePassed:false,gateProgress:gateProg,statusText:"Get into position"});
    if(gateStreak>=GATE_STREAK){
      capturePhase="capture";
      gateStreak=0;
      scanEl.classList.add("active");
      post("gatePassed",{step:STEP});
    }
    return;
  }
  if(capturePhase==="capture"){
    if(STEP==="tpose"){
      if(isTpose(lms)){holdStreak++;capture(lms);}else{holdStreak=Math.max(0,holdStreak-3);}
      const hp=holdStreak/TPOSE_HOLD_FRAMES;
      setMsg("Hold your T-pose steady…");
      setMeter(hp,"Hold progress "+Math.round(hp*100)+"%");
      emitProgress({gatePassed:true,holdProgress:hp,statusText:"Hold T-pose"});
      if(holdStreak>=TPOSE_HOLD_FRAMES)markStepReady("tpose_hold");
    }else if(STEP==="squats"){
      if(!fullBodyVisible(lms)){
        setMsg("Keep full body in frame while squatting");
        emitProgress({gatePassed:true,squatReps:squatRepCount,depthDeg:minKneeSeen,statusText:"Body lost"});
        return;
      }
      const knee=getKneeAngle(lms);
      squatRepState=stepSquatRep(squatRepState,knee);
      squatRepCount=squatRepState.repCount;
      if(knee!=null&&Number.isFinite(knee))minKneeSeen=Math.min(minKneeSeen,knee);
      if(shouldCaptureSquatDepthSample(squatRepState,knee))capture(lms);
      const depthProg=Math.min(1,Math.max(0,(175-minKneeSeen)/55));
      setMsg("Do "+SQUAT_MIN_REPS+" slow squats — reps: "+squatRepCount+"/"+SQUAT_MIN_REPS);
      setMeter(Math.max(depthProg,squatRepCount/SQUAT_MIN_REPS),"Deepest knee: "+Math.round(minKneeSeen)+"°");
      emitProgress({gatePassed:true,squatReps:squatRepCount,depthDeg:minKneeSeen,squatDepthProgress:depthProg,statusText:"Squat"});
      if(squatRepCount>=SQUAT_MIN_REPS&&filterVisibleSamples(samples).length>=12)markStepReady("squats_done");
    }else if(STEP==="turn"){
      if(!fullBodyVisible(lms)){
        setMsg("Stay in frame while turning");
        return;
      }
      capture(lms);
      if(turnFrontRatio==null){
        const vis=filterVisibleSamples(samples);
        const ratios=vis.map(s=>s.ratio).filter(v=>Number.isFinite(v)&&v>0);
        turnFrontRatio=ratios.length?median(ratios):0.62;
      }
      const tp=computeTurnProgress(samples,turnFrontRatio);
      const arc=document.getElementById("arc");
      if(arc)arc.style.strokeDashoffset=String(97.4*(1-tp.progress01));
      setMsg(tp.hasSide?"Keep turning slowly…":"Turn until your side faces the camera");
      setMeter(tp.progress01,"Turn "+Math.round(tp.progress01*100)+"% · "+tp.bucketsSeen.size+"/8 views");
      emitProgress({gatePassed:true,turnProgress:tp.progress01,statusText:"Turn"});
      if(tp.complete)markStepReady("turn_done");
    }
    return;
  }
  if(capturePhase==="ready"){
    setMsg("Tap Continue when ready");
    setMeter(1,"Capture complete");
  }
}

function finish(){
  if(capturePhase!=="ready")return;
  const partial={};
  if(STEP==="tpose"){
    const agg=aggregateTpose(samples);
    partial.torsoLen=agg.torsoLen;
    partial.shoulderWidth=agg.shoulderWidth;
    partial.hipWidth=agg.hipWidth;
    partial.limbs=agg.limbs;
    partial.frontShoulderRatio=agg.frontShoulderRatio;
    partial.standingKneeDeg=agg.standingKneeDeg;
    partial.torsoLeanBaselineDeg=agg.torsoLeanBaselineDeg;
    partial.asymmetryFlags=agg.asymmetryFlags;
  }else if(STEP==="squats"){
    const agg=aggregateSquats(samples);
    partial.squatDepthDeg=agg.squatDepthDeg;
    partial.mobility=agg.mobility;
  }else if(STEP==="turn"){
    const front=turnFrontRatio!=null?turnFrontRatio:(FRONT_SHOULDER_RATIO||0.62);
    partial.confidenceByAngle=aggregateTurnConfidence(samples,front);
  }
  post("stepComplete",{step:STEP,calibration:partial,sampleCount:samples.length});
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
      const drawLms=window.__mpZoomLms?window.__mpZoomLms(lms):lms;
      for(const[a,b]of pairs){
        const A=drawLms[a],B=drawLms[b];if(!A||!B)continue;
        ctx.beginPath();ctx.moveTo(A.x*w,A.y*h);ctx.lineTo(B.x*w,B.y*h);ctx.stroke();
      }
      processFrame(lms);
    }else processFrame(null);
  }
  raf=requestAnimationFrame(loop);
};

(async()=>{
  try{
    window.__mpCamStopStream=()=>{
      if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
      window.__mpCamStream=null;
    };
    window.__mpCamStartStream=async(facing)=>{
      const fm=facing||window.__mpCamState.facing||"user";
      window.__mpCamState.facing=fm;
      window.__mpApplyMirror();
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:fm,width:{ideal:1280},height:{ideal:720}},audio:false});
      window.__mpCamStream=stream;
      video.srcObject=stream;
      await video.play();
      if(window.__mpSetZoom)await window.__mpSetZoom(window.__mpCamState.zoom||1);
    };
    await window.__mpCamStartStream(FACING_MODE);
    if(window.__mpNotifyCamStarted)window.__mpNotifyCamStarted(stream);
    const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm");
    pose=await PoseLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",delegate:"GPU"},
      runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:0.35,minPosePresenceConfidence:0.35,minTrackingConfidence:0.35
    });
    window.__calFinishNow=finish;
    post("ready");loop();
  }catch(e){post("error",{message:e?.message||"Calibration camera failed"});}
})();
</script></body></html>`;
}
