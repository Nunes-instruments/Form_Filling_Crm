"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import Link from "next/link";
import { ArrowLeft,ExternalLink,RefreshCw } from "lucide-react";
import { clearDataCache,companyFetch,getModuleStatus,moduleUrl } from "@/lib/data";

const PORTS={order_forms:8770,service_operations:5055} as const;
const SERVICE_READY_KEY="nunes:module-ready:service_operations";
function isOfficeHost(host:string){return host==="localhost"||host==="127.0.0.1"||host.startsWith("10.")||host.startsWith("192.168.")||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)||!host.includes(".")}
function directOfficeUrl(key:keyof typeof PORTS){if(typeof window==="undefined"||!isOfficeHost(window.location.hostname))return "";const path=key==="service_operations"?"/jobs/new":"/";return `${window.location.protocol}//${window.location.hostname}:${PORTS[key]}${path}`}
function recentlyReady(key:string){
 if(typeof window==="undefined"||key!=="service_operations")return false;
 try{const ts=Number(localStorage.getItem(SERVICE_READY_KEY)||0);return ts>0&&Date.now()-ts<60000}catch{return false}
}
function markServiceReady(ready:boolean){try{if(ready)localStorage.setItem(SERVICE_READY_KEY,String(Date.now()));else localStorage.removeItem(SERVICE_READY_KEY)}catch{}}

export default function ModuleWorkspace({kind}:{kind:"purchasing"|"servicing"}){
 const key=kind==="purchasing"?"order_forms":"service_operations";const storageKey=`nunes:module-url:${key}`;
 const initial=useMemo(()=>{if(typeof window==="undefined")return "";return directOfficeUrl(key)||localStorage.getItem(storageKey)||sessionStorage.getItem(storageKey)||""},[key,storageKey]);
 const [url,setUrl]=useState(initial);const [msg,setMsg]=useState("Preparing work area…");const [ready,setReady]=useState(()=>Boolean(initial&&recentlyReady(key)));const [frameKey,setFrameKey]=useState(0);const stopped=useRef(false);
 useEffect(()=>{stopped.current=false;let timer:number|undefined;let attempts=0;const persist=(u:string)=>{if(!u)return;try{sessionStorage.setItem(storageKey,u);localStorage.setItem(storageKey,u)}catch{};setUrl(u)};
  const check=async()=>{if(stopped.current)return;attempts++;try{clearDataCache(`/api/data/modules/${key}`);const m=await getModuleStatus(key).catch(()=>null as any);if(m){const u=moduleUrl(m)||directOfficeUrl(key);
      // Always refresh the embedded target from the live module registry. Older builds
      // could leave /settings or / behind in browser storage, making the Forms page open
      // the wrong Servicing screen even though the service itself was healthy.
      if(u)persist(u);
      if(m.ready||m.public_url){if(key==="service_operations")markServiceReady(true);setReady(true);setMsg("");return}if(key==="service_operations")markServiceReady(false);if(m.__offline){setReady(false);setMsg("Company data is not connected.");return}}setReady(false);setMsg(kind==="servicing"?"Starting Servicing…":"Starting Purchasing…");if(attempts===1||attempts===8||attempts===22)void companyFetch(`/api/data/modules/${key}/start`,{method:"POST",cache:"no-store",keepalive:true}).catch(()=>null)}catch{setMsg("Starting work area…")}if(!stopped.current)timer=window.setTimeout(check,attempts<24?200:600)};
  // The global prewarmer keeps a fresh Servicing readiness stamp. When it is fresh,
  // the already-warm iframe is visible immediately; this check then verifies it in
  // the background and falls back to the existing starter if the engine stopped.
  void companyFetch(`/api/data/modules/${key}/start`,{method:"POST",cache:"no-store",keepalive:true}).catch(()=>null);void check();return()=>{stopped.current=true;if(timer)window.clearTimeout(timer)}
 },[key,kind,storageKey]);
 const reload=()=>{try{sessionStorage.removeItem(storageKey);localStorage.removeItem(storageKey);if(key==="service_operations")localStorage.removeItem(SERVICE_READY_KEY)}catch{};const u=directOfficeUrl(key);setUrl(u);setReady(false);setMsg("Restarting work area…");setFrameKey(x=>x+1);void companyFetch(`/api/data/modules/${key}/start`,{method:"POST",cache:"no-store"}).catch(()=>null)};
 const title=kind==="purchasing"?"Purchasing Form":"Servicing Form";
 return <div className="module-shell"><div className="module-head"><Link href="/forms" className="btn"><ArrowLeft/>Forms</Link><div className="grow"><b>{title}</b><span>{ready?"Ready":msg}</span></div><button className="btn" onClick={reload}><RefreshCw/>Reload</button>{url&&<a className="btn" href={url} target="_blank" rel="noreferrer"><ExternalLink/>Open full screen</a>}</div><div className="module-frame-wrap">{url&&<iframe key={frameKey} className="module-frame" src={url} title={title} style={ready?undefined:{visibility:"hidden"}}/>}{!ready&&<div className="module-start-overlay static"><div className="spinner"/><b>{msg||"Starting…"}</b><p>The form is loading in parallel and will appear as soon as the resident is ready.</p></div>}</div></div>
}
