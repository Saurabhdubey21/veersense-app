import { useState, useEffect, useRef } from "react";
import * as faceapi from "face-api.js";

function expressionsToStress(expr) {
  if (!expr) return { score: 50, mood: "Neutral", risk: "Medium", dominant: "neutral" };
  const { happy=0,sad=0,angry=0,fearful=0,disgusted=0,surprised=0,neutral=0 } = expr;
  const stressRaw = sad*70+angry*85+fearful*80+disgusted*65+surprised*30+neutral*40-happy*60;
  const score = Math.max(0, Math.min(100, Math.round(50 + stressRaw * 50)));
  const emotions = { happy,sad,angry,fearful,disgusted,surprised,neutral };
  const dominant = Object.entries(emotions).sort((a,b)=>b[1]-a[1])[0][0];
  const moodMap = { happy:"Happy",sad:"Sad",angry:"Stressed",fearful:"Anxious",disgusted:"Uncomfortable",surprised:"Alert",neutral:"Neutral" };
  const risk = score>=60?"High":score>=35?"Medium":"Low";
  return { score, mood: moodMap[dominant]||"Neutral", risk, dominant, expressions: expr };
}

export default function FaceWellness({ onClose, onResult }) {
  const videoRef=useRef(null), canvasRef=useRef(null), streamRef=useRef(null), intervalRef=useRef(null);
  const [phase,setPhase]=useState("loading");
  const [loadMsg,setLoadMsg]=useState("Loading face detection AI...");
  const [scanProgress,setScan]=useState(0);
  const [expressions,setExpr]=useState(null);
  const [wellness,setWellness]=useState(null);
  const [aiAdvice,setAiAdvice]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [faceDetected,setFaceDetected]=useState(false);

  useEffect(()=>{ loadModels(); return ()=>cleanup(); },[]);

  const cleanup=()=>{
    if(intervalRef.current) clearInterval(intervalRef.current);
    if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
  };

  const loadModels=async()=>{
    try {
      setLoadMsg("Loading expression models...");
      const MODEL_URL="https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      ]);
      setLoadMsg("Starting camera...");
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:"user"}});
      streamRef.current=stream;
      if(videoRef.current){ videoRef.current.srcObject=stream; try{ await videoRef.current.play(); }catch(e){} }
      setTimeout(()=>setPhase("ready"),1000);
    } catch(err){ setLoadMsg("Error: "+(err.message||"Camera error")); setPhase("error"); }
  };

  const startScan=()=>{
    setPhase("scanning"); setScan(0); setFaceDetected(false);
    let progress=0; const frames=[];
    intervalRef.current=setInterval(async()=>{
      if(!videoRef.current) return;
      try {
        const det=await faceapi.detectSingleFace(videoRef.current,new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks(true).withFaceExpressions();
        if(det){ setFaceDetected(true); frames.push(det.expressions); } else { setFaceDetected(false); }
      } catch(e){}
      progress+=4; setScan(Math.min(progress,100));
      if(progress>=100){ clearInterval(intervalRef.current); finishScan(frames); }
    },120);
  };

  const finishScan=(frames)=>{
    if(frames.length===0){ setTimeout(()=>setPhase("ready"),1000); return; }
    const keys=["happy","sad","angry","fearful","disgusted","surprised","neutral"];
    const avg={};
    keys.forEach(k=>{ avg[k]=frames.reduce((s,f)=>s+(f[k]||0),0)/frames.length; });
    const result=expressionsToStress(avg);
    setExpr(avg); setWellness(result); setPhase("result");
    getAIAdvice(result);
  };

  const getAIAdvice=async(result)=>{
    setAiLoading(true);
    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-6",max_tokens:400,
          system:"You are a wellness advisor for Indian Armed Forces. Be warm and brief.",
          messages:[{role:"user",content:"Personnel facial scan: Mood="+result.mood+", Risk="+result.risk+", Score="+result.score+"/100. Give 2 practical wellness tips in 80 words max."}]
        })
      });
      const d=await res.json();
      setAiAdvice(d.content?.[0]?.text||getOffline(result.risk));
    } catch{ setAiAdvice(getOffline(result.risk)); }
    setAiLoading(false);
  };

  const getOffline=(risk)=>risk==="High"?"Please speak to your Welfare Officer today. Take a deep breath - inhale 4 counts, hold 4, exhale 4. You are not alone.":risk==="Medium"?"Step outside for 5 minutes. Fresh air and movement shift your mood significantly. Connect with a colleague.":"You are doing well today. Keep maintaining your healthy habits and check on a colleague.";

  const rc={High:"#C0392B",Medium:"#D4870A",Low:"#4F6B4A"};
  const em={happy:"Mood: Happy",sad:"Mood: Sad",angry:"Mood: Stressed",fearful:"Mood: Anxious",disgusted:"Mood: Uncomfortable",surprised:"Mood: Alert",neutral:"Mood: Neutral"};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(8px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"Inter,sans-serif"}}>
      <div style={{width:"100%",maxWidth:480,background:"#0F1825",borderRadius:20,border:"1px solid rgba(255,255,255,0.1)",overflow:"hidden",maxHeight:"95vh",overflowY:"auto"}}>
        <div style={{background:"#10192B",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontFamily:"Spectral,serif",color:"#EDE9DD",fontWeight:600,fontSize:16}}>Face Wellness Scan</div>
          <button onClick={()=>{cleanup();onClose();}} style={{color:"#8D9AAE",fontSize:20,background:"none",border:"none",cursor:"pointer"}}>X</button>
        </div>
        <div style={{padding:20}}>
          {phase==="loading"&&<div style={{textAlign:"center",padding:"40px 20px"}}><div style={{width:40,height:40,border:"3px solid rgba(255,255,255,0.1)",borderTopColor:"#B8922F",borderRadius:"50%",animation:"fws 0.8s linear infinite",margin:"0 auto 16px"}}/><div style={{color:"#EDE9DD"}}>{loadMsg}</div><div style={{fontSize:11,color:"#8D9AAE",marginTop:8}}>Allow camera access when prompted</div></div>}
          {phase==="error"&&<div style={{textAlign:"center",padding:"40px 20px"}}><div style={{fontSize:40,marginBottom:12}}>Warning</div><div style={{color:"#e74c3c",marginBottom:16}}>{loadMsg}</div><button onClick={()=>{cleanup();onClose();}} style={{padding:"10px 20px",background:"#4F6B4A",border:"none",borderRadius:8,color:"white",cursor:"pointer"}}>Close</button></div>}
          {(phase==="ready"||phase==="scanning")&&(
            <div>
              <div style={{position:"relative",borderRadius:12,overflow:"hidden",marginBottom:16,background:"#000"}}>
                <video ref={videoRef} autoPlay muted playsInline style={{width:"100%",display:"block",transform:"scaleX(-1)",maxHeight:260,objectFit:"cover"}}/>
                <canvas ref={canvasRef} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",transform:"scaleX(-1)"}}/>
                <div style={{position:"absolute",top:8,right:8,background:faceDetected?"rgba(79,107,74,0.9)":"rgba(192,57,43,0.9)",borderRadius:20,padding:"3px 10px",fontSize:11,color:"white"}}>{faceDetected?"Face detected":"Looking..."}</div>
              </div>
              {phase==="scanning"&&<div style={{marginBottom:16}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#8D9AAE",marginBottom:4}}><span>Analyzing...</span><span>{scanProgress}%</span></div><div style={{height:5,background:"rgba(255,255,255,0.08)",borderRadius:3}}><div style={{height:"100%",width:scanProgress+"%",background:"linear-gradient(90deg,#4F6B4A,#B8922F)",borderRadius:3}}/></div></div>}
              {phase==="ready"&&<button onClick={startScan} style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#4F6B4A,#B8922F)",border:"none",borderRadius:10,color:"white",fontSize:15,fontWeight:700,cursor:"pointer"}}>Start Face Wellness Scan</button>}
            </div>
          )}
          {phase==="result"&&wellness&&(
            <div>
              <div style={{textAlign:"center",marginBottom:16}}>
                <div style={{fontFamily:"Spectral,serif",fontSize:24,fontWeight:700,color:rc[wellness.risk]}}>{wellness.mood}</div>
                <div style={{fontSize:13,color:"#8D9AAE"}}>Score: {wellness.score}/100 - {wellness.risk} Risk</div>
              </div>
              <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:4,marginBottom:16}}><div style={{height:"100%",width:wellness.score+"%",background:wellness.score>=60?"#e74c3c":wellness.score>=35?"#e67e22":"#27ae60",borderRadius:4}}/></div>
              {expressions&&<div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:14,marginBottom:14}}><div style={{color:"#EDE9DD",fontWeight:600,fontSize:13,marginBottom:10}}>Expression Breakdown</div>{Object.entries(expressions).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=><div key={k} style={{marginBottom:6}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#8D9AAE",marginBottom:2}}><span>{k}</span><span>{(v*100).toFixed(0)}%</span></div><div style={{height:4,background:"rgba(255,255,255,0.08)",borderRadius:2}}><div style={{height:"100%",width:(v*100)+"%",background:"#4F6B4A",borderRadius:2}}/></div></div>)}</div>}
              <div style={{background:"rgba(184,146,47,0.1)",border:"1px solid rgba(184,146,47,0.3)",borderRadius:10,padding:14,marginBottom:14}}>
                <div style={{color:"#B8922F",fontWeight:600,marginBottom:8}}>AI Wellness Advisor</div>
                {aiLoading?<div style={{color:"#8D9AAE",fontSize:13}}>Analyzing...</div>:<div style={{fontSize:13,color:"rgba(255,255,255,0.8)",lineHeight:1.7}}>{aiAdvice}</div>}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{setTimeout(()=>setPhase("ready"),1000);setWellness(null);setExpr(null);setAiAdvice("");setScan(0);}} style={{flex:1,padding:"11px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,color:"#8D9AAE",cursor:"pointer",fontSize:13}}>Scan Again</button>
                <button onClick={()=>{if(onResult)onResult(wellness);cleanup();onClose();}} style={{flex:2,padding:"11px",background:"linear-gradient(135deg,#4F6B4A,#B8922F)",border:"none",borderRadius:10,color:"white",cursor:"pointer",fontSize:13,fontWeight:600}}>Use This Result</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{"@keyframes fws{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
