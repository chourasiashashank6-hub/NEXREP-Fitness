import React, { useState, useEffect, useRef } from "react";

// ---------- NexRep AI Trainer — UI Mockup ----------
// Palette: camera-dark base, NexRep mint for tracking, coach purple, burn orange
const C = {
  mint: "#2DD4A7",
  mintDeep: "#0F6E56",
  purple: "#8B5CF6",
  orange: "#FF7A45",
  red: "#FF4D5E",
  bg: "#07100D",
  glass: "rgba(10,22,18,0.62)",
  line: "rgba(255,255,255,0.10)",
  txt: "#F4FBF8",
  dim: "rgba(244,251,248,0.55)",
  gold: "#E8B84B",
};

const font = `<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
@keyframes scanline{0%{top:8%}50%{top:88%}100%{top:8%}}
@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes wave{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes glowPing{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.2);opacity:0}}
@media (prefers-reduced-motion: reduce){*{animation-duration:0.001s !important}}
</style>`;

const D = Math.PI / 180;

// side-view squat skeleton from depth d (0 stand → 1 bottom)
function pose(d) {
  const ax = 158, ay = 336, L1 = 84, L2 = 88, L3 = 96;
  const a1 = (6 + 26 * d) * D;          // shank lean
  const a2 = (12 + 74 * d) * D;         // thigh fold
  const a3 = (6 + 32 * d) * D;          // torso lean
  const knee = [ax + L1 * Math.sin(a1), ay - L1 * Math.cos(a1)];
  const hip = [knee[0] - L2 * Math.sin(a2), knee[1] - L2 * Math.cos(a2)];
  const sho = [hip[0] + L3 * Math.sin(a3), hip[1] - L3 * Math.cos(a3)];
  const head = [sho[0] + 26 * Math.sin(a3), sho[1] - 26 * Math.cos(a3) - 8];
  const wrist = [sho[0] + 78, sho[1] + 10 + 20 * d];
  const elbow = [(sho[0] + wrist[0]) / 2 + 4, (sho[1] + wrist[1]) / 2 - 6];
  const toe = [ax + 34, ay + 4];
  return { ankle: [ax, ay], knee, hip, sho, head, wrist, elbow, toe };
}

function Joint({ p, warn, size = 6 }) {
  return (
    <g>
      {warn && (
        <circle cx={p[0]} cy={p[1]} r={12} fill="none" stroke={C.orange} strokeWidth="2"
          style={{ transformOrigin: `${p[0]}px ${p[1]}px`, animation: "glowPing 1s ease-out infinite" }} />
      )}
      <circle cx={p[0]} cy={p[1]} r={size} fill={warn ? C.orange : C.mint} stroke="#052018" strokeWidth="2" />
    </g>
  );
}

function Bone({ a, b, warn }) {
  return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
    stroke={warn ? C.orange : C.mint} strokeWidth="4" strokeLinecap="round" opacity="0.95" />;
}

// ---------- shared chrome ----------
function Glass({ children, style }) {
  return (
    <div style={{
      background: C.glass, border: `1px solid ${C.line}`, borderRadius: 18,
      backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", ...style,
    }}>{children}</div>
  );
}

function Waveform({ active, color = C.purple }) {
  return (
    <div style={{ display: "flex", gap: 2.5, alignItems: "center", height: 16 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{
          width: 3, height: 14, borderRadius: 2, background: color,
          transformOrigin: "center",
          animation: active ? `wave ${0.7 + i * 0.13}s ease-in-out infinite` : "none",
          transform: active ? undefined : "scaleY(.3)", opacity: active ? 1 : 0.4,
        }} />
      ))}
    </div>
  );
}

function CameraBackdrop() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: `radial-gradient(120% 90% at 50% 18%, #14332a 0%, #0b1d17 46%, ${C.bg} 100%)`,
    }}>
      {/* faux gym environment */}
      <div style={{ position: "absolute", left: 0, right: 0, top: "72%", height: 1, background: "rgba(45,212,167,0.14)" }} />
      <div style={{ position: "absolute", left: "8%", top: "30%", width: 3, height: "42%", background: "rgba(255,255,255,0.05)", borderRadius: 2 }} />
      <div style={{ position: "absolute", right: "10%", top: "36%", width: 3, height: "36%", background: "rgba(255,255,255,0.05)", borderRadius: 2 }} />
      <div style={{
        position: "absolute", inset: 0, opacity: 0.5, mixBlendMode: "overlay",
        backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "22px 22px",
      }} />
    </div>
  );
}

