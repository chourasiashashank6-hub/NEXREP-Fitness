import i18n from "../../i18n";
import { WEBVIEW_CAMERA_CONTROLS_JS } from "./webviewCameraControls";
import { WEBVIEW_SESSION_RUNTIME } from "./webviewSessionRuntime";

/** Keep in sync with `@mediapipe/tasks-vision` in package.json (verified on jsDelivr). */
export const MEDIAPIPE_VERSION = "0.10.34";

/** Bump when static HTML template changes — logged at WebView startup to verify regeneration. */
export const MEDIAPIPE_HTML_BUILD_STAMP = "2026.08.07-ai-camera";

/**
 * All locale-aware strings the WebView script needs. Computed once per app
 * session (language changes require an app restart to apply here, matching
 * prior behaviour where this HTML was rebuilt per-render from the same
 * module-level i18n.t() calls).
 */
export const MP_TEXT = {
  exerciseDetecting: i18n.t("mediaPipe.exerciseDetecting"),
  postureBlank: i18n.t("mediaPipe.postureBlank"),
  alignBody: i18n.t("mediaPipe.alignBody"),
  cardioBanner: i18n.t("mediaPipe.cardioBanner"),
  postureAwareness: i18n.t("mediaPipe.postureAwareness"),
  posture: i18n.t("mediaPipe.posture"),
  centred: i18n.t("mediaPipe.centred"),
  adjustPosition: i18n.t("mediaPipe.adjustPosition"),
  exercise: i18n.t("mediaPipe.exercise"),
  reps: i18n.t("mediaPipe.reps"),
  phase: i18n.t("mediaPipe.phase"),
  unknown: i18n.t("mediaPipe.unknown"),
  rightPosture: i18n.t("mediaPipe.rightPosture"),
  wrongPosture: i18n.t("mediaPipe.wrongPosture"),
  adjustPosture: i18n.t("mediaPipe.adjustPosture"),
  keepBodyFrame: i18n.t("mediaPipe.keepBodyFrame"),
  centreBody: i18n.t("mediaPipe.centreBody"),
  noBodyDetected: i18n.t("mediaPipe.noBodyDetected"),
  noFullBody: i18n.t("mediaPipe.noFullBody"),
  loadingTracker: i18n.t("mediaPipe.loadingTracker"),
  loadingTrackerHint: i18n.t("mediaPipe.loadingTrackerHint"),
};

export type MediaPipeExerciseRule = {
  label: string;
  joints: Array<{ label: string; a: number; b: number; c: number; min: number; max: number }>;
} | null;

export type MediaPipeMovementConfig = {
  primaryJoint: "elbow" | "knee" | "hip" | "shoulder" | "ankle";
  downThreshold: number;
  upThreshold: number;
  downWhenAngleIsLower: boolean;
} | null;

/**
 * Builds the per-session config payload injected into the WebView via
 * `injectedJavaScriptBeforeContentLoaded`, i.e. before the static HTML's own
 * `<script type="module">` runs. This replaces the old approach of baking
 * these values directly into a freshly-generated HTML string per render
 * (which required loading the page from an insecure `about:blank` origin).
 */
export function buildInjectedConfigScript(
  exerciseRule: MediaPipeExerciseRule,
  movementConfig: MediaPipeMovementConfig,
  trainerNote: string,
  isCardioOrMobility: boolean,
  sessionMode: boolean,
  movementFamily: string | null,
  facingMode: "user" | "environment",
  poseSpec: unknown,
  calibration: unknown,
  seedRepCount: number,
  countingPaused: boolean,
  relaxTrackingGates = false,
  zoomLevel = 1,
): string {
  const spec = poseSpec as { repJoint?: string; view?: string; family?: string } | null;
  const enableCameraDiagnostics = typeof __DEV__ !== "undefined" && __DEV__;
  const config = {
    EXERCISE_RULE: exerciseRule,
    MOVEMENT_CONFIG: movementConfig,
    TRAINER_NOTE: trainerNote,
    MOVEMENT_FAMILY: movementFamily || "",
    IS_CARDIO: isCardioOrMobility,
    SESSION_MODE: sessionMode,
    FACING_MODE: facingMode,
    POSE_SPEC: poseSpec,
    CAL: calibration,
    SEED_REPS: seedRepCount,
    COUNTING_PAUSED: countingPaused,
    RELAX_TRACKING_GATES: relaxTrackingGates,
    ZOOM_LEVEL: zoomLevel,
    REP_JOINT: spec?.repJoint ?? null,
    REQUIRED_VIEW: spec?.view ?? null,
    POSE_FAMILY: spec?.family ?? null,
    ENABLE_CAMERA_DIAGNOSTICS: enableCameraDiagnostics,
    TEXT: MP_TEXT,
  };
  // Serialize safely for embedding inside a <script> context (guards against a
  // trainer note or exercise label containing "</script>").
  const json = JSON.stringify(config).replace(/<\/script/gi, "<\\/script");
  return `window.__MP_CONFIG__=${json};true;`;
}

/**
 * Builds the static HTML page served by the local MediaPipe HTTP server.
 * Contains no per-session dynamic values — all of those are supplied at
 * runtime via `window.__MP_CONFIG__` (see buildInjectedConfigScript above).
 * This must be served from a secure context (http://127.0.0.1:<port>/...)
 * for `navigator.mediaDevices.getUserMedia` to be defined on both Android
 * and iOS WebViews.
 */
