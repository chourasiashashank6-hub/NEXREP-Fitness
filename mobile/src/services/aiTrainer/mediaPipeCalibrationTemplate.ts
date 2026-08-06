import { MEDIAPIPE_VERSION } from "./mediaPipeHtmlTemplate";

const MINT = "#2DD4A7";
const GLASS = "rgba(10,22,18,0.62)";

export type CalibrationStepId = "tpose" | "squats" | "turn";

export function buildInjectedCalibrationScript(step: CalibrationStepId): string {
  const json = JSON.stringify({ STEP: step }).replace(/<\/script/gi, "<\\/script");
  return `window.__CAL_CONFIG__=${json};true;`;
}

/** Static calibration page — step id is supplied via `window.__CAL_CONFIG__`. */
export function buildStaticCalibrationHtml(): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#050b16;overflow:hidden;font-family:-apple-system,sans-serif}
video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
#scan{position:absolute;left:0;right:0;height:2px;background:${MINT};box-shadow:0 0 12px ${MINT};animation:scan 2.4s linear infinite;z-index:5}
@keyframes scan{0%{top:8%}100%{top:92%}}
#hud{position:absolute;left:12px;right:12px;bottom:18px;z-index:8;background:${GLASS};backdrop-filter:blur(14px);border-radius:18px;padding:14px;color:#fff}
#ring{position:absolute;top:18px;right:18px;width:64px;height:64px;z-index:8;display:none}
</style></head><body>
<video id="v" autoplay playsinline muted></video>
<canvas id="c"></canvas>
<div id="scan"></div>
<svg id="ring" viewBox="0 0 36 36">
  <path d="M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 1 1 0-31" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="3"/>
  <path id="arc" d="M18 2.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 1 1 0-31" fill="none" stroke="${MINT}" stroke-width="3"
    stroke-dasharray="97.4" stroke-dashoffset="97.4" stroke-linecap="round"/>
</svg>
<div id="hud"><div id="msg">Starting camera…</div></div>
<script type="module">
import{FilesetResolver,PoseLandmarker}from"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}";
const CONFIG=window.__CAL_CONFIG__||{};
const STEP=CONFIG.STEP||"tpose";
document.getElementById("ring").style.display=STEP==="turn"?"block":"none";
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
    const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm");
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