// ---------- LIVE SCREEN ----------
function LiveScreen() {
  const [t, setT] = useState(0);
  const [reps, setReps] = useState([true, true, true]);
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState(96);
  const phaseRef = useRef("up");
  const shallowRef = useRef(false);
  const raf = useRef();

  useEffect(() => {
    let start = performance.now();
    const loop = (now) => {
      const el = (now - start) / 1000;
      setT(el);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const cyc = t % 3.2;
  const repIndex = Math.floor(t / 3.2);
  const shallow = repIndex % 4 === 3;
  let d = (1 - Math.cos((cyc / 3.2) * 2 * Math.PI)) / 2;
  if (shallow) d *= 0.58;

  // rep + feedback state machine
  useEffect(() => {
    if (d > 0.5 && phaseRef.current === "up") {
      phaseRef.current = "down";
      shallowRef.current = shallow;
      if (shallow) {
        setFeedback({ text: "A little shallow — sink until your thighs hit the green zone", tone: "warn" });
      }
    }
    if (d < 0.08 && phaseRef.current === "down") {
      phaseRef.current = "up";
      const clean = !shallowRef.current;
      setReps(r => [...r.slice(-11), clean]);
      setScore(s => Math.max(72, Math.min(99, s + (clean ? 1 : -4))));
      if (clean) setFeedback({ text: "Clean rep — great depth and tempo", tone: "good" });
      setTimeout(() => setFeedback(f => f), 0);
    }
  }, [d, shallow]);

  const P = pose(d);
  const kneeWarn = shallow && d > 0.3;
  const depthPct = Math.min(1, d / 0.9);
  const repCount = reps.length;
  const cleanCount = reps.filter(Boolean).length;
  const knAngle = Math.round(172 - 92 * d);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <CameraBackdrop />

      {/* skeleton */}
      <svg viewBox="0 0 320 420" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <Bone a={P.ankle} b={P.toe} />
        <Bone a={P.ankle} b={P.knee} warn={kneeWarn} />
        <Bone a={P.knee} b={P.hip} warn={kneeWarn} />
        <Bone a={P.hip} b={P.sho} />
        <Bone a={P.sho} b={P.elbow} />
        <Bone a={P.elbow} b={P.wrist} />
        <circle cx={P.head[0]} cy={P.head[1]} r="15" fill="none" stroke={C.mint} strokeWidth="4" />
        <Joint p={P.ankle} /><Joint p={P.knee} warn={kneeWarn} size={7} />
        <Joint p={P.hip} warn={kneeWarn} size={7} /><Joint p={P.sho} />
        <Joint p={P.elbow} size={5} /><Joint p={P.wrist} size={5} />
        {/* live knee angle tag */}
        <g style={{ animation: "rise .3s ease" }}>
          <rect x={P.knee[0] + 12} y={P.knee[1] - 12} rx="7" width="52" height="22"
            fill="rgba(5,32,24,0.85)" stroke={kneeWarn ? C.orange : "rgba(45,212,167,0.5)"} />
          <text x={P.knee[0] + 38} y={P.knee[1] + 3} textAnchor="middle" fontSize="12" fontWeight="700"
            fill={kneeWarn ? C.orange : C.mint} fontFamily="'Space Grotesk',sans-serif">{knAngle}°</text>
        </g>
      </svg>

      {/* top bar */}
      <div style={{ position: "absolute", top: 14, left: 14, right: 14, display: "flex", gap: 8, alignItems: "center" }}>
        <Glass style={{ flex: 1, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: 4, background: C.mint,
            boxShadow: `0 0 10px ${C.mint}`, animation: "pulse 1.6s infinite",
          }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 15, color: C.txt }}>Barbell Squat</div>
            <div style={{ fontSize: 11, color: C.dim, fontFamily: "Inter" }}>Set 2 of 4 · Leg Day</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <Waveform active={!!feedback} />
            <span style={{ fontSize: 10, color: C.purple, fontWeight: 600, fontFamily: "Inter" }}>COACH ON</span>
          </div>
        </Glass>
        <Glass style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: 14, color: C.dim, fontSize: 16 }}>✕</Glass>
      </div>

      {/* rep counter + form score */}
      <div style={{ position: "absolute", top: 88, left: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <Glass style={{ padding: "12px 16px", borderRadius: 20, textAlign: "center", minWidth: 92 }}>
          <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 40, lineHeight: 1, color: C.txt }}>
            {repCount}<span style={{ fontSize: 16, color: C.dim }}>/12</span>
          </div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.mint, fontWeight: 700, marginTop: 4, fontFamily: "Inter" }}>CLEAN REPS</div>
          <div style={{ fontSize: 10, color: C.dim, fontFamily: "Inter", marginTop: 2 }}>{cleanCount} perfect · {repCount - cleanCount} flagged</div>
        </Glass>
        <Glass style={{ padding: "10px 14px", borderRadius: 20, textAlign: "center" }}>
          <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22, color: score > 88 ? C.mint : C.orange }}>{score}</div>
          <div style={{ fontSize: 9, letterSpacing: 1.5, color: C.dim, fontWeight: 600, fontFamily: "Inter" }}>FORM SCORE</div>
        </Glass>
      </div>

      {/* depth gauge — signature element */}
      <div style={{ position: "absolute", top: 96, right: 16, bottom: 170, width: 34, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontSize: 9, letterSpacing: 1.2, color: C.dim, fontWeight: 700, marginBottom: 6, fontFamily: "Inter" }}>DEPTH</div>
        <div style={{ position: "relative", flex: 1, width: 10, borderRadius: 6, background: "rgba(255,255,255,0.08)", border: `1px solid ${C.line}` }}>
          {/* personalised target band */}
          <div style={{ position: "absolute", left: -3, right: -3, top: "74%", height: "22%", borderRadius: 6, background: "rgba(45,212,167,0.22)", border: `1px dashed ${C.mint}` }} />
          {/* live marker */}
          <div style={{
            position: "absolute", left: -8, right: -8, top: `calc(${depthPct * 92}% )`, height: 5, borderRadius: 3,
            background: depthPct > 0.74 ? C.mint : C.txt, boxShadow: depthPct > 0.74 ? `0 0 12px ${C.mint}` : "none",
          }} />
        </div>
        <div style={{ fontSize: 9, color: C.mint, fontWeight: 700, marginTop: 6, fontFamily: "Inter" }}>YOUR RANGE</div>
      </div>

      {/* rep quality dots */}
      <div style={{ position: "absolute", bottom: 128, left: 14, right: 60, display: "flex", gap: 5 }}>
        {reps.slice(-12).map((ok, i) => (
          <div key={i} style={{
            width: 14, height: 5, borderRadius: 3,
            background: ok ? C.mint : C.orange, opacity: 0.5 + 0.5 * (i / 12),
          }} />
        ))}
      </div>

      {/* coach banner */}
      <div style={{ position: "absolute", bottom: 62, left: 14, right: 14 }}>
        <Glass style={{
          padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", borderRadius: 20,
          border: `1px solid ${feedback?.tone === "warn" ? "rgba(255,122,69,0.55)" : "rgba(139,92,246,0.45)"}`,
          animation: "rise .35s ease",
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 13, display: "grid", placeItems: "center", flexShrink: 0,
            background: feedback?.tone === "warn" ? "rgba(255,122,69,0.18)" : "rgba(139,92,246,0.2)",
            fontSize: 18,
          }}>{feedback?.tone === "warn" ? "⚠️" : "🎧"}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.4, fontWeight: 700, fontFamily: "Inter", color: feedback?.tone === "warn" ? C.orange : C.purple }}>
              {feedback?.tone === "warn" ? "AUDIO CUE · CORRECTION" : "AUDIO CUE · COACH"}
            </div>
            <div style={{ fontSize: 13.5, color: C.txt, fontFamily: "Inter", fontWeight: 500, marginTop: 2 }}>
              {feedback ? feedback.text : "Tracking locked — start when ready"}
            </div>
          </div>
          <Waveform active={!!feedback} color={feedback?.tone === "warn" ? C.orange : C.purple} />
        </Glass>
      </div>

      {/* bottom controls */}
      <div style={{ position: "absolute", bottom: 12, left: 14, right: 14, display: "flex", gap: 8 }}>
        {["⏸ Pause", "🔊 Voice", "↻ Flip cam"].map((l, i) => (
          <Glass key={i} style={{
            flex: 1, padding: "10px 0", textAlign: "center", borderRadius: 14, fontSize: 12,
            fontFamily: "Inter", fontWeight: 600, color: i === 1 ? C.purple : C.dim,
            border: i === 1 ? `1px solid rgba(139,92,246,0.5)` : `1px solid ${C.line}`,
          }}>{l}</Glass>
        ))}
      </div>
    </div>
  );
}

