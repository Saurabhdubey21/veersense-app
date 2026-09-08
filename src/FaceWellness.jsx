import { useState, useRef, useEffect } from "react";
import * as faceapi from "face-api.js";

export default function FaceWellness({ onClose, onResult }) {
  const videoRef = useRef(null);
  const [phase, setPhase] = useState("init");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [advice, setAdvice] = useState("");
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    startCamera();
    return () => stop();
  }, []);

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  };

  const startCamera = async () => {
    try {
      setPhase("camera");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setPhase("ready");
        };
      }
    } catch (e) {
      setPhase("error");
    }
  };

  const scan = async () => {
    setPhase("scanning");
    setProgress(0);

    const MODEL = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL),
      ]);
    } catch (e) {
      setPhase("error");
      return;
    }

    let p = 0;
    const frames = [];
    timerRef.current = setInterval(async () => {
      if (videoRef.current) {
        try {
          const det = await faceapi
            .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
            .withFaceExpressions();
          if (det) frames.push(det.expressions);
        } catch (e) {}
      }
      p += 5;
      setProgress(Math.min(p, 100));
      if (p >= 100) {
        clearInterval(timerRef.current);
        finish(frames);
      }
    }, 150);
  };

  const finish = (frames) => {
    if (frames.length === 0) {
      setPhase("ready");
      return;
    }
    const keys = ["happy","sad","angry","fearful","disgusted","surprised","neutral"];
    const avg = {};
    keys.forEach(k => {
      avg[k] = frames.reduce((s, f) => s + (f[k] || 0), 0) / frames.length;
    });
    const dominant = Object.entries(avg).sort((a,b) => b[1]-a[1])[0][0];
    const stress = Math.max(0, Math.min(100, Math.round(
      50 + (avg.sad*70 + avg.angry*85 + avg.fearful*80 - avg.happy*60) * 50
    )));
    const risk = stress >= 60 ? "High" : stress >= 35 ? "Medium" : "Low";
    const r = { stress, risk, dominant, expressions: avg };
    setResult(r);
    setPhase("result");
    getAdvice(r);
  };

  const getAdvice = async (r) => {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 300,
          system: "You are a wellness advisor for Indian Armed Forces. Be warm and brief.",
          messages: [{ role: "user", content: "Personnel scan: mood=" + r.dominant + ", risk=" + r.risk + ", score=" + r.stress + "/100. Give 2 practical tips in 60 words." }]
        })
      });
      const d = await res.json();
      setAdvice(d.content?.[0]?.text || getDefault(r.risk));
    } catch {
      setAdvice(getDefault(r.risk));
    }
  };

  const getDefault = (risk) => ({
    High: "Please speak to your Welfare Officer today. You are not alone.",
    Medium: "Take a short walk and connect with a colleague. Small steps help.",
    Low: "You are doing well. Keep up your healthy habits."
  }[risk]);

  const C = { High:"#e74c3c", Medium:"#e67e22", Low:"#27ae60" };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{width:"100%",maxWidth:460,background:"#0F1825",borderRadius:16,border:"1px solid rgba(255,255,255,0.1)",overflow:"hidden"}}>

        <div style={{background:"#10192B",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{color:"#EDE9DD",fontWeight:600,fontSize:15}}>Face Wellness Scan</div>
          <button onClick={()=>{stop();onClose();}} style={{color:"#8D9AAE",background:"none",border:"none",fontSize:18,cursor:"pointer"}}>X</button>
        </div>

        <div style={{padding:18}}>

          {phase === "init" && (
            <div style={{textAlign:"center",padding:30,color:"#8D9AAE"}}>Starting camera...</div>
          )}

          {phase === "error" && (
            <div style={{textAlign:"center",padding:30}}>
              <div style={{color:"#e74c3c",marginBottom:12}}>Could not access camera.</div>
              <button onClick={()=>{stop();onClose();}} style={{padding:"8px 20px",background:"#4F6B4A",border:"none",borderRadius:8,color:"white",cursor:"pointer"}}>Close</button>
            </div>
          )}

          {(phase === "camera" || phase === "ready" || phase === "scanning") && (
            <div>
              <video ref={videoRef} autoPlay muted playsInline
                style={{width:"100%",borderRadius:10,marginBottom:12,background:"#000",display:"block"}}/>

              {phase === "ready" && (
                <button onClick={scan}
                  style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#4F6B4A,#B8922F)",border:"none",borderRadius:10,color:"white",fontSize:15,fontWeight:700,cursor:"pointer"}}>
                  Start Scan
                </button>
              )}

              {phase === "scanning" && (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",color:"#8D9AAE",fontSize:12,marginBottom:4}}>
                    <span>Scanning face...</span><span>{progress}%</span>
                  </div>
                  <div style={{height:6,background:"rgba(255,255,255,0.08)",borderRadius:3}}>
                    <div style={{height:"100%",width:progress+"%",background:"linear-gradient(90deg,#4F6B4A,#B8922F)",borderRadius:3,transition:"width 0.15s"}}/>
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === "result" && result && (
            <div>
              <div style={{textAlign:"center",marginBottom:14}}>
                <div style={{fontSize:22,fontWeight:700,color:C[result.risk]}}>{result.dominant.charAt(0).toUpperCase()+result.dominant.slice(1)}</div>
                <div style={{color:"#8D9AAE",fontSize:13}}>Stress: {result.stress}/100 - {result.risk} Risk</div>
              </div>
              <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:4,marginBottom:14}}>
                <div style={{height:"100%",width:result.stress+"%",background:C[result.risk],borderRadius:4}}/>
              </div>
              <div style={{background:"rgba(184,146,47,0.1)",border:"1px solid rgba(184,146,47,0.3)",borderRadius:10,padding:14,marginBottom:14,fontSize:13,color:"rgba(255,255,255,0.8)",lineHeight:1.7}}>
                {advice || "Loading advice..."}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{setPhase("ready");setResult(null);setAdvice("");setProgress(0);}}
                  style={{flex:1,padding:"10px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#8D9AAE",cursor:"pointer"}}>
                  Scan Again
                </button>
                <button onClick={()=>{if(onResult)onResult(result);stop();onClose();}}
                  style={{flex:2,padding:"10px",background:"linear-gradient(135deg,#4F6B4A,#B8922F)",border:"none",borderRadius:8,color:"white",cursor:"pointer",fontWeight:600}}>
                  Use This Result
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
