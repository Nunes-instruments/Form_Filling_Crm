"use client";
import { useEffect,useState } from "react";
import { companyFetch,moduleUrl } from "@/lib/data";

const SERVICE_READY_KEY="nunes:module-ready:service_operations";
function isOfficeHost(host:string){
  return host==="localhost"||host==="127.0.0.1"||host.startsWith("10.")||host.startsWith("192.168.")||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)||!host.includes(".");
}
function directServiceUrl(){
  if(typeof window==="undefined"||!isOfficeHost(window.location.hostname))return "";
  return `${window.location.protocol}//${window.location.hostname}:5055/jobs/new`;
}
function rememberReady(ready:boolean){
  try{
    if(ready)localStorage.setItem(SERVICE_READY_KEY,String(Date.now()));
    else localStorage.removeItem(SERVICE_READY_KEY);
  }catch{}
}

export default function ModulePrewarmer(){
  const [preloadUrl,setPreloadUrl]=useState("");
  const [nonce,setNonce]=useState(0);
  useEffect(()=>{
    let dead=false;
    let readySeen=false;
    let heartbeat:number|undefined;
    const direct=directServiceUrl();
    const start=()=>companyFetch("/api/data/modules/service_operations/start",{method:"POST",cache:"no-store",keepalive:true}).catch(()=>null);
    void start();
    if(direct)setPreloadUrl(direct);

    const probe=async()=>{
      try{
        const r=await companyFetch("/api/data/modules/service_operations",{cache:"no-store"});
        if(!r.ok)return false;
        const m=await r.json();
        if(!m?.ready){rememberReady(false);return false}
        const u=moduleUrl(m)||direct;
        if(u&&!dead){
          try{sessionStorage.setItem("nunes:module-url:service_operations",u);localStorage.setItem("nunes:module-url:service_operations",u)}catch{}
          rememberReady(true);
          setPreloadUrl(u);
          if(!readySeen){readySeen=true;setNonce(n=>n+1)}
        }
        return true;
      }catch{return false}
    };

    const warm=async()=>{
      for(let i=0;i<90&&!dead;i++){
        if(await probe()){
          // Keep a very light readiness heartbeat so a later click can open the already-hot
          // iframe immediately instead of spending another round trip on the critical path.
          heartbeat=window.setInterval(()=>{
            if(document.visibilityState!=="visible")return;
            void probe().then(ok=>{if(!ok)void start()});
          },20000);
          return;
        }
        if(i===8||i===24)void start();
        await new Promise(r=>setTimeout(r,i<20?100:400));
      }
    };
    const id=window.setTimeout(()=>void warm(),0);
    return()=>{dead=true;window.clearTimeout(id);if(heartbeat!==undefined)window.clearInterval(heartbeat)};
  },[]);
  return preloadUrl?<iframe key={nonce} aria-hidden="true" tabIndex={-1} title="Servicing route preloader" src={preloadUrl} style={{position:"fixed",right:0,bottom:0,width:1,height:1,opacity:0,pointerEvents:"none",border:0}}/>:null;
}