// ---------- CALIBRATION ----------
function CalibrateScreen() {
  const checks = [
    ["Limb proportions", "done"],
    ["Standing baseline", "done"],
    ["Hip & ankle mobility", "active"],
    ["Personal depth range", "wait"],
  ];
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <CameraBackdrop />
      {/* T-pose silhouette */}
      <svg viewBox="0 0 320 420" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <g stroke={C.mint} strokeWidth="4" strokeLinecap="round" opacity="0.9">
          <circle cx="160" cy="118" r="16" fill="none" />
          <line x1="160" y1="136" x2="160" y2="236" />
          <line x1="160" y1="156" x2="92" y2="156" /><line x1="160" y1="156" x2="228" y2="156" />
          <line x1="160" y1="236" x2="132" y2="330" /><line x1="160" y1="236" x2="188" y2="330" />
        </g>
        {[[160,136],[92,156],[228,156],[160,236],[132,330],[188,330]].map((p,i)=>(
          <circle key={i} cx={p[0]} cy={p[1]} r="6" fill={C.mint} stroke="#052018" strokeWidth="2" />
        ))}
        {/* measurement ticks */}
        <g stroke="rgba(244,251,248,0.35)" strokeDasharray="3 4" strokeWidth="1.5">
          <line x1="248" y1="102" x2="248" y2="330" />
          <line x1="240" y1="102" x2="256" y2="102" /><line x1="240" y1="330" x2="256" y2="330" />
        </g>
        <text x="262" y="220" fontSize="11" fill={C.dim} fontFamily="Inter">1.0×</text>
      </svg>
      {/* scan line */}
      <div style={{
        position: "absolute", left: "12%", right: "12%", height: 2, borderRadius: 2,
        background: `linear-gradient(90deg, transparent, ${C.mint}, transparent)`,
        boxShadow: `0 0 18px ${C.mint}`, animation: "scanline 3.4s ease-in-out infinite",
      }} />

      <div style={{ position: "absolute", top: 18, left: 14, right: 14, textAlign: "center" }}>
        <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 19, color: C.txt }}>Body calibration</div>
        <div style={{ fontSize: 12, color: C.dim, fontFamily: "Inter", marginTop: 3 }}>
          Hold a T-pose — NexRep learns <i>your</i> proportions, not a template
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 14, left: 14, right: 14 }}>
        <Glass style={{ padding: 14, borderRadius: 20 }}>
          {checks.map(([label, st], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px" }}>
              <div style={{
                width: 20, height: 20, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 11,
                background: st === "done" ? "rgba(45,212,167,0.2)" : st === "active" ? "rgba(139,92,246,0.22)" : "rgba(255,255,255,0.06)",
                color: st === "done" ? C.mint : st === "active" ? C.purple : C.dim,
                border: `1px solid ${st === "done" ? "rgba(45,212,167,.5)" : st === "active" ? "rgba(139,92,246,.5)" : C.line}`,
                animation: st === "active" ? "pulse 1.4s infinite" : "none",
              }}>{st === "done" ? "✓" : st === "active" ? "•" : ""}</div>
              <span style={{ fontSize: 13.5, fontFamily: "Inter", fontWeight: 500, color: st === "wait" ? C.dim : C.txt }}>{label}</span>
              {st === "active" && <span style={{ marginLeft: "auto", fontSize: 11, color: C.purple, fontFamily: "Inter" }}>measuring…</span>}
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 11.5, color: C.dim, fontFamily: "Inter", lineHeight: 1.5 }}>
            Thresholds like squat depth and elbow flare are scaled to your limb ratios and mobility — so every body type gets fair, accurate rep counting.
          </div>
        </Glass>
      </div>
    </div>
  );
}

