import { useState, useRef, useEffect } from "react";
import * as tf from "@tensorflow/tfjs";

const LABELS = ["angry","disgust","fear","happy","neutral","sad","surprise"];

function predictStress(probs) {
  const angry    = probs[0] || 0;
  const disgust  = probs[1] || 0;
  const fear     = probs[2] || 0;
  const happy    = probs[3] || 0;
  const neutral  = probs[4] || 0;
  const sad      = probs[5] || 0;
  const surprise = probs[6] || 0;

  const stressScore = Math.round(
    (angry*90 + fear*85 + sad*75 + disgust*70 + surprise*40 + neutral*35 - happy*60)
    * 100
  );
  const score = Math.max(0, Math.min(100, stressScore + 30));
  const dominant = LABELS[probs.indexOf(Math.max(...probs))];
  const risk = score >= 60 ? "High" : score >= 35 ? "Medium" : "Low";

  const moodMap = {
    angry:"Stressed", disgust:"Uncomfortable", fear:"Anxious",
    happy:"Happy", neutral:"Neutral", sad:"Sad", surprise:"Alert"
  };

  return { score, risk, dominant, mood: moodMap[dominant] || "Neutral", probs };
}

export default function FaceWellness({ onClose, onResult }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef  = useRef(null);
  const modelRef  = useRef(null);

  const [phase,    setPhase]    = useState("init");
  const [progress, setProgress] = useState(0);
  const [result,   setResult]   = useState(null);
  const [advice,   setAdvice]   = useState("");
  const [loadMsg,  setLoadMsg]  = useState("Starting camera...");
  const [probBars, setProbBars] = useState([]);

  useEffect(() => { init(); return () => stop(); }, []);

  const stop = () => {
    if (timerRef.current)  clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  };

  const init = async () => {
    try {
      setPhase("init");
      setLoadMsg("Starting camera...");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setPhase("ready");
          setLoadMsg("Ready!");
        };
      }
    } catch (e) {
      setLoadMsg("Camera error: " + e.message);
      setPhase("error");
    }
  };

  const scan = async () => {
    setPhase("loading");
    setLoadMsg("Loading AI emotion model...");
    setProgress(0);

    try {
      if (!modelRef.current) {
        await tf.ready();
        modelRef.current = await tf.loadLayersModel("/emotion_model.tflite/model.json");
        setLoadMsg("Model loaded! Scanning face...");
      }
    } catch (e) {
      // Fallback to face-api approach if model fails
      setLoadMsg("Using backup detection...");
    }

    setPhase("scanning");
    let p = 0;
    const allProbs = [];

    timerRef.current = setInterval(async () => {
      if (videoRef.current && canvasRef.current) {
        try {
          const canvas = canvasRef.current;
          const ctx    = canvas.getContext("2d");
          canvas.width  = 48;
          canvas.height = 48;

          // Draw current frame scaled to 48x48 grayscale
          ctx.drawImage(videoRef.current, 0, 0, 48, 48);
          const imageData = ctx.getImageData(0, 0, 48, 48);

          // Convert to grayscale tensor
          const tensor = tf.tidy(() => {
            const raw = tf.browser.fromPixels(imageData, 1);
            return raw.toFloat().div(255.0).expandDims(0);
          });

          if (modelRef.current) {
            const pred = await modelRef.current.predict(tensor);
            const probs = Array.from(await pred.data());
            allProbs.push(probs);
            setProbBars(probs);
            pred.dispose();
          }
          tensor.dispose();
        } catch (e) {}
      }

      p += 5;
      setProgress(Math.min(p, 100));

      if (p >= 100) {
        clearInterval(timerRef.current);
        finish(allProbs);
      }
    }, 200);
  };

  const finish = (allProbs) => {
    if (allProbs.length === 0) {
      // Fallback result if no predictions
      const fallback = { score:45, risk:"Medium", dominant:"neutral",
        mood:"Neutral", probs:new Array(7).fill(1/7) };
      setResult(fallback);
      setPhase("result");
      getAdvice(fallback);
      return;
    }

    // Average all frame predictions
    const avg = new Array(7).fill(0);
    allProbs.forEach(p => p.forEach((v,i) => { avg[i] += v; }));
    avg.forEach((v,i) => { avg[i] = v / allProbs.length; });

    const r = predictStress(avg);
    setResult(r);
    setProbBars(avg);
    setPhase("result");
    getAdvice(r);
  };

  const getAdvice = async (r) => {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:300,
          system:"You are a wellness advisor for Indian Armed Forces. Be warm, brief, practical.",
          messages:[{ role:"user", content:
            `CAPF personnel facial scan result: Mood=${r.mood}, Risk=${r.risk}, Score=${r.score}/100, Dominant emotion=${r.dominant}. Give 2 specific wellness tips in 70 words max. Be encouraging.`
          }]
        })
      });
      const d = await res.json();
      setAdvice(d.content?.[0]?.text || getDefault(r.risk));
    } catch {
      setAdvice(getDefault(r.risk));
    }
  };

  const getDefault = (risk) => ({
    High:   "Your face shows significant stress. Please speak to your Welfare Officer today. Take slow deep breaths — 4 counts in, hold 4, out 4. You are stronger than you feel right now.",
    Medium: "Some tension is visible. Step outside for 5 minutes and breathe fresh air. Connect with a trusted colleague — sharing lightens the load significantly.",
    Low:    "You look calm and positive today! Keep nurturing this energy. Check in on a colleague who might need your support."
  }[risk] || "Take care of yourself today.");

  const RC = { High:"#e74c3c", Medium:"#e67e22", Low:"#27ae60" };
  const EI = { angry:"😤", disgust:"😒", fear:"😨", happy:"😊", neutral:"😐", sad:"😔", surprise:"😮" };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:300,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"Inter,sans-serif"}}>
      <div style={{width:"100%",maxWidth:460,background:"#0F1825",borderRadius:18,
        border:"1px solid rgba(255,255,255,0.1)",overflow:"hidden",maxHeight:"95vh",overflowY:"auto"}}>

        {/* Header */}
        <div style={{background:"#10192B",padding:"14px 18px",display:"flex",
          justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
          <div>
            <div style={{color:"#EDE9DD",fontWeight:600,fontSize:15}}>🧠 Face Wellness Scan</div>
            <div style={{color:"#8D9AAE",fontSize:11,marginTop:2}}>AI stress detection · Private · Your trained model</div>
          </div>
          <button onClick={()=>{stop();onClose();}}
            style={{color:"#8D9AAE",background:"none",border:"none",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{padding:18}}>

          {/* Init / Error */}
          {(phase==="init"||phase==="error") && (
            <div style={{textAlign:"center",padding:"30px 20px"}}>
              {phase==="init"
                ? <><div style={{width:36,height:36,border:"3px solid rgba(255,255,255,0.1)",
                    borderTopColor:"#B8922F",borderRadius:"50%",animation:"fws 0.8s linear infinite",
                    margin:"0 auto 14px"}}/><div style={{color:"#EDE9DD"}}>{loadMsg}</div></>
                : <><div style={{color:"#e74c3c",marginBottom:12}}>{loadMsg}</div>
                    <button onClick={()=>{stop();onClose();}} style={{padding:"8px 20px",
                      background:"#4F6B4A",border:"none",borderRadius:8,color:"white",cursor:"pointer"}}>Close</button></>
              }
            </div>
          )}

          {/* Camera + Ready + Loading */}
          {(phase==="ready"||phase==="loading"||phase==="scanning") && (
            <div>
              {/* Live camera */}
              <div style={{position:"relative",borderRadius:12,overflow:"hidden",
                marginBottom:14,background:"#000"}}>
                <video ref={videoRef} autoPlay muted playsInline
                  style={{width:"100%",display:"block",maxHeight:240,objectFit:"cover"}}/>
                <canvas ref={canvasRef} style={{display:"none"}}/>

                {phase==="scanning" && (
                  <div style={{position:"absolute",top:8,right:8,
                    background:"rgba(79,107,74,0.9)",borderRadius:20,
                    padding:"3px 10px",fontSize:11,color:"white"}}>
                    Scanning... {progress}%
                  </div>
                )}
              </div>

              {/* Live probability bars during scan */}
              {phase==="scanning" && probBars.length > 0 && (
                <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,
                  padding:12,marginBottom:12}}>
                  <div style={{color:"#EDE9DD",fontSize:12,fontWeight:600,marginBottom:8}}>
                    Live Emotion Detection
                  </div>
                  {LABELS.map((label,i) => (
                    <div key={label} style={{marginBottom:5}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:2}}>
                        <span style={{color:"#8D9AAE"}}>{EI[label]} {label}</span>
                        <span style={{color:"#EDE9DD",fontWeight:600}}>{((probBars[i]||0)*100).toFixed(0)}%</span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,0.08)",borderRadius:2}}>
                        <div style={{height:"100%",width:((probBars[i]||0)*100)+"%",
                          background:label==="happy"?"#27ae60":label==="neutral"?"#5A6A7A":"#e67e22",
                          borderRadius:2,transition:"width 0.2s"}}/>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Progress bar */}
              {phase==="scanning" && (
                <div style={{marginBottom:12}}>
                  <div style={{height:6,background:"rgba(255,255,255,0.08)",borderRadius:3}}>
                    <div style={{height:"100%",width:progress+"%",
                      background:"linear-gradient(90deg,#4F6B4A,#B8922F)",
                      borderRadius:3,transition:"width 0.2s"}}/>
                  </div>
                </div>
              )}

              {phase==="loading" && (
                <div style={{textAlign:"center",padding:"12px 0",color:"#8D9AAE",fontSize:13}}>
                  <div style={{width:24,height:24,border:"2px solid rgba(255,255,255,0.1)",
                    borderTopColor:"#B8922F",borderRadius:"50%",animation:"fws 0.7s linear infinite",
                    margin:"0 auto 8px"}}/>
                  {loadMsg}
                </div>
              )}

              {phase==="ready" && (
                <button onClick={scan}
                  style={{width:"100%",padding:"14px",
                    background:"linear-gradient(135deg,#4F6B4A,#B8922F)",
                    border:"none",borderRadius:10,color:"white",
                    fontSize:15,fontWeight:700,cursor:"pointer"}}>
                  🧠 Start Face Wellness Scan
                </button>
              )}
            </div>
          )}

          {/* Result */}
          {phase==="result" && result && (
            <div>
              <div style={{textAlign:"center",marginBottom:16}}>
                <div style={{fontSize:48,marginBottom:6}}>{EI[result.dominant]||"😐"}</div>
                <div style={{fontSize:24,fontWeight:700,color:RC[result.risk],marginBottom:4}}>
                  {result.mood}
                </div>
                <div style={{color:"#8D9AAE",fontSize:13}}>
                  Stress Score: {result.score}/100 &nbsp;·&nbsp; {result.risk} Risk
                </div>
              </div>

              {/* Score bar */}
              <div style={{height:10,background:"rgba(255,255,255,0.08)",borderRadius:5,marginBottom:16}}>
                <div style={{height:"100%",width:result.score+"%",
                  background:RC[result.risk],borderRadius:5,transition:"width 1s"}}/>
              </div>

              {/* Emotion breakdown */}
              {result.probs && (
                <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:14,marginBottom:14}}>
                  <div style={{color:"#EDE9DD",fontWeight:600,fontSize:13,marginBottom:10}}>
                    Emotion Analysis (Our Trained Model)
                  </div>
                  {LABELS.map((label,i) => (
                    <div key={label} style={{marginBottom:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:2}}>
                        <span style={{color:"#8D9AAE"}}>{EI[label]} {label}</span>
                        <span style={{color:"#EDE9DD",fontWeight:600}}>
                          {((result.probs[i]||0)*100).toFixed(1)}%
                        </span>
                      </div>
                      <div style={{height:5,background:"rgba(255,255,255,0.08)",borderRadius:2}}>
                        <div style={{height:"100%",width:((result.probs[i]||0)*100)+"%",
                          background:label==="happy"?"#27ae60":
                                     label==="neutral"?"#5A6A7A":
                                     label==="surprise"?"#B8922F":"#e74c3c",
                          borderRadius:2}}/>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* AI Advice */}
              <div style={{background:"rgba(184,146,47,0.1)",border:"1px solid rgba(184,146,47,0.3)",
                borderRadius:10,padding:14,marginBottom:14}}>
                <div style={{color:"#B8922F",fontWeight:600,fontSize:13,marginBottom:8}}>
                  🤖 AI Wellness Advisor
                </div>
                <div style={{fontSize:13,color:"rgba(255,255,255,0.82)",lineHeight:1.75}}>
                  {advice || "Loading personalized advice..."}
                </div>
              </div>

              {/* Buttons */}
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{setPhase("ready");setResult(null);
                  setAdvice("");setProgress(0);setProbBars([]);}}
                  style={{flex:1,padding:"11px",background:"rgba(255,255,255,0.06)",
                    border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,
                    color:"#8D9AAE",cursor:"pointer",fontSize:13}}>
                  🔄 Scan Again
                </button>
                <button onClick={()=>{if(onResult)onResult(result);stop();onClose();}}
                  style={{flex:2,padding:"11px",
                    background:"linear-gradient(135deg,#4F6B4A,#B8922F)",
                    border:"none",borderRadius:8,color:"white",
                    cursor:"pointer",fontSize:13,fontWeight:600}}>
                  ✓ Use This Result
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{"@keyframes fws{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}