/**
 * Standalone JS injected into MediaPipe WebView for sessionMode tracking.
 * Mirrors repStateMachine + orientation + poseCheckEval (keep in sync).
 */
export const WEBVIEW_SESSION_RUNTIME = `
var MIN_VIS=0.6, EMA_A=0.35, HYST=4;
function angle3(a,b,c){
  var baX=a.x-b.x,baY=a.y-b.y,bcX=c.x-b.x,bcY=c.y-b.y;
  var dot=baX*bcX+baY*bcY, cross=baX*bcY-baY*bcX;
  return Math.abs(Math.atan2(cross,dot)*180/Math.PI);
}
function visOk(lm){return lm&&(lm.visibility||0)>=MIN_VIS}
function ema(prev,next){return prev==null||!isFinite(prev)?next:EMA_A*next+(1-EMA_A)*prev}
function createPhase(){return{phase:"idle",pendingPhase:null,holdFrames:0,repCount:0,repStartedAt:null,lastVerdictAngles:{min:Infinity,max:-Infinity},failedDuringRep:[]}}
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
  var next={phase:state.phase,pendingPhase:state.pendingPhase,holdFrames:state.holdFrames,repCount:state.repCount,repStartedAt:state.repStartedAt,lastVerdictAngles:{min:Math.min(state.lastVerdictAngles.min,angle),max:Math.max(state.lastVerdictAngles.max,angle)},failedDuringRep:state.failedDuringRep.slice()};
  var desired=desiredPhase(next.phase,angle,rule);
  if(desired===next.phase){next.pendingPhase=null;next.holdFrames=0;return{state:next,repCompleted:false}}
  if(next.pendingPhase!==desired){next.pendingPhase=desired;next.holdFrames=1;return{state:next,repCompleted:false}}
  next.holdFrames+=1;
  if(next.holdFrames<HYST) return{state:next,repCompleted:false};
  var repCompleted=false;
  if(desired==="descending"&&(next.phase==="idle"||next.phase==="top")){next.repStartedAt=nowMs;next.lastVerdictAngles={min:angle,max:angle};next.failedDuringRep=[]}
  if(desired==="top"&&next.phase==="ascending"){
    var minDur=(rule.minRepDurationSec!=null?rule.minRepDurationSec:0.8)*1000;
    var dur=next.repStartedAt!=null?nowMs-next.repStartedAt:minDur;
    var topA=rule.topAngle!=null?rule.topAngle:160;
    var formBottom=rule.formBottomAngle!=null?rule.formBottomAngle:(rule.bottomAngle!=null?rule.bottomAngle:90);
    var excursion=next.lastVerdictAngles.max-next.lastVerdictAngles.min;
    var expected=Math.max(1,Math.abs(topA-formBottom));
    if(dur>=minDur&&excursion>=0.7*expected){next.repCount+=1;repCompleted=true}
    next.repStartedAt=null;
  }
  next.phase=desired;next.pendingPhase=null;next.holdFrames=0;
  return{state:next,repCompleted:repCompleted};
}
function jointAngle(lms,joint){
  function pick(la,lb,lc,ra,rb,rc){
    var L=visOk(lms[la])&&visOk(lms[lb])&&visOk(lms[lc])?angle3(lms[la],lms[lb],lms[lc]):null;
    var R=visOk(lms[ra])&&visOk(lms[rb])&&visOk(lms[rc])?angle3(lms[ra],lms[rb],lms[rc]):null;
    if(L==null)return R; if(R==null)return L;
    var lv=Math.min(lms[la].visibility||0,lms[lb].visibility||0,lms[lc].visibility||0);
    var rv=Math.min(lms[ra].visibility||0,lms[rb].visibility||0,lms[rc].visibility||0);
    return lv>=rv?L:R;
  }
  if(joint==="hip") return pick(11,23,25,12,24,26);
  if(joint==="elbow") return pick(11,13,15,12,14,16);
  if(joint==="front_knee"||joint==="lead_knee"){
    var lK=visOk(lms[23])&&visOk(lms[25])&&visOk(lms[27])?angle3(lms[23],lms[25],lms[27]):null;
    var rK=visOk(lms[24])&&visOk(lms[26])&&visOk(lms[28])?angle3(lms[24],lms[26],lms[28]):null;
    if(lK==null)return rK; if(rK==null)return lK; return lK<=rK?lK:rK;
  }
  if(joint==="shoulder"||joint==="shoulder_abduction"){
    var L=visOk(lms[13])&&visOk(lms[11])&&visOk(lms[23])?angle3(lms[13],lms[11],lms[23]):null;
    var R=visOk(lms[14])&&visOk(lms[12])&&visOk(lms[24])?angle3(lms[14],lms[12],lms[24]):null;
    if(L==null)return R; if(R==null)return L; return (L+R)/2;
  }
  return pick(23,25,27,24,26,28);
}
function jointIdx(lms,joint){
  function better(l,r){var lv=lms[l]?lms[l].visibility||0:0,rv=lms[r]?lms[r].visibility||0:0;if(lv<MIN_VIS&&rv<MIN_VIS)return null;return lv>=rv?l:r}
  if(joint==="hip") return better(23,24);
  if(joint==="elbow") return better(13,14);
  if(joint==="front_knee"||joint==="lead_knee"){
    var lv=lms[25]?lms[25].visibility||0:0,rv=lms[26]?lms[26].visibility||0:0;
    if(lv<MIN_VIS&&rv<MIN_VIS)return null;
    if(lv<MIN_VIS)return 26; if(rv<MIN_VIS)return 25;
    var la=visOk(lms[23])&&visOk(lms[27])?angle3(lms[23],lms[25],lms[27]):Infinity;
    var ra=visOk(lms[24])&&visOk(lms[28])?angle3(lms[24],lms[26],lms[28]):Infinity;
    return la<=ra?25:26;
  }
  if(joint==="shoulder"||joint==="shoulder_abduction") return better(11,12);
  return better(25,26);
}
function rom01(angle,top,bottom,inverted){
  if(angle==null||!isFinite(angle))return 0;
  if(inverted){var s=Math.max(1,bottom-top);return Math.max(0,Math.min(1,(angle-top)/s))}
  var s2=Math.max(1,top-bottom);return Math.max(0,Math.min(1,(top-angle)/s2));
}
function parseTorsoLeanCap(rule,fallback){
  var m=/torsoLean\\s*<=\\s*(\\d+(?:\\.\\d+)?)/i.exec(rule||"");
  return m?Number(m[1]):fallback;
}
function parseTorsoLenMul(rule,fallback){
  var m=/(\\d+(?:\\.\\d+)?)\\s*\\*\\s*torsoLen/i.exec(rule||"");
  return m?Number(m[1]):fallback;
}
function parseKneeCapRule(rule,fallback){
  var m=/kneeAngle\\s*>=\\s*(\\d+(?:\\.\\d+)?)/i.exec(rule||"");
  return m?Number(m[1]):fallback;
}
function parseShrugCap(rule){return parseTorsoLenMul(rule,0.04)}
function hipLockoutBand(cal){
  var standing=(cal&&cal.standingKneeDeg!=null)?cal.standingKneeDeg:168;
  return{min:Math.max(155,standing-5),max:Math.max(190,standing+22)};
}
function spineNeutralCap(cal){
  var baseline=(cal&&cal.torsoLeanBaselineDeg!=null)?cal.torsoLeanBaselineDeg:8;
  return baseline+12;
}
function elbowFlareMul(rule,fallback){
  var ar=/angle\\s+(\\d+)[\\u2013-](\\d+)/i.exec(rule||"");
  if(ar){var mx=Number(ar[2]); if(mx<=45)return 0.08; if(mx<=70)return 0.12;}
  return parseTorsoLenMul(rule,fallback);
}
function extractKneeCap(checks){
  for(var i=0;i<(checks||[]).length;i++){
    if(checks[i].id!=="knee_bend_cap")continue;
    var p=parseKneeCapRule(checks[i].rule);
    if(p!=null)return p;
  }
  return null;
}
function isBodyDetected(lms){
  var torso=(visOk(lms[11])&&visOk(lms[23]))||(visOk(lms[12])&&visOk(lms[24]));
  var leg=(visOk(lms[23])&&visOk(lms[25]))||(visOk(lms[24])&&visOk(lms[26]));
  return torso&&leg;
}
function resolveFormBottom(poseSpec,rule,cal){
  if(poseSpec&&poseSpec._depthTargetDeg!=null)return poseSpec._depthTargetDeg;
  return rule.bottomAngle!=null?rule.bottomAngle:95;
}
function torsoMetrics(lms){
  var lS=lms[11],rS=lms[12],lH=lms[23],rH=lms[24];
  if(!visOk(lS)||!visOk(rS)||!visOk(lH)||!visOk(rH))return null;
  var midS={x:(lS.x+rS.x)/2,y:(lS.y+rS.y)/2}, midH={x:(lH.x+rH.x)/2,y:(lH.y+rH.y)/2};
  var torsoLen=Math.max(0.05,Math.hypot(midS.x-midH.x,midS.y-midH.y));
  var lean=Math.abs(Math.atan2(midS.x-midH.x,midH.y-midS.y)*180/Math.PI);
  return{midS:midS,midH:midH,torsoLen:torsoLen,lean:lean};
}
function classifyOri(lms,cal){
  var lS=lms[11],rS=lms[12],lH=lms[23],rH=lms[24];
  if(!lS||!rS||!lH||!rH) return{orientation:"unknown",confidence:0};
  var lVis=lS.visibility||0,rVis=rS.visibility||0;
  if(lVis<0.35&&rVis<0.35) return{orientation:"unknown",confidence:0};
  var apparent=Math.abs(lS.x-rS.x);
  var midS={x:(lS.x+rS.x)/2,y:(lS.y+rS.y)/2}, midH={x:(lH.x+rH.x)/2,y:(lH.y+rH.y)/2};
  var torsoLen=Math.max(0.05,Math.hypot(midS.x-midH.x,midS.y-midH.y));
  var ratio=apparent/torsoLen;
  var calRatio=(cal.frontShoulderRatio!=null)?cal.frontShoulderRatio:((cal.shoulderWidth||0.19)/Math.max(0.05,cal.torsoLen||0.31));
  var relative=ratio/Math.max(0.01,calRatio);
  var orientation="unknown";
  if(lVis>=0.6&&rVis>=0.6&&relative>=0.8) orientation="front";
  else if(apparent<(cal.shoulderWidth||0.19)*0.45||relative<0.45) orientation="side";
  else if(relative>=0.45&&relative<0.8) orientation="front_45";
  else if(lVis>=0.6||rVis>=0.6) orientation=relative>=0.65?"front":"front_45";
  return{orientation:orientation,confidence:Math.min(lVis,rVis)};
}
function oriMatch(required,detected){
  if(detected==="unknown")return false;
  if(required===detected)return true;
  if(required==="front_45"&&(detected==="front"||detected==="front_45"))return true;
  if(required==="front"&&detected==="front_45")return true;
  return false;
}
var WARN_BY={depth:[23,24,25,26],torso_lean:[11,12,23,24],knee_forward_drift:[25,26,31,32],heel_lift:[27,28,29,30],knee_valgus:[23,24,25,26],tempo:[25,26],spine_neutral:[11,12,23,24],knee_bend_cap:[25,26],lockout:[23,24],rom_bottom:[13,14],elbow_flare:[11,12,13,14],elbow_pin:[13,14],asymmetry:[13,14],shrug:[11,12],torso_swing:[11,12,23,24],swing:[11,12,23,24],lumbar_arch:[11,12,23,24],full_stretch:[13,14],full_extension:[13,14],full_hang:[13,14]};
function evaluateChecks(lms,phase,checks,depthTarget,detectedView,occluded,cal,kneeCap){
  var failing=[], warn={}, bestCue=null, tm=torsoMetrics(lms);
  function consider(check,fail,landmarks){
    if(!fail)return;
    for(var i=0;i<landmarks.length;i++){if(occluded[landmarks[i]]||!visOk(lms[landmarks[i]]))return}
    failing.push(check.id);
    var w=WARN_BY[check.id]||landmarks; for(var j=0;j<w.length;j++) warn[w[j]]=1;
    var sev=check.severity==="critical"?2:1;
    var priority=check.safety?"safety":"correction";
    if(!bestCue||sev>bestCue.sev||(sev===bestCue.sev&&priority==="safety")) bestCue={key:check.cue,priority:priority,sev:sev};
  }
  for(var ci=0;ci<checks.length;ci++){
    var check=checks[ci];
    if(check.view&&check.view!=="unknown"){
      if(detectedView==="unknown")continue;
      if(check.view==="side"&&detectedView!=="side")continue;
      if(check.view==="front"&&detectedView==="side")continue;
    }
    var kneeAngle=jointAngle(lms,"knee");
    var hipAngle=jointAngle(lms,"hip");
    var elbowAngle=jointAngle(lms,"elbow");
    var inBottom=phase==="bottom"||phase==="ascending";
    if(check.id==="depth"){
      if(!inBottom||kneeAngle==null)continue;
      if(!(visOk(lms[23])&&visOk(lms[25])&&visOk(lms[27]))&&!(visOk(lms[24])&&visOk(lms[26])&&visOk(lms[28])))continue;
      consider(check,kneeAngle>depthTarget+5,[25,26,23,24]);
    } else if(check.id==="torso_lean"||check.id==="torso_swing"||check.id==="swing"||check.id==="lumbar_arch"){
      if(!tm)continue;
      var capDefault=check.id==="lumbar_arch"?15:(check.id.indexOf("swing")>=0?10:45);
      var capLean=parseTorsoLeanCap(check.rule,capDefault);
      consider(check,tm.lean>capLean,[11,12,23,24]);
    } else if(check.id==="knee_forward_drift"){
      if(!tm||!inBottom)continue;
      var side=visOk(lms[25])&&visOk(lms[31])?0:(visOk(lms[26])&&visOk(lms[32])?1:-1);
      if(side<0)continue;
      var knee=side===0?lms[25]:lms[26], toe=side===0?lms[31]:lms[32];
      consider(check,Math.abs(knee.x-toe.x)>0.12*tm.torsoLen,[25,26]);
    } else if(check.id==="heel_lift"){
      if(!tm)continue;
      var a=visOk(lms[27])?lms[27]:(visOk(lms[28])?lms[28]:null);
      var h=visOk(lms[29])?lms[29]:(visOk(lms[30])?lms[30]:null);
      if(!a||!h)continue;
      consider(check,Math.abs(a.y-h.y)>parseTorsoLenMul(check.rule,0.04)*tm.torsoLen,[27,28,29,30]);
    } else if(check.id==="knee_valgus"){
      if(detectedView==="side"||!tm)continue;
      function badSide(hip,knee,ankle){var mid=(hip.x+ankle.x)/2;return Math.abs(knee.x-mid)>0.06*tm.torsoLen}
      var badL=visOk(lms[23])&&visOk(lms[25])&&visOk(lms[27])&&badSide(lms[23],lms[25],lms[27]);
      var badR=visOk(lms[24])&&visOk(lms[26])&&visOk(lms[28])&&badSide(lms[24],lms[26],lms[28]);
      consider(check,badL||badR,[25,26]);
    } else if(check.id==="spine_neutral"){
      if(!tm||phase==="idle"||phase==="top")continue;
      consider(check,tm.lean>spineNeutralCap(cal||{}),[11,12,23,24]);
    } else if(check.id==="knee_bend_cap"){
      if(kneeAngle==null)continue;
      var kCap=kneeCap!=null?kneeCap:(parseKneeCapRule(check.rule,150));
      consider(check,kneeAngle<kCap,[25,26]);
    } else if(check.id==="elbow_flare"||check.id==="elbow_pin"){
      if(!tm||!visOk(lms[13])||!visOk(lms[14])||!visOk(lms[11])||!visOk(lms[12]))continue;
      var pinMul=parseTorsoLenMul(check.rule,0.07);
      var flareMul=elbowFlareMul(check.id==="elbow_flare"?check.rule:"",0.12);
      var pin=Math.abs(lms[13].x-lms[11].x)>pinMul*tm.torsoLen||Math.abs(lms[14].x-lms[12].x)>pinMul*tm.torsoLen;
      var flare=Math.abs(lms[13].x-lms[11].x)>flareMul*tm.torsoLen||Math.abs(lms[14].x-lms[12].x)>flareMul*tm.torsoLen;
      consider(check,check.id==="elbow_pin"?pin:flare,[13,14]);
    } else if(check.id==="rom_bottom"){
      if(!inBottom||elbowAngle==null)continue;
      consider(check,elbowAngle>90,[13,14]);
    } else if(check.id==="full_extension"||check.id==="full_stretch"||check.id==="full_hang"){
      if(elbowAngle==null)continue;
      if(phase!=="top"&&phase!=="idle"&&phase!=="bottom")continue;
      consider(check,elbowAngle<145,[13,14]);
    } else if(check.id==="lockout"){
      if(phase!=="top"&&phase!=="idle")continue;
      if(hipAngle!=null){var band=hipLockoutBand(cal||{});consider(check,hipAngle<band.min||hipAngle>band.max,[23,24]);}
      else if(elbowAngle!=null)consider(check,elbowAngle<160,[13,14]);
    } else if(check.id==="shrug"){
      if(!tm||!visOk(lms[11])||!visOk(lms[12]))continue;
      var ear=lms[7]||lms[8]||lms[0]; if(!visOk(ear))continue;
      var rise=Math.min(lms[11].y,lms[12].y)-ear.y;
      consider(check,rise>-parseShrugCap(check.rule)*tm.torsoLen,[11,12]);
    } else if(check.id==="asymmetry"){
      if(!visOk(lms[13])||!visOk(lms[14])||!visOk(lms[15])||!visOk(lms[16]))continue;
      consider(check,Math.abs(angle3(lms[11],lms[13],lms[15])-angle3(lms[12],lms[14],lms[16]))>15,[13,14]);
    }
  }
  var critical=false;
  for(var k=0;k<checks.length;k++) if(checks[k].severity==="critical"&&failing.indexOf(checks[k].id)>=0) critical=true;
  return{failingIds:failing,criticalFailed:critical,cueKey:bestCue?bestCue.key:null,cuePriority:bestCue?bestCue.priority:null,warnLandmarkIndices:Object.keys(warn).map(Number)};
}
`;
