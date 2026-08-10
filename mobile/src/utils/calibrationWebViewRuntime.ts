/**
 * Inline JS for calibration WebView — must stay in sync with calibrationCaptureStats.ts
 */
import {
  CALIBRATION_SQUAT_REP_RULE_JS,
  WEBVIEW_REP_PHASE_RUNTIME_JS,
} from "../services/aiTrainer/webviewRepPhaseRuntime";

export const CALIBRATION_CAPTURE_RUNTIME_JS = `
${WEBVIEW_REP_PHASE_RUNTIME_JS}
${CALIBRATION_SQUAT_REP_RULE_JS}
const CAL_CAPTURE_VIS_MIN=0.6;
const TURN_ANGLE_KEYS=["0","45","90","135","180","225","270","315"];
const SQUAT_MIN_REPS=2;

function median(vals){
  const v=vals.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);
  if(!v.length)return 0;
  const m=Math.floor(v.length/2);
  return v.length%2===0?(v[m-1]+v[m])/2:v[m];
}
function trimmedMean(vals,trimFrac){
  const t=trimFrac==null?0.15:trimFrac;
  const v=vals.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);
  if(!v.length)return 0;
  const trim=Math.floor(v.length*t);
  const slice=v.slice(trim,v.length-trim||undefined);
  const use=slice.length?slice:v;
  return use.reduce((a,b)=>a+b,0)/use.length;
}
function filterVisibleSamples(arr){
  return arr.filter(s=>(s.lVis||0)>=CAL_CAPTURE_VIS_MIN);
}
function estimateTurnAngleBucket(sample,frontRatio){
  if((sample.lVis||0)<CAL_CAPTURE_VIS_MIN)return null;
  const calRatio=Math.max(0.01,frontRatio);
  const relative=sample.ratio/calRatio;
  if(!Number.isFinite(relative))return null;
  const spread=Math.max(0.05,sample.shoulderWidth||0.1);
  const noseOffset=(sample.noseX!=null&&sample.shoulderMidX!=null)?(sample.noseX-sample.shoulderMidX)/spread:0;
  const sideFactor=1-Math.min(1,Math.max(0,(relative-0.42)/0.48));
  const angleRad=Math.atan2(noseOffset*(0.35+sideFactor*0.65),relative);
  let deg=((angleRad*180/Math.PI)+360)%360;
  const idx=Math.round(deg/45)%8;
  return TURN_ANGLE_KEYS[idx];
}
function computeTurnProgress(samples,frontRatio){
  const bucketsSeen=new Set();
  const vis=filterVisibleSamples(samples);
  for(const s of vis){
    const b=estimateTurnAngleBucket(s,frontRatio);
    if(b)bucketsSeen.add(b);
  }
  const frontBuckets=["0","180","315","45"];
  const sideBuckets=["90","270"];
  const hasFront=frontBuckets.some(b=>bucketsSeen.has(b));
  const hasSide=sideBuckets.some(b=>bucketsSeen.has(b));
  const progress01=Math.min(1,bucketsSeen.size/TURN_ANGLE_KEYS.length);
  const complete=bucketsSeen.size>=5&&hasFront&&hasSide&&vis.length>=40;
  return {bucketsSeen,progress01,hasFront,hasSide,complete};
}
function aggregateTurnConfidence(samples,frontRatio){
  const sums={};const counts={};
  for(const k of TURN_ANGLE_KEYS){sums[k]=0;counts[k]=0;}
  for(const s of filterVisibleSamples(samples)){
    const b=estimateTurnAngleBucket(s,frontRatio);
    if(!b)continue;
    const conf=Math.min(1,Math.max(0,s.lVis||0));
    sums[b]+=conf;counts[b]+=1;
  }
  const confidenceByAngle={};
  for(const k of TURN_ANGLE_KEYS){
    confidenceByAngle[k]=counts[k]>0?Math.round((sums[k]/counts[k])*100)/100:0;
  }
  return confidenceByAngle;
}
function aggregateTpose(samples){
  const vis=filterVisibleSamples(samples);
  const torsoLen=median(vis.map(s=>s.torsoLen))||0.31;
  const shoulderWidth=median(vis.map(s=>s.shoulderWidth))||0.19;
  const knees=vis.map(s=>s.knee).filter(v=>Number.isFinite(v));
  const standingKnee=knees.length?median(knees):168;
  const ratios=vis.map(s=>s.ratio).filter(v=>Number.isFinite(v)&&v>0);
  const frontRatio=ratios.length?median(ratios):shoulderWidth/Math.max(0.05,torsoLen);
  const leanVals=vis.map(s=>s.torsoLean).filter(v=>Number.isFinite(v));
  const torsoLeanBaseline=leanVals.length?median(leanVals):8;
  const limbs={
    upperArmL:median(vis.map(s=>s.upperArmL).filter(v=>v>0))||0.13,
    upperArmR:median(vis.map(s=>s.upperArmR).filter(v=>v>0))||0.13,
    thighL:median(vis.map(s=>s.thighL).filter(v=>v>0))||0.2,
    thighR:median(vis.map(s=>s.thighR).filter(v=>v>0))||0.2,
    shankL:median(vis.map(s=>s.shankL).filter(v=>v>0))||0.19,
    shankR:median(vis.map(s=>s.shankR).filter(v=>v>0))||0.19
  };
  const dArm=Math.abs(limbs.upperArmL-limbs.upperArmR)/Math.max(limbs.upperArmL,0.01);
  return {
    torsoLen,shoulderWidth,
    hipWidth:median(vis.map(s=>s.hipWidth))||0.14,
    limbs,frontShoulderRatio:frontRatio,
    standingKneeDeg:standingKnee,torsoLeanBaselineDeg:torsoLeanBaseline,
    asymmetryFlags:dArm>0.05?["upper_arm"]:[]
  };
}
function aggregateSquats(samples){
  const vis=filterVisibleSamples(samples);
  const knees=vis.map(s=>s.knee).filter(v=>Number.isFinite(v));
  const depthRaw=knees.length?median(knees):95;
  const hips=vis.map(s=>s.hip).filter(v=>Number.isFinite(v));
  const hingeRaw=hips.length?trimmedMean(hips):95;
  const dorsi=vis.map(s=>s.ankleFlex).filter(v=>Number.isFinite(v));
  const dorsiflex=dorsi.length?trimmedMean(dorsi):28;
  const squatDepthDeg=Number.isFinite(depthRaw)?depthRaw:95;
  return {
    squatDepthDeg,
    mobility:{
      depthTargetDeg:squatDepthDeg,
      hingeMaxDeg:Math.max(70,Math.min(120,hingeRaw+5)),
      dorsiflexionProxyDeg:Math.max(15,Math.min(45,dorsiflex))
    }
  };
}
`;