// ---------- REST ----------
function RestScreen() {
  const [s, setS] = useState(38);
  useEffect(() => {
    const id = setInterval(() => setS(v => (v <= 1 ? 38 : v - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const pct = s / 45;
  const R = 74, circ = 2 * Math.PI * R;
  return (
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg,#0c1f19,${C.bg})` }}>
      <div style={{ position: "absolute", top: 26, left: 0, right: 0, textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: C.mint, fontWeight: 700, fontFamily: "Inter" }}>REST</div>
        <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 20, color: C.txt, marginTop: 4 }}>Set 2 complete</div>
      </div>
      <div style={{ position: "absolute", top: 92, left: 0, right: 0, display: "grid", placeItems: "center" }}>
        <svg width="180" height="180">
          <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
          <circle cx="90" cy="90" r={R} fill="none" stroke={C.mint} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
            transform="rotate(-90 90 90)" style={{ transition: "stroke-dashoffset 1s linear", filter: `drop-shadow(0 0 8px ${C.mint})` }} />
          <text x="90" y="86" textAnchor="middle" fontSize="44" fontWeight="700" fill={C.txt} fontFamily="'Space Grotesk'">{s}</text>
          <text x="90" y="110" textAnchor="middle" fontSize="12" fill="rgba(244,251,248,0.55)" fontFamily="Inter">seconds</text>
        </svg>
      </div>
      <div style={{ position: "absolute", top: 290, left: 14, right: 14 }}>
        <Glass style={{ padding: 14, borderRadius: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.6, color: C.purple, fontWeight: 700, fontFamily: "Inter" }}>LAST SET · AI READ</div>
          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
            {[["12", "reps"], ["10", "clean"], ["94", "form"], ["3.1s", "tempo"]].map(([v, l], i) => (
              <div key={i}>
                <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 20, color: C.txt }}>{v}</div>
                <div style={{ fontSize: 10, color: C.dim, fontFamily: "Inter" }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: C.txt, fontFamily: "Inter", lineHeight: 1.5 }}>
            🎧 “Two reps ran shallow near the end. Try 5% less weight on the next set and own the bottom position.”
          </div>
        </Glass>
      </div>
      <div style={{ position: "absolute", bottom: 14, left: 14, right: 14, display: "flex", gap: 8 }}>
        <Glass style={{ flex: 1, padding: "13px 0", textAlign: "center", borderRadius: 16, fontFamily: "Inter", fontWeight: 600, fontSize: 13, color: C.dim }}>+30s</Glass>
        <div style={{
          flex: 2, padding: "13px 0", textAlign: "center", borderRadius: 16, fontFamily: "Inter",
          fontWeight: 700, fontSize: 13, color: "#04211a", background: C.mint, boxShadow: `0 6px 22px rgba(45,212,167,0.35)`,
        }}>Start set 3 →</div>
      </div>
    </div>
  );
}

// ---------- SUMMARY ----------
function SummaryScreen() {
  const issues = [
    ["Shallow depth", 4, C.orange],
    ["Forward knee drift", 2, C.orange],
    ["Torso lean", 1, C.red],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg,#0c1f19 0%,${C.bg} 40%)`, overflowY: "auto", padding: "22px 14px 16px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: C.gold, fontWeight: 700, fontFamily: "Inter" }}>SESSION COMPLETE</div>
        <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22, color: C.txt, marginTop: 4 }}>Leg Day · AI Tracked</div>
      </div>

      <Glass style={{ marginTop: 16, padding: 16, borderRadius: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", width: 84, height: 84, flexShrink: 0 }}>
          <svg width="84" height="84">
            <circle cx="42" cy="42" r="35" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle cx="42" cy="42" r="35" fill="none" stroke={C.mint} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 35} strokeDashoffset={2 * Math.PI * 35 * 0.09}
              transform="rotate(-90 42 42)" style={{ filter: `drop-shadow(0 0 6px ${C.mint})` }} />
            <text x="42" y="48" textAnchor="middle" fontSize="22" fontWeight="700" fill={C.txt} fontFamily="'Space Grotesk'">91</text>
          </svg>
        </div>
        <div>
          <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 16, color: C.txt }}>Form score 91 / 100</div>
          <div style={{ fontSize: 12, color: C.dim, fontFamily: "Inter", marginTop: 3, lineHeight: 1.5 }}>
            42 of 47 reps counted clean — a personal trainer would charge ₹1,500 for this session. Your AI coach caught it all.
          </div>
        </div>
      </Glass>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {[["47", "total reps"], ["42", "clean"], ["386", "kcal"], ["41m", "time"]].map(([v, l], i) => (
          <Glass key={i} style={{ flex: 1, padding: "12px 4px", textAlign: "center", borderRadius: 16 }}>
            <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 18, color: i === 2 ? C.orange : C.txt }}>{v}</div>
            <div style={{ fontSize: 9.5, color: C.dim, fontFamily: "Inter" }}>{l}</div>
          </Glass>
        ))}
      </div>

      <Glass style={{ marginTop: 10, padding: 14, borderRadius: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.6, color: C.orange, fontWeight: 700, fontFamily: "Inter", marginBottom: 8 }}>FORM ISSUES CAUGHT</div>
        {issues.map(([n, c, col], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: col }} />
            <span style={{ fontSize: 13, fontFamily: "Inter", fontWeight: 500, color: C.txt }}>{n}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: C.dim, fontFamily: "Inter" }}>{c}× · voice-corrected live</span>
          </div>
        ))}
      </Glass>

      <Glass style={{ marginTop: 10, padding: 14, borderRadius: 20, border: "1px solid rgba(139,92,246,0.4)" }}>
        <div style={{ fontSize: 10, letterSpacing: 1.6, color: C.purple, fontWeight: 700, fontFamily: "Inter" }}>COACH NOTE FOR NEXT SESSION</div>
        <div style={{ fontSize: 13, color: C.txt, fontFamily: "Inter", lineHeight: 1.6, marginTop: 6 }}>
          Depth fades after rep 9 — fatigue, not mobility. Next leg day starts you at 62.5 kg with a 3-1-1 tempo cue on.
        </div>
      </Glass>

      <div style={{
        marginTop: 12, padding: "13px 0", textAlign: "center", borderRadius: 16, fontFamily: "Inter",
        fontWeight: 700, fontSize: 13, color: "#04211a", background: C.mint, boxShadow: `0 6px 22px rgba(45,212,167,0.35)`,
      }}>Save to Workout Log</div>
    </div>
  );
}

