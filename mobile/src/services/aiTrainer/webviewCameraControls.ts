/**
 * Inline JS for MediaPipe WebView pages — flip camera + zoom without remounting
 * the WebView. Optical zoom via applyConstraints when supported; otherwise
 * digital zoom with landmark display transform (__mpZoomLms).
 */
export const WEBVIEW_CAMERA_CONTROLS_JS = `
(function(){
  if(window.__mpCamControlsReady)return;
  window.__mpCamControlsReady=true;
  window.__mpEnableCameraDiagnostics=false;
  var __flipSeq=0;
  window.__mpFlipInProgress=false;
  window.__mpCamState={facing:"user",zoom:1,opticalMax:1,digital:false};
  window.__mpCamVideo=null;
  window.__mpCamCanvas=null;
  window.__mpCamStream=null;
  window.__mpCamStopStream=null;
  window.__mpCamStartStream=null;

  window.__mpApplyMirror=function(){
    var user=window.__mpCamState.facing==="user";
    if(document.body)document.body.classList.toggle("mp-mirror",user);
    var v=window.__mpCamVideo;
    var c=window.__mpCamCanvas;
    var z=window.__mpCamState.digital?window.__mpCamState.zoom:1;
    var parts=[];
    if(user)parts.push("scaleX(-1)");
    if(z>1.001)parts.push("scale("+z+")");
    var t=parts.length?parts.join(" "):"none";
    if(v){v.style.transformOrigin="center center";v.style.transform=t;}
    if(c){c.style.transformOrigin="center center";c.style.transform=t;}
  };
  window.__mpZoomLm=function(lm){
    var z=window.__mpCamState.zoom;
    if(!window.__mpCamState.digital||z<=1.001||!lm)return lm;
    return {x:(lm.x-0.5)*z+0.5,y:(lm.y-0.5)*z+0.5,z:lm.z,visibility:lm.visibility};
  };
  window.__mpZoomLms=function(lms){
    if(!lms||!lms.length)return lms;
    if(!window.__mpCamState.digital||window.__mpCamState.zoom<=1.001)return lms;
    return lms.map(window.__mpZoomLm);
  };

  window.__mpSetZoom=async function(level){
    var z=Math.max(1,Math.min(3,Number(level)||1));
    window.__mpCamState.zoom=z;
    var stream=window.__mpCamStream;
    var track=stream&&stream.getVideoTracks?stream.getVideoTracks()[0]:null;
    if(track&&track.getCapabilities){
      try{
        var caps=track.getCapabilities();
        if(caps&&caps.zoom){
          var min=caps.zoom.min!=null?caps.zoom.min:1;
          var max=caps.zoom.max!=null?caps.zoom.max:z;
          window.__mpCamState.opticalMax=max;
          var clamped=Math.max(min,Math.min(max,z));
          await track.applyConstraints({advanced:[{zoom:clamped}]});
          window.__mpCamState.zoom=clamped;
          window.__mpCamState.digital=false;
          window.__mpApplyMirror();
          return clamped;
        }
      }catch(e){}
    }
    window.__mpCamState.digital=true;
    window.__mpApplyMirror();
    return z;
  };

  window.__mpFlipCamera=async function(facing){
    if(window.__mpFlipInProgress)return window.__mpCamState.facing;
    window.__mpFlipInProgress=true;
    var seq=++__flipSeq;
    var next=facing||(window.__mpCamState.facing==="user"?"environment":"user");
    window.__mpCamState.facing=next;
    try{
      if(window.__mpCamStopStream)window.__mpCamStopStream();
      if(window.__mpCamStartStream)await window.__mpCamStartStream(next);
      if(seq===__flipSeq)window.__mpApplyMirror();
    }finally{
      if(seq===__flipSeq){
        try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:"cameraFlipped",facing:next}));}catch(e){}
      }
      window.__mpFlipInProgress=false;
    }
    return next;
  };

  window.__mpDiagLog=function(msg,data){
    if(!window.__mpEnableCameraDiagnostics)return;
    try{
      if(data!==undefined)console.log("[CAM-DIAG]",msg,data);
      else console.log("[CAM-DIAG]",msg);
    }catch(e){}
  };
  window.__mpSerializeMediaDict=function(obj){
    if(obj==null)return null;
    try{
      if(typeof obj!=="object")return obj;
      var out={};
      var keys=Object.keys(obj);
      for(var i=0;i<keys.length;i++){
        var k=keys[i],v=obj[k];
        if(v==null)out[k]=v;
        else if(typeof v==="number"||typeof v==="string"||typeof v==="boolean")out[k]=v;
        else if(typeof v.length==="number"&&typeof v!=="function")out[k]=Array.prototype.slice.call(v);
        else if(typeof v==="object")out[k]=window.__mpSerializeMediaDict(v);
        else out[k]=String(v);
      }
      return out;
    }catch(e){return null;}
  };
  window.__mpTrackProbe=function(track){
    if(!track)return null;
    var caps=null,settings=null,err=null;
    try{caps=track.getCapabilities?track.getCapabilities():null;}catch(e){err=(err||"")+"caps:"+String(e&&e.message||e);}
    try{settings=track.getSettings?track.getSettings():null;}catch(e){err=(err||"")+"settings:"+String(e&&e.message||e);}
    return{
      trackLabel:track.label||"",
      capabilities:window.__mpSerializeMediaDict(caps),
      settings:window.__mpSerializeMediaDict(settings),
      probeError:err||null,
      facingMode:settings&&settings.facingMode?settings.facingMode:null,
      zoom:caps&&caps.zoom?window.__mpSerializeMediaDict(caps.zoom):null,
      width:caps&&caps.width?window.__mpSerializeMediaDict(caps.width):null,
      height:caps&&caps.height?window.__mpSerializeMediaDict(caps.height):null
    };
  };
  window.__mpIsBackDevice=function(dev,probe){
    var label=(dev&&dev.label||"")+(probe&&probe.trackLabel||"");
    if(/back|rear|environment/i.test(label))return true;
    if(probe&&probe.facingMode==="environment")return true;
    if(probe&&probe.settings&&probe.settings.facingMode==="environment")return true;
    return false;
  };
  window.__mpRunCameraDiagnostics=async function(activeStream){
    if(window.__mpCamDiagDone)return null;
    window.__mpCamDiagDone=true;
    var log=window.__mpDiagLog;
    log("starting multi-camera feasibility probe");
    var supportedConstraints=null;
    try{
      if(navigator.mediaDevices&&navigator.mediaDevices.getSupportedConstraints){
        supportedConstraints=window.__mpSerializeMediaDict(navigator.mediaDevices.getSupportedConstraints());
      }
    }catch(e){log("getSupportedConstraints failed",String(e&&e.message||e));}
    var activeTrack=activeStream&&activeStream.getVideoTracks?activeStream.getVideoTracks()[0]:null;
    var activeProbe=window.__mpTrackProbe(activeTrack);
    var activeDeviceId=activeProbe&&activeProbe.settings?activeProbe.settings.deviceId:null;
    var activeStreamInfo={
      deviceId:activeProbe&&activeProbe.settings?activeProbe.settings.deviceId:null,
      facingMode:activeProbe&&activeProbe.facingMode||window.__mpCamState.facing||null,
      label:activeTrack&&activeTrack.label||"",
      capabilities:activeProbe&&activeProbe.capabilities,
      settings:activeProbe&&activeProbe.settings,
      zoom:activeProbe&&activeProbe.zoom,
      width:activeProbe&&activeProbe.width,
      height:activeProbe&&activeProbe.height
    };
    log("active stream",activeStreamInfo);
    var devices=[];
    try{
      if(navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices){
        devices=await navigator.mediaDevices.enumerateDevices();
      }
    }catch(e){log("enumerateDevices failed",String(e&&e.message||e));}
    var videoInputs=devices.filter(function(d){return d.kind==="videoinput";});
    log("video inputs ("+videoInputs.length+")",videoInputs.map(function(d){
      return{deviceId:d.deviceId,label:d.label,groupId:d.groupId};
    }));
    var probeResults=[];
    for(var vi=0;vi<videoInputs.length;vi++){
      var dev=videoInputs[vi];
      var entry={
        deviceId:dev.deviceId,
        label:dev.label||"",
        groupId:dev.groupId||"",
        probeOk:false,
        probeError:null,
        trackLabel:null,
        capabilities:null,
        settings:null,
        facingMode:null,
        zoom:null,
        width:null,
        height:null,
        isBack:false
      };
      try{
        if(dev.deviceId===activeDeviceId&&activeTrack&&activeTrack.readyState==="live"){
          entry.probeOk=true;
          entry.trackLabel=activeProbe.trackLabel;
          entry.capabilities=activeProbe.capabilities;
          entry.settings=activeProbe.settings;
          entry.facingMode=activeProbe.facingMode;
          entry.zoom=activeProbe.zoom;
          entry.width=activeProbe.width;
          entry.height=activeProbe.height;
          entry.probeError=activeProbe.probeError;
          log("probe device "+vi+" (active stream)",entry);
        }else{
          var probeStream=await navigator.mediaDevices.getUserMedia({
            video:{deviceId:{exact:dev.deviceId},width:{ideal:640},height:{ideal:480}},
            audio:false
          });
          var probeTrack=probeStream.getVideoTracks()[0];
          var pr=window.__mpTrackProbe(probeTrack);
          entry.probeOk=true;
          entry.trackLabel=pr.trackLabel;
          entry.capabilities=pr.capabilities;
          entry.settings=pr.settings;
          entry.facingMode=pr.facingMode;
          entry.zoom=pr.zoom;
          entry.width=pr.width;
          entry.height=pr.height;
          entry.probeError=pr.probeError;
          probeStream.getTracks().forEach(function(t){try{t.stop();}catch(e){}});
          log("probe device "+vi,entry);
        }
      }catch(e){
        entry.probeError=String(e&&e.message||e);
        log("probe device "+vi+" failed",entry.probeError);
      }
      entry.isBack=window.__mpIsBackDevice(dev,entry);
      probeResults.push(entry);
    }
    if(!activeTrack||activeTrack.readyState!=="live"){
      log("active stream ended during probe — restarting camera");
      try{
        if(window.__mpCamStartStream){
          await window.__mpCamStartStream(window.__mpCamState.facing);
          var v=window.__mpCamVideo;
          if(v&&window.__mpCamStream){
            v.srcObject=window.__mpCamStream;
            await v.play();
          }
          activeStream=window.__mpCamStream;
          activeTrack=activeStream&&activeStream.getVideoTracks?activeStream.getVideoTracks()[0]:null;
          activeProbe=window.__mpTrackProbe(activeTrack);
          activeStreamInfo={
            deviceId:activeProbe&&activeProbe.settings?activeProbe.settings.deviceId:null,
            facingMode:activeProbe&&activeProbe.facingMode||window.__mpCamState.facing||null,
            label:activeTrack&&activeTrack.label||"",
            capabilities:activeProbe&&activeProbe.capabilities,
            settings:activeProbe&&activeProbe.settings,
            zoom:activeProbe&&activeProbe.zoom,
            width:activeProbe&&activeProbe.width,
            height:activeProbe&&activeProbe.height
          };
        }
      }catch(e){log("restart after probe failed",String(e&&e.message||e));}
    }
    var backDevices=probeResults.filter(function(p){return p.isBack;});
    var zoomDevices=probeResults.filter(function(p){return p.zoom&&p.zoom.max!=null&&p.zoom.max>1.001;});
    var maxZoom=1;
    for(var zi=0;zi<probeResults.length;zi++){
      var z=probeResults[zi].zoom;
      if(z&&z.max!=null&&z.max>maxZoom)maxZoom=z.max;
    }
    var payload={
      type:"cameraDiagnostics",
      timestamp:Date.now(),
      userAgent:navigator.userAgent||"",
      supportedConstraints:supportedConstraints,
      activeStream:activeStreamInfo,
      devices:probeResults,
      summary:{
        videoInputCount:videoInputs.length,
        backCameraCount:backDevices.length,
        devicesWithZoom:zoomDevices.length,
        maxZoomAcrossDevices:maxZoom,
        multiBackLikely:backDevices.length>1,
        opticalZoomOnActive:activeStreamInfo.zoom&&activeStreamInfo.zoom.max>1.001,
        webViewZoomSupported:supportedConstraints&&supportedConstraints.zoom===true
      }
    };
    log("summary",payload.summary);
    log("full payload",payload);
    try{
      if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }catch(e){log("postMessage failed",String(e&&e.message||e));}
    return payload;
  };
  window.__mpNotifyCamStarted=function(stream){
    if(!window.__mpEnableCameraDiagnostics||window.__mpCamDiagDone)return;
    var s=stream||window.__mpCamStream;
    if(!s)return;
    window.__mpRunCameraDiagnostics(s).catch(function(e){
      window.__mpDiagLog("diagnostics error",String(e&&e.message||e));
    });
  };
})();
`;

