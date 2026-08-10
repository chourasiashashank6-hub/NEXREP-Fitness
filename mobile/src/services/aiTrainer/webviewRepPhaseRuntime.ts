/**
 * Shared rep phase machine injected into WebViews (session + calibration).
 * Keep in sync with repStateMachine.ts.
 */
export const WEBVIEW_REP_PHASE_RUNTIME_JS = `
var EMA_A=0.35, HYST=4;
function ema(prev,next){return prev==null||!isFinite(prev)?next:EMA_A*next+(1-EMA_A)*prev;}
function createPhase(){return{phase:"idle",pendingPhase:null,holdFrames:0,repCount:0,repStartedAt:null,lastVerdictAngles:{min:Infinity,max:-Infinity}};}
function desiredPhase(phase,angle,rule){
  var inverted=rule.direction==="inverted";
  var top=rule.topAngle!=null?rule.topAngle:160;
  var bottom=rule.bottomAngle!=null?rule.bottomAngle:90;
  var atBottom=inverted?angle>=bottom-5:angle<=bottom+5;
  var atTop=inverted?angle<=top+5:angle>=top-5;
  var goingDown=inverted?angle>top+10:angle<top-10;
  var goingUp=inverted?angle<bottom-10:angle>bottom+10;
  if(phase==="idle"||phase==="top") return goingDown&&!atTop?"descending":phase;
  if(phase==="descending") return atBottom?"bottom":"descending";
  if(phase==="bottom") return goingUp?"ascending":"bottom";
  if(phase==="ascending") return atTop?"top":"ascending";
  return phase;
}
function stepPhase(state,angle,rule,nowMs){
  if(rule.type==="timed_hold"||angle==null||!isFinite(angle)) return{state:state,repCompleted:false};
  var next={phase:state.phase,pendingPhase:state.pendingPhase,holdFrames:state.holdFrames,repCount:state.repCount,repStartedAt:state.repStartedAt,lastVerdictAngles:{min:Math.min(state.lastVerdictAngles.min,angle),max:Math.max(state.lastVerdictAngles.max,angle)}};
  var desired=desiredPhase(next.phase,angle,rule);
  if(desired===next.phase){next.pendingPhase=null;next.holdFrames=0;return{state:next,repCompleted:false};}
  if(next.pendingPhase!==desired){next.pendingPhase=desired;next.holdFrames=1;return{state:next,repCompleted:false};}
  next.holdFrames+=1;
  if(next.holdFrames<HYST) return{state:next,repCompleted:false};
  var repCompleted=false;
  if(desired==="descending"&&(next.phase==="idle"||next.phase==="top")){next.repStartedAt=nowMs;next.lastVerdictAngles={min:angle,max:angle};}
  if(desired==="top"&&next.phase==="ascending"){
    var minDur=(rule.minRepDurationSec!=null?rule.minRepDurationSec:0.8)*1000;
    var dur=next.repStartedAt!=null?nowMs-next.repStartedAt:minDur;
    var topA=rule.topAngle!=null?rule.topAngle:160;
    var formBottom=rule.formBottomAngle!=null?rule.formBottomAngle:(rule.bottomAngle!=null?rule.bottomAngle:90);
    var excursion=next.lastVerdictAngles.max-next.lastVerdictAngles.min;
    var expected=Math.max(1,Math.abs(topA-formBottom));
    if(dur>=minDur&&excursion>=0.7*expected){next.repCount+=1;repCompleted=true;}
    next.repStartedAt=null;
  }
  next.phase=desired;next.pendingPhase=null;next.holdFrames=0;
  return{state:next,repCompleted:repCompleted};
}
`;

/** squat_lunge family defaults — used by calibration squats step. */
export const CALIBRATION_SQUAT_REP_RULE_JS = `
const CAL_SQUAT_RULE={topAngle:160,bottomAngle:95,minRepDurationSec:1.2,direction:"normal"};
function shouldCaptureSquatDepthSample(phaseState,knee){
  if(knee==null||!Number.isFinite(knee))return false;
  var inBottom=phaseState.phase==="bottom"||phaseState.phase==="ascending";
  return inBottom&&knee<150;
}
`;