export function buildStaticMediaPipeHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
    <style>
      html,body{margin:0;padding:0;width:100%;height:100%;background:#050b16;overflow:hidden}
      #root{position:relative;width:100%;height:100%}
      video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
      body.mp-mirror video,body.mp-mirror canvas{transform:scaleX(-1)}
      body:not(.mp-mirror) video,body:not(.mp-mirror) canvas{transform:none}
      body.mp-chrome-hidden #badge,body.mp-chrome-hidden #posture,
      body.mp-chrome-hidden #notes,body.mp-chrome-hidden #hint{display:none}
      #badge{position:absolute;left:10px;top:10px;z-index:12;background:rgba(0,0,0,.65);
        color:#fff;border-radius:10px;padding:6px 10px;
        font:800 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #posture{position:absolute;left:10px;top:40px;z-index:12;background:rgba(0,0,0,.65);
        color:#fff;border-radius:10px;padding:7px 10px;
        font:700 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #notes{position:absolute;left:10px;top:70px;z-index:12;background:rgba(15,23,42,.78);
        color:#fff;border-radius:10px;padding:6px 10px;max-width:92%;
        font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #hint{position:absolute;left:12px;right:12px;bottom:12px;z-index:10;
        border-radius:10px;padding:8px 10px;text-align:center;color:#fff;
        background:rgba(0,0,0,.55);
        font:700 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #cardio-banner{position:absolute;left:0;right:0;bottom:0;z-index:20;
        background:rgba(15,23,42,.85);color:#fff;padding:14px 16px;text-align:center;
        font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:none}
      body.mp-cardio-banner #cardio-banner{display:block}
    </style>
  </head>
  <body>
    <div id="root">
      <video id="video" autoplay playsinline muted></video>
      <canvas id="overlay"></canvas>
      <div id="badge"></div>
      <div id="posture"></div>
      <div id="notes"></div>
      <div id="hint"></div>
      <div id="cardio-banner"></div>
    </div>
    <script type="module">
      import{FilesetResolver,PoseLandmarker}from"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}";

      const CONFIG=window.__MP_CONFIG__||{};
      const EXERCISE_RULE=CONFIG.EXERCISE_RULE!=null?CONFIG.EXERCISE_RULE:null;
      const MOVEMENT_CONFIG=CONFIG.MOVEMENT_CONFIG!=null?CONFIG.MOVEMENT_CONFIG:null;
      const TRAINER_NOTE=CONFIG.TRAINER_NOTE||"";
      const MOVEMENT_FAMILY=CONFIG.MOVEMENT_FAMILY||"";
      const IS_CARDIO=!!CONFIG.IS_CARDIO;
      const SESSION_MODE=!!CONFIG.SESSION_MODE;
      const FACING_MODE=CONFIG.FACING_MODE||"user";
      const POSE_SPEC=CONFIG.POSE_SPEC!=null?CONFIG.POSE_SPEC:null;
      const CAL=CONFIG.CAL!=null?CONFIG.CAL:null;
      const SEED_REPS=CONFIG.SEED_REPS||0;
      let COUNTING_PAUSED=!!CONFIG.COUNTING_PAUSED;
      const RELAX_TRACKING_GATES=!!CONFIG.RELAX_TRACKING_GATES;
      const REP_JOINT=CONFIG.REP_JOINT||null;
      const REQUIRED_VIEW=CONFIG.REQUIRED_VIEW||null;
      const POSE_FAMILY=CONFIG.POSE_FAMILY||null;
      const ENABLE_CAMERA_DIAGNOSTICS=!!CONFIG.ENABLE_CAMERA_DIAGNOSTICS;
      const TEXT=Object.assign({
        posture:"Posture",phase:"Phase",exercise:"Exercise",reps:"Reps",
        rightPosture:"Good",wrongPosture:"Adjust",adjustPosture:"Adjust your form",
        postureBlank:"",postureAwareness:"Posture awareness",centred:"Centred",
        adjustPosition:"Adjust position",unknown:"Unknown",cardioBanner:"",
        keepBodyFrame:"Keep body in frame",centreBody:"Centre your body",
        noBodyDetected:"No body detected",noFullBody:"Step back — full body visible",
        exerciseDetecting:"Detecting…",alignBody:"Align your body",loadingTracker:"Loading…",
        loadingTrackerHint:""
      },CONFIG.TEXT||{});
      ${WEBVIEW_CAMERA_CONTROLS_JS}
      window.__mpEnableCameraDiagnostics=ENABLE_CAMERA_DIAGNOSTICS;
      ${WEBVIEW_SESSION_RUNTIME}
      if(RELAX_TRACKING_GATES)MIN_VIS=0.45;

      if(FACING_MODE==="user")document.body.classList.add("mp-mirror");
      if(SESSION_MODE)document.body.classList.add("mp-chrome-hidden");
      if(IS_CARDIO&&!SESSION_MODE)document.body.classList.add("mp-cardio-banner");
      window.__mpCamState.facing=FACING_MODE;
      window.__mpCamState.zoom=Number(CONFIG.ZOOM_LEVEL)||1;

      const badgeEl=document.getElementById("badge");
      const postureEl=document.getElementById("posture");
      const notesEl=document.getElementById("notes");
      const hintEl=document.getElementById("hint");
      const video=document.getElementById("video");
      const canvas=document.getElementById("overlay");
      const ctx=canvas.getContext("2d");
      window.__mpCamVideo=video;
      window.__mpCamCanvas=canvas;

      badgeEl.textContent=TEXT.exerciseDetecting;
      postureEl.textContent=TEXT.postureBlank;
      hintEl.textContent=TEXT.alignBody;
      document.getElementById("cardio-banner").textContent=TEXT.cardioBanner;
      if(notesEl)notesEl.textContent=TRAINER_NOTE?"Notes: "+TRAINER_NOTE:"Notes: Maintain controlled movement";

      const setText=(el,text)=>{if(el)el.textContent=text};
      const setBg=(el,bg)=>{if(el)el.style.background=bg};

      const post=(type,payload={})=>{
        try{window.ReactNativeWebView?.postMessage(JSON.stringify({type,...payload}))}catch{}
      };

      let poseLandmarker=null,rafId=null,stream=null,lastVideoTime=-1;
      let repCount=0,phase="idle",reachedDown=false,prevLandmarks=null;
      let lastPostedReps=-1,lastPostedForm=null,lastPostedBody=null,lastTrackPostAt=0;
      const SMOOTH_ALPHA=SESSION_MODE?EMA_A:0.55;
      let sessionPhase=createPhase();
      sessionPhase.repCount=Math.max(0,Number(SEED_REPS)||0);
      let emaPrimary=null;
      let oriBuf=[];
      let lastWarnIdx=[];
      let failedDuringRep=[];
      let angleHist=[];
      const depthTarget=(POSE_SPEC&&POSE_SPEC._depthTargetDeg)||((CAL&&CAL.mobility&&CAL.mobility.depthTargetDeg)||95);
      const hasMotion=(now)=>{
        angleHist=angleHist.filter(s=>now-s.t<=1000);
        if(angleHist.length<3)return false;
        var mn=Infinity,mx=-Infinity; for(const s of angleHist){mn=Math.min(mn,s.a);mx=Math.max(mx,s.a)}
        return mx-mn>=4;
      };
      const emitTracking=(a,b,c,d,e)=>{
        // backward-compat + session object form
        const payload=typeof a==="object"&&a?a:{reps:a,formOk:b,correction:c||"",phase:d||"idle",bodyDetected:!!e};
        const now=Date.now();
        const changed=payload.reps!==lastPostedReps||payload.formOk!==lastPostedForm||payload.bodyDetected!==lastPostedBody||payload.repCompleted||payload.cueKey;
        if(!changed&&now-lastTrackPostAt<(SESSION_MODE?50:250))return;
        lastPostedReps=payload.reps;lastPostedForm=payload.formOk;lastPostedBody=payload.bodyDetected;lastTrackPostAt=now;
        post("tracking",payload);
      };

      const POSE_CONNECTIONS=[[11,12],[11,13],[13,15],[12,14],[14,16],
        [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[24,26],[26,28],[28,30]];
      const DISPLAY_LANDMARKS=[11,12,13,14,15,16,23,24,25,26,27,28,29,30];

      const resizeCanvas=()=>{
        const w=video.videoWidth||video.clientWidth||720;
        const h=video.videoHeight||video.clientHeight||1280;
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
      };

      const getVideoRect=()=>{
        const cw=canvas.width||720,ch=canvas.height||1280;
        const vw=video.videoWidth||720,vh=video.videoHeight||1280;
        const ca=cw/ch,va=vw/vh;
        if(va>ca){const h=ch,w=h*va;return{x:(cw-w)/2,y:0,width:w,height:h}}
        const w=cw,h=w/va;return{x:0,y:(ch-h)/2,width:w,height:h};
      };

      const toPixel=lm=>{const r=getVideoRect();return{x:r.x+lm.x*r.width,y:r.y+lm.y*r.height}};

      const smoothLandmarks=landmarks=>{
        if(!prevLandmarks||prevLandmarks.length!==landmarks.length){
          prevLandmarks=landmarks.map(l=>({...l}));return landmarks;
        }
        const s=landmarks.map((l,i)=>{const p=prevLandmarks[i];return{
          ...l,x:SMOOTH_ALPHA*l.x+(1-SMOOTH_ALPHA)*p.x,
          y:SMOOTH_ALPHA*l.y+(1-SMOOTH_ALPHA)*p.y,
          z:SMOOTH_ALPHA*l.z+(1-SMOOTH_ALPHA)*p.z,visibility:l.visibility
        }});prevLandmarks=s;return s;
      };

      const calcAngle=(a,b,c)=>{
        const bax=a.x-b.x,bay=a.y-b.y,bcx=c.x-b.x,bcy=c.y-b.y;
        return(Math.atan2(Math.abs(bax*bcy-bay*bcx),bax*bcx+bay*bcy)*180)/Math.PI;
      };

      const isCentered=lms=>{
        const xs=lms.map(l=>l.x),ys=lms.map(l=>l.y);
        const cx=(Math.min(...xs)+Math.max(...xs))/2;
        const cy=(Math.min(...ys)+Math.max(...ys))/2;
        return cx>0.32&&cx<0.68&&cy>0.22&&cy<0.78;
      };

      const getPrimaryAngle=landmarks=>{
        if(!MOVEMENT_CONFIG)return null;
        let l=NaN,r=NaN;const j=MOVEMENT_CONFIG.primaryJoint;
        if(j==="elbow"){
          l=landmarks[11]&&landmarks[13]&&landmarks[15]?calcAngle(landmarks[11],landmarks[13],landmarks[15]):NaN;
          r=landmarks[12]&&landmarks[14]&&landmarks[16]?calcAngle(landmarks[12],landmarks[14],landmarks[16]):NaN;
        }else if(j==="knee"){
          l=landmarks[23]&&landmarks[25]&&landmarks[27]?calcAngle(landmarks[23],landmarks[25],landmarks[27]):NaN;
          r=landmarks[24]&&landmarks[26]&&landmarks[28]?calcAngle(landmarks[24],landmarks[26],landmarks[28]):NaN;
        }else if(j==="hip"){
          l=landmarks[11]&&landmarks[23]&&landmarks[25]?calcAngle(landmarks[11],landmarks[23],landmarks[25]):NaN;
          r=landmarks[12]&&landmarks[24]&&landmarks[26]?calcAngle(landmarks[12],landmarks[24],landmarks[26]):NaN;
        }else if(j==="shoulder"){
          l=landmarks[13]&&landmarks[11]&&landmarks[23]?calcAngle(landmarks[13],landmarks[11],landmarks[23]):NaN;
          r=landmarks[14]&&landmarks[12]&&landmarks[24]?calcAngle(landmarks[14],landmarks[12],landmarks[24]):NaN;
        }else if(j==="ankle"){
          l=landmarks[25]&&landmarks[27]&&landmarks[29]?calcAngle(landmarks[25],landmarks[27],landmarks[29]):NaN;
          r=landmarks[26]&&landmarks[28]&&landmarks[30]?calcAngle(landmarks[26],landmarks[28],landmarks[30]):NaN;
        }
        const vals=[l,r].filter(v=>Number.isFinite(v));
        return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
      };

      const updateMovement=primaryAngle=>{
        if(!MOVEMENT_CONFIG||primaryAngle===null)return{phase,reps:repCount,dynamicOk:true};
        if(MOVEMENT_CONFIG.downWhenAngleIsLower){
          if(primaryAngle<=MOVEMENT_CONFIG.downThreshold){phase="down";reachedDown=true}
          else if(primaryAngle>=MOVEMENT_CONFIG.upThreshold){
            phase="up";if(reachedDown){repCount++;reachedDown=false}
          }
        }else{
          if(primaryAngle>=MOVEMENT_CONFIG.downThreshold){phase="down";reachedDown=true}
          else if(primaryAngle<=MOVEMENT_CONFIG.upThreshold){
            phase="up";if(reachedDown){repCount++;reachedDown=false}
          }
        }
        const dynamicOk=MOVEMENT_CONFIG.downWhenAngleIsLower
          ?(phase==="down"?primaryAngle<=MOVEMENT_CONFIG.downThreshold+20
            :phase==="up"?primaryAngle>=MOVEMENT_CONFIG.upThreshold-20:true)
          :(phase==="down"?primaryAngle>=MOVEMENT_CONFIG.downThreshold-20
            :phase==="up"?primaryAngle<=MOVEMENT_CONFIG.upThreshold+20:true);
        return{phase,reps:repCount,dynamicOk};
      };

      const evaluatePosture=(landmarks,primaryAngle,movementPhase)=>{
        if(!EXERCISE_RULE||!EXERCISE_RULE.joints.length)
          return{isCorrect:false,status:"Detecting...",correction:"Select exercise for form feedback"};
        const tol=12;
        const results=EXERCISE_RULE.joints.map(rule=>{
          const a=landmarks[rule.a],b=landmarks[rule.b],c=landmarks[rule.c];
          if(!a||!b||!c)return{label:rule.label,angle:NaN,ok:false};
          const angle=calcAngle(a,b,c);
          let{min,max}=rule;
          if(MOVEMENT_FAMILY==="overhead_press"&&
            primaryAngle!==null&&(rule.label.includes("Elbow")||rule.label.includes("Shoulder"))){
            if(MOVEMENT_CONFIG&&primaryAngle>=MOVEMENT_CONFIG.upThreshold-10){min=145;max=180}
            else if(MOVEMENT_CONFIG&&primaryAngle<=MOVEMENT_CONFIG.downThreshold+10){min=75;max=120}
            else{min=70;max=180}
          }
          if(MOVEMENT_FAMILY==="bicep_curl"&&primaryAngle!==null&&rule.label.includes("Elbow")){
            if(movementPhase==="down"){min=145;max=180}
            else if(movementPhase==="up"){min=15;max=85}
            else{min=15;max=180}
          }
          if(MOVEMENT_FAMILY==="squat_lunge"&&
            primaryAngle!==null&&rule.label.includes("Hip")){
            if(MOVEMENT_CONFIG&&primaryAngle<=MOVEMENT_CONFIG.downThreshold+15){min=55;max=130}
            else if(MOVEMENT_CONFIG&&primaryAngle>=MOVEMENT_CONFIG.upThreshold-15){min=145;max=180}
            else{min=55;max=180}
          }
          if(MOVEMENT_FAMILY==="hip_hinge"&&primaryAngle!==null&&rule.label.includes("Hip")){
            if(MOVEMENT_CONFIG&&primaryAngle<=MOVEMENT_CONFIG.downThreshold+15){min=35;max=90}
            else if(MOVEMENT_CONFIG&&primaryAngle>=MOVEMENT_CONFIG.upThreshold-15){min=155;max=180}
            else{min=35;max=180}
          }
          return{label:rule.label,angle,min,max,ok:angle>=min-tol&&angle<=max+tol};
        });
        const valid=results.filter(r=>Number.isFinite(r.angle));
        if(!valid.length)return{isCorrect:false,status:"Joints not visible",correction:"Step back so full body is visible"};
        let trainerChecksOk=true;
        let trainerCorrection="";
        if(MOVEMENT_FAMILY==="bicep_curl"){
          const lShoulder=landmarks[11],rShoulder=landmarks[12];
          const lElbow=landmarks[13],rElbow=landmarks[14];
          const lHip=landmarks[23],rHip=landmarks[24];
          const lKnee=landmarks[25],rKnee=landmarks[26];
          const lWrist=landmarks[15],rWrist=landmarks[16];
          const baseVisible=Boolean(lShoulder&&rShoulder&&lElbow&&rElbow&&lHip&&rHip&&lWrist&&rWrist)&&
            (lShoulder?.visibility??0)>0.45&&(rShoulder?.visibility??0)>0.45&&
            (lElbow?.visibility??0)>0.45&&(rElbow?.visibility??0)>0.45&&
            (lHip?.visibility??0)>0.45&&(rHip?.visibility??0)>0.45;
          if(!baseVisible){
            trainerChecksOk=false;
            trainerCorrection="Keep full upper body visible (shoulders, elbows, hips)";
          }
          if(trainerChecksOk&&(!lKnee||!rKnee||(lKnee.visibility??0)<0.35||(rKnee.visibility??0)<0.35)){
            trainerChecksOk=false;
            trainerCorrection="Stand farther back so knees are visible (no seated curls)";
          }
          if(trainerChecksOk&&lShoulder&&rShoulder&&lHip&&rHip&&lElbow&&rElbow){
            const shoulderWidth=Math.max(0.06,Math.abs(lShoulder.x-rShoulder.x));
            const torsoMidX=(lHip.x+rHip.x)/2;
            const shoulderMidX=(lShoulder.x+rShoulder.x)/2;
            const torsoLean=Math.abs(shoulderMidX-torsoMidX);
            const lElbowToHipX=Math.abs(lElbow.x-lHip.x);
            const rElbowToHipX=Math.abs(rElbow.x-rHip.x);
            const lUpperArmTravel=Math.abs(lShoulder.x-lElbow.x);
            const rUpperArmTravel=Math.abs(rShoulder.x-rElbow.x);
            if(torsoLean>shoulderWidth*0.22){
              trainerChecksOk=false;
              trainerCorrection="Keep torso upright - avoid swinging/leaning";
            }else if(lElbowToHipX>shoulderWidth*0.9||rElbowToHipX>shoulderWidth*0.9){
              trainerChecksOk=false;
              trainerCorrection="Keep elbows pinned close to your sides";
            }else if(lUpperArmTravel>shoulderWidth*0.75||rUpperArmTravel>shoulderWidth*0.75){
              trainerChecksOk=false;
              trainerCorrection="Do not flare elbows forward/outward";
            }else if((lElbow.y<lShoulder.y-0.02)||(rElbow.y<rShoulder.y-0.02)){
              trainerChecksOk=false;
              trainerCorrection="Keep shoulders down; do not shrug while curling";
            }
          }
        }
        const isCorrect=valid.every(r=>r.ok)&&trainerChecksOk;
        const firstWrong=valid.find(r=>!r.ok);
        let correction="Maintain current form";
        if(!trainerChecksOk&&trainerCorrection){
          correction=trainerCorrection;
        }else if(firstWrong){
          correction=firstWrong.angle<firstWrong.min
            ?firstWrong.label+": bend more ("+Math.round(firstWrong.angle)+"°)"
            :firstWrong.label+": straighten ("+Math.round(firstWrong.angle)+"°)";
        }
        const summary=valid.slice(0,2).map(r=>r.label+" "+Math.round(r.angle)+"° "+(r.ok?"✓":"✗")).join(" | ");
        return{isCorrect,status:isCorrect?TEXT.rightPosture:TEXT.wrongPosture,
          detail:EXERCISE_RULE.label+" · "+summary,correction};
      };

      const MINT="#2DD4A7",WARN_ORANGE="#FF7A45",JOINT_STROKE="#052018";

      const drawFrame=ok=>{
        if(SESSION_MODE)return; // no debug crosshair in AI session chrome
        const rect=getVideoRect();
        ctx.save();
        ctx.strokeStyle=ok?"rgba(34,197,94,.95)":"rgba(239,68,68,.95)";ctx.lineWidth=3;
        const fw=rect.width*.62,fh=rect.height*.72;
        ctx.strokeRect(rect.x+(rect.width-fw)/2,rect.y+(rect.height-fh)/2,fw,fh);
        ctx.strokeStyle="rgba(255,255,255,.45)";ctx.lineWidth=1;ctx.beginPath();
        ctx.moveTo(rect.x+rect.width/2,rect.y);ctx.lineTo(rect.x+rect.width/2,rect.y+rect.height);
        ctx.moveTo(rect.x,rect.y+rect.height/2);ctx.lineTo(rect.x+rect.width,rect.y+rect.height/2);
        ctx.stroke();ctx.restore();
      };

      const visMin=SESSION_MODE?MIN_VIS:0.4;
      const warnSet=()=>{const s={}; for(const i of lastWarnIdx)s[i]=1; return s};

      const drawSkeleton=(landmarks,ok)=>{
        const ws=SESSION_MODE?warnSet():null;
        ctx.save();ctx.lineWidth=SESSION_MODE?4:2;ctx.lineCap="round";ctx.globalAlpha=0.95;
        for(const[ai,bi]of POSE_CONNECTIONS){
          const a=landmarks[ai],b=landmarks[bi];
          if(!a||!b||(a.visibility??1)<visMin||(b.visibility??1)<visMin)continue;
          const boneWarn=SESSION_MODE?!!(ws[ai]||ws[bi]):!ok;
          const col=SESSION_MODE?(boneWarn?WARN_ORANGE:MINT):(ok?"rgba(34,197,94,0.86)":"rgba(239,68,68,0.86)");
          const pa=toPixel(a),pb=toPixel(b);
          ctx.strokeStyle=col;ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();
        }
        ctx.restore();
      };

      const drawLandmarks=(landmarks,ok)=>{
        const ws=SESSION_MODE?warnSet():null;
        const stroke=SESSION_MODE?JOINT_STROKE:"rgba(15,23,42,0.9)";
        const pingT=(performance.now()%1000)/1000;
        ctx.save();
        if(SESSION_MODE){
          const nose=landmarks[0];
          if(nose&&(nose.visibility??1)>=visMin){
            const hp=toPixel(nose);
            ctx.beginPath();ctx.arc(hp.x,hp.y,15,0,Math.PI*2);
            ctx.strokeStyle=MINT;ctx.lineWidth=4;ctx.stroke();
          }
        }
        for(const idx of DISPLAY_LANDMARKS){
          const lm=landmarks[idx];
          if(!lm||(lm.visibility??1)<visMin)continue;
          const p=toPixel(lm);
          const jointWarn=SESSION_MODE?!!ws[idx]:!ok;
          const fill=SESSION_MODE?(jointWarn?WARN_ORANGE:MINT):(ok?"rgba(34,197,94,0.96)":"rgba(239,68,68,0.96)");
          if(jointWarn&&SESSION_MODE){
            const pingR=6+pingT*10;
            ctx.beginPath();ctx.arc(p.x,p.y,pingR,0,Math.PI*2);
            ctx.strokeStyle="rgba(255,122,69,"+(1-pingT).toFixed(3)+")";ctx.lineWidth=2;ctx.stroke();
          }
          const r=SESSION_MODE?(idx===25||idx===26||idx===23||idx===24?7:6):4.5;
          ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
          ctx.fillStyle=fill;ctx.fill();
          ctx.strokeStyle=stroke;ctx.lineWidth=SESSION_MODE?2:1.5;ctx.stroke();
        }
        ctx.restore();
      };

      const drawAngleTag=(landmarks,primaryAngle,ok,jointIndex)=>{
        if(!SESSION_MODE||primaryAngle==null)return;
        const mid=jointIndex!=null?jointIndex:(EXERCISE_RULE?.joints?.[0]?.b);
        if(mid==null)return;
        const lm=landmarks[mid];
        if(!lm||(lm.visibility??1)<visMin)return;
        const p=toPixel(lm);
        const warn=!ok||(lastWarnIdx.indexOf(mid)>=0);
        const label=Math.round(primaryAngle)+"°";
        const x=p.x+12,y=p.y-12,w=52,h=22;
        ctx.save();
        ctx.fillStyle="rgba(5,32,24,0.85)";
        ctx.strokeStyle=warn?WARN_ORANGE:"rgba(45,212,167,0.5)";
        ctx.lineWidth=1.5;
        if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x,y,w,h,7);ctx.fill();ctx.stroke();}
        else{ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}
        ctx.fillStyle=warn?WARN_ORANGE:MINT;
        ctx.font="700 12px -apple-system,BlinkMacSystemFont,sans-serif";
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(label,x+w/2,y+h/2+1);
        ctx.restore();
      };

      const smoothOri=(sample)=>{
        oriBuf.push(sample.orientation);
        if(oriBuf.length>12)oriBuf.shift();
        const counts={}; for(const o of oriBuf) counts[o]=(counts[o]||0)+1;
        let best="unknown",n=0; for(const k in counts){if(counts[k]>n){n=counts[k];best=k}}
        return best;
      };

      const runSessionFrame=(landmarks)=>{
        if(COUNTING_PAUSED){
          if(sessionPhase.phase!=="idle"&&sessionPhase.phase!=="top"){
            var keep=sessionPhase.repCount;
            sessionPhase=createPhase();
            sessionPhase.repCount=keep;
            sessionPhase.phase="idle";
            failedDuringRep=[];
          }
        }
        const repJoint=REP_JOINT||(POSE_SPEC&&POSE_SPEC.repJoint)||"knee";
        const rule=(POSE_SPEC&&POSE_SPEC.repRule)||{topAngle:160,bottomAngle:95,minRepDurationSec:1.2};
        const top=rule.topAngle!=null?rule.topAngle:160;
        const formBottom=depthTarget||(rule.bottomAngle!=null?rule.bottomAngle:95);
        const inverted=rule.direction==="inverted";
        // Looser bottom so shallow reps still complete a phase cycle; form checks use formBottom.
        const countBottom=inverted?formBottom:Math.max(formBottom, top-45);
        const rawAng=jointAngle(landmarks,repJoint);
        const jointVisible=rawAng!=null&&isFinite(rawAng);
        emaPrimary=jointVisible?ema(emaPrimary,rawAng):emaPrimary;
        const primaryAngle=jointVisible?emaPrimary:null;
        if(primaryAngle!=null)angleHist.push({t:performance.now(),a:primaryAngle});
        const recentMotion=hasMotion(performance.now());
        const sample=classifyOri(landmarks,CAL||{});
        const detectedView=smoothOri(sample);
        const requiredView=REQUIRED_VIEW||(POSE_SPEC&&POSE_SPEC.view)||"side";
        const orientationOk=RELAX_TRACKING_GATES?true:oriMatch(requiredView,detectedView);
        const gated=COUNTING_PAUSED||!orientationOk||!jointVisible;
        const atRest=sessionPhase.phase==="idle"||sessionPhase.phase==="top";
        const idleBlocked=RELAX_TRACKING_GATES?false:(atRest&&!recentMotion);
        const occluded={};
        if(POSE_SPEC&&POSE_SPEC.machineProfile&&POSE_SPEC.machineProfile.occludedLandmarks){
          const nameIdx={nose:0,left_eye:2,right_eye:5,left_ear:7,right_ear:8,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,left_wrist:15,right_wrist:16,left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28,left_heel:29,right_heel:30,left_foot_index:31,right_foot_index:32};
          const names=POSE_SPEC.machineProfile.occludedLandmarks;
          for(var oi=0;oi<names.length;oi++){var idx=nameIdx[names[oi]]; if(idx!=null)occluded[idx]=1}
        }
        let repCompleted=false;
        let repVerdict=null;
        let failedChecksThisRep=[];
        if(!gated&&!idleBlocked&&primaryAngle!=null){
          const stepped=stepPhase(sessionPhase,primaryAngle,{...rule,bottomAngle:countBottom,formBottomAngle:formBottom},performance.now());
          sessionPhase=stepped.state;
          repCompleted=stepped.repCompleted;
          phase=sessionPhase.phase;
          repCount=sessionPhase.repCount;
        } else {
          phase=sessionPhase.phase;
          repCount=sessionPhase.repCount;
        }
        const checks=(POSE_SPEC&&POSE_SPEC.checks)||[];
        const evald=evaluateChecks(landmarks,phase,checks,formBottom,detectedView,occluded);
        lastWarnIdx=evald.warnLandmarkIndices||[];
        if(!gated && (phase==="descending"||phase==="bottom"||phase==="ascending")){
          for(const id of evald.failingIds){
            if(failedDuringRep.indexOf(id)<0) failedDuringRep.push(id);
          }
          sessionPhase.failedDuringRep=failedDuringRep;
        }
        if(repCompleted){
          const crit=checks.some(c=>c.severity==="critical"&&failedDuringRep.indexOf(c.id)>=0);
          repVerdict=crit?"flagged":"clean";
          failedChecksThisRep=failedDuringRep.slice();
          failedDuringRep=[];
          sessionPhase.failedDuringRep=[];
        }
        const progress=rom01(primaryAngle,top,formBottom,inverted);
        const span=Math.max(1,top-formBottom);
        const target01=Math.max(0,Math.min(1,(top-formBottom)/span));
        const zoneStart=Math.max(0,target01-0.08), zoneEnd=Math.min(1,target01+0.14);
        const inZone=progress>=zoneStart&&progress<=zoneEnd;
        const formOk=!evald.criticalFailed&&orientationOk;
        const cueKey=!orientationOk?(requiredView==="side"?"cue_turn_side":"cue_turn_front"):evald.cueKey;
        const cuePriority=!orientationOk?"safety":evald.cuePriority;
        const jIdx=jointIdx(landmarks,repJoint);
        const drawLms=window.__mpZoomLms?window.__mpZoomLms(landmarks):landmarks;
        drawSkeleton(drawLms,formOk);
        drawLandmarks(drawLms,formOk);
        drawAngleTag(drawLms,primaryAngle,formOk,jIdx);
        emitTracking({
          reps:repCount,formOk,correction:cueKey||"",phase,bodyDetected:true,
          primaryAngle, rom01:progress, inDepthZone:inZone, zoneStart01:zoneStart, zoneEnd01:zoneEnd,
          failingCheckIds:evald.failingIds, warnLandmarkIndices:lastWarnIdx,
          cueKey, cuePriority, orientationOk, requiredView, detectedView,
          repCompleted, repVerdict, failedChecksThisRep, countingGated:gated||idleBlocked
        });
      };

      const detectLoop=()=>{
        if(!poseLandmarker)return;
        if(video.currentTime===lastVideoTime){rafId=requestAnimationFrame(detectLoop);return}
        lastVideoTime=video.currentTime;
        resizeCanvas();
        const result=poseLandmarker.detectForVideo(video,performance.now());
        ctx.clearRect(0,0,canvas.width,canvas.height);
        const rawLm=result?.landmarks?.[0];
        const landmarks=rawLm?.length?smoothLandmarks(rawLm):null;

        if(landmarks?.length){
          const drawLms=window.__mpZoomLms?window.__mpZoomLms(landmarks):landmarks;
          if(SESSION_MODE&&POSE_SPEC){runSessionFrame(landmarks);rafId=requestAnimationFrame(detectLoop);return}
          const centered=isCentered(landmarks);
          if(IS_CARDIO){
            drawFrame(centered);
            drawSkeleton(drawLms,centered);
            drawLandmarks(drawLms,centered);
            setText(badgeEl,TEXT.postureAwareness);
            setText(postureEl,TEXT.posture+": "+(centered?TEXT.centred:TEXT.adjustPosition));
            setBg(postureEl,centered?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            setText(hintEl,centered?TEXT.keepBodyFrame:TEXT.centreBody);
            setBg(hintEl,centered?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            emitTracking(0,centered,"", "idle", true);
          }else{
            const primaryAngle=getPrimaryAngle(landmarks);
            const movement=updateMovement(primaryAngle);
            const posture=evaluatePosture(landmarks,primaryAngle,movement.phase);
            const lineIsGood=EXERCISE_RULE?posture.isCorrect&&movement.dynamicOk:centered;
            const label=EXERCISE_RULE?EXERCISE_RULE.label:TEXT.unknown;
            drawFrame(lineIsGood);drawSkeleton(drawLms,lineIsGood);drawLandmarks(drawLms,lineIsGood);
            drawAngleTag(drawLms,primaryAngle,lineIsGood);
            setText(badgeEl,TEXT.exercise+": "+label+" · "+TEXT.reps+": "+movement.reps);
            setText(postureEl,TEXT.posture+": "+posture.status+" · "+TEXT.phase+": "+movement.phase.toUpperCase()+
              (primaryAngle?" · "+Math.round(primaryAngle)+"°":""));
            setBg(postureEl,lineIsGood?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            setText(hintEl,(lineIsGood?TEXT.rightPosture:TEXT.wrongPosture)+": "+(posture.correction||TEXT.adjustPosture));
            setBg(hintEl,lineIsGood?"rgba(34,197,94,0.45)":"rgba(239,68,68,0.45)");
            emitTracking(movement.reps,lineIsGood,posture.correction||"",movement.phase,true);
          }
        }else{
          drawFrame(false);
          setText(badgeEl,TEXT.exercise+": "+(EXERCISE_RULE?EXERCISE_RULE.label:TEXT.unknown));
          setText(postureEl,TEXT.noBodyDetected);
          setText(hintEl,TEXT.noFullBody);
          setBg(hintEl,"rgba(239,68,68,0.35)");
          if(SESSION_MODE){
            lastWarnIdx=[];
            emitTracking({reps:sessionPhase.repCount,formOk:false,correction:"",phase:sessionPhase.phase,bodyDetected:false,orientationOk:false,countingGated:true});
          }else emitTracking(repCount,false,"No body detected",phase,false);
        }
        rafId=requestAnimationFrame(detectLoop);
      };

      const stop=()=>{
        if(rafId)cancelAnimationFrame(rafId);rafId=null;
        if(poseLandmarker){poseLandmarker.close();poseLandmarker=null}
        if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
        window.__mpCamStream=null;
      };
      window.__mpCamStopStream=()=>{
        if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
        window.__mpCamStream=null;
      };
      window.__mpCamStartStream=async(facing)=>{
        const fm=facing||window.__mpCamState.facing||"user";
        window.__mpCamState.facing=fm;
        window.__mpApplyMirror();
        stream=await navigator.mediaDevices.getUserMedia({
          video:{facingMode:fm,width:{ideal:1280},height:{ideal:720}},audio:false
        });
        window.__mpCamStream=stream;
        video.srcObject=stream;
        await video.play();
        if(window.__mpSetZoom)await window.__mpSetZoom(window.__mpCamState.zoom||1);
      };

      document.addEventListener("visibilitychange",()=>{if(document.hidden)stop()});
      window.addEventListener("beforeunload",stop);

      (async()=>{
        try{
          await window.__mpCamStartStream(FACING_MODE);
          if(window.__mpNotifyCamStarted)window.__mpNotifyCamStarted(stream);
          const vision=await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm");
          poseLandmarker=await PoseLandmarker.createFromOptions(vision,{
            baseOptions:{
              modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate:"GPU"
            },
            runningMode:"VIDEO",numPoses:1,
            minPoseDetectionConfidence:0.35,
            minPosePresenceConfidence:0.35,
            minTrackingConfidence:0.35,
            outputSegmentationMasks:false
          });
          post("ready");detectLoop();
        }catch(err){
          const msg=err?.message??"MediaPipe failed to start";
          post("error",{message:msg});
        }
      })();
    <\/script>
  </body>
</html>`;
}