/** Payload posted from WebView when camera diagnostics complete. */
export type CameraDiagnosticsSummary = {
  videoInputCount: number;
  backCameraCount: number;
  devicesWithZoom: number;
  maxZoomAcrossDevices: number;
  multiBackLikely: boolean;
  opticalZoomOnActive: boolean;
  webViewZoomSupported: boolean;
};

export type CameraDiagnosticsDeviceProbe = {
  deviceId: string;
  label: string;
  groupId: string;
  probeOk: boolean;
  probeError: string | null;
  trackLabel: string | null;
  capabilities: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  facingMode: string | null;
  zoom: { min?: number; max?: number; step?: number } | null;
  width: { min?: number; max?: number } | null;
  height: { min?: number; max?: number } | null;
  isBack: boolean;
};

export type CameraDiagnosticsPayload = {
  type: "cameraDiagnostics";
  timestamp: number;
  userAgent: string;
  supportedConstraints: Record<string, boolean> | null;
  activeStream: {
    deviceId: string | null;
    facingMode: string | null;
    label: string;
    capabilities: Record<string, unknown> | null;
    settings: Record<string, unknown> | null;
    zoom: { min?: number; max?: number; step?: number } | null;
    width: { min?: number; max?: number } | null;
    height: { min?: number; max?: number } | null;
  };
  devices: CameraDiagnosticsDeviceProbe[];
  summary: CameraDiagnosticsSummary;
};

/** Log camera diagnostics to Metro / adb logcat — dev-only (pending lens feasibility test). */
export function logCameraDiagnostics(payload: CameraDiagnosticsPayload): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  console.log("[CAM-DIAG] summary:", JSON.stringify(payload.summary));
  for (let i = 0; i < payload.devices.length; i++) {
    const d = payload.devices[i];
    console.log(
      `[CAM-DIAG] device[${i}] back=${d.isBack} probeOk=${d.probeOk} label="${d.label}" zoom=${JSON.stringify(d.zoom)}`,
    );
  }
}

export const CAMERA_ZOOM_MIN = 1;
export const CAMERA_ZOOM_MAX = 3;
export const CAMERA_ZOOM_STEP = 0.25;

/** Display zoom as "1.5×" (not a percentage). */
export function formatCameraZoom(zoomLevel: number): string {
  const rounded = Math.round(zoomLevel * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}×` : `${rounded.toFixed(1)}×`;
}