// ---------- APP SHELL ----------
export default function NexRepAITrainer() {
  const [screen, setScreen] = useState("live");
  const screens = { calibrate: <CalibrateScreen />, live: <LiveScreen />, rest: <RestScreen />, summary: <SummaryScreen /> };
  const labels = [["calibrate", "1 · Calibrate"], ["live", "2 · Live AI"], ["rest", "3 · Rest"], ["summary", "4 · Summary"]];

  return (
    <div style={{
      minHeight: "100vh", background: "#050B09", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24, gap: 18, fontFamily: "Inter,sans-serif",
    }}>
      <div dangerouslySetInnerHTML={{ __html: font }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 20, color: C.txt }}>
          NexRep <span style={{ color: C.mint }}>AI Trainer</span>
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Track. Train. Transform. — now with eyes.</div>
      </div>

      {/* phone */}
      <div style={{
        width: 330, height: 660, borderRadius: 44, position: "relative", overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.14)", background: C.bg,
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 8px #0d1512, 0 0 90px rgba(45,212,167,0.08)",
      }}>
        <div style={{
          position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 92, height: 22,
          borderRadius: 12, background: "#000", zIndex: 50, border: "1px solid rgba(255,255,255,0.06)",
        }} />
        {screens[screen]}
      </div>

      {/* demo nav */}
      <div style={{ display: "flex", gap: 8 }}>
        {labels.map(([k, l]) => (
          <button key={k} onClick={() => setScreen(k)} style={{
            padding: "9px 14px", borderRadius: 12, cursor: "pointer", fontSize: 12, fontWeight: 600,
            fontFamily: "Inter", border: `1px solid ${screen === k ? C.mint : C.line}`,
            background: screen === k ? "rgba(45,212,167,0.14)" : "transparent",
            color: screen === k ? C.mint : C.dim,
          }}>{l}</button>
        ))}
      </div>
    </div>
  );
}
