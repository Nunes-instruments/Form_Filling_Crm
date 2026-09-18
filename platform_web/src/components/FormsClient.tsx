"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {ArrowRight,CheckCircle2,ClipboardList,Clock3,Wrench} from "lucide-react";
import {clearDataCache,companyFetch,getModules,getOverview,getTasks,moduleUrl} from "@/lib/data";
import {MODULE_REGISTRY} from "@/lib/module-registry";

export default function FormsClient(){
 const [overview,setOverview]=useState<any>(null);const [tasks,setTasks]=useState<any>(null);const [modules,setModules]=useState<any>({});
 useEffect(()=>{
  let alive=true; let timer:number|undefined;
  // Status is intentionally loaded independently from report/task data. A slower
  // report query must never make a ready Servicing engine look like it is starting.
  const refreshModules=async()=>{try{clearDataCache("/api/data/modules");const m=await getModules();if(!alive)return;setModules(m);for(const k of ["service_operations","order_forms"]){const x=m?.[k];if(x?.ready||x?.public_url){const u=moduleUrl(x);if(u)sessionStorage.setItem(`nunes:module-url:${k}`,u)}}const allReady=Boolean(m?.service_operations?.ready&&m?.order_forms?.ready);if(!allReady)timer=window.setTimeout(refreshModules,220)}catch{if(alive)timer=window.setTimeout(refreshModules,350)}};
  // Idempotent warm requests. In V6.4.6 Servicing is already started before the
  // workspace becomes visible, so this is only a repair fallback.
  companyFetch("/api/data/modules/service_operations/start",{method:"POST",cache:"no-store"}).catch(()=>{});
  const purchaseWarm=window.setTimeout(()=>companyFetch("/api/data/modules/order_forms/start",{method:"POST",cache:"no-store"}).catch(()=>{}),4000);
  refreshModules();
  Promise.all([getOverview(),getTasks()]).then(([o,t])=>{if(alive){setOverview(o);setTasks(t)}}).catch(()=>{});
  const visible=()=>{if(document.visibilityState==="visible")refreshModules()};document.addEventListener("visibilitychange",visible);
  return()=>{alive=false;if(timer)window.clearTimeout(timer);window.clearTimeout(purchaseWarm);document.removeEventListener("visibilitychange",visible)};
 },[]);
 const bulkUrl=typeof window==="undefined"?"#":`${window.location.protocol}//${window.location.hostname}:5055/legacy-import`; // V2_6_BULK_ENTRY
 const card=(id:"purchasing"|"servicing")=>{const mod=MODULE_REGISTRY.find(x=>x.id===id)!;const service=id==="servicing";const rows=service?(tasks?.servicing||[]): (tasks?.purchasing||[]);const completed=service?0:(overview?.forms?.completed_orders||0);const state=modules?.[mod.engineKey];const ready=state?.ready;const starting=state?.starting;return <article className={`application-card ${service?"service":""}`} key={id}><div className="app-card-top"><div className="application-icon">{service?<Wrench/>:<ClipboardList/>}</div><span className={`engine-state ${ready?"ready":starting?"preparing":"idle"}`}><i/>{ready?"Ready now":starting?"Preparing in background":"Auto ready"}</span></div><div className="app-card-body"><span className="module-kicker">{mod.name}</span><h2>{mod.name} Form</h2><p>{mod.description}</p><div className="application-stats"><div><b>{rows.length}</b><span>Active</span></div><div><b>{rows.filter((x:any)=>x.waiting_hours>=12).length}</b><span>Waiting</span></div><div><b>{rows.filter((x:any)=>x.needs_attention).length}</b><span>Attention</span></div><div><b>{completed}</b><span>{service?"Saved jobs":"Completed"}</span></div></div><div className="workflow-preview">{mod.workflow.map((x,i)=><span key={x}>{i+1}<b>{x}</b></span>)}</div></div><div className="app-card-footer"><Link href={mod.route} className={`btn primary ${service?"service-button":""}`}>Open {mod.name} <ArrowRight/></Link><Link href={`/tasks?source=${id}`} className="btn"><Clock3/>Work queue</Link><Link href={`/reports?source=${id}`} className="btn"><CheckCircle2/>Reports</Link></div></article>};
 return <main className="page"><div className="page-head"><div><div className="eyebrow">Forms</div><h1>Choose the process you want to work on</h1><p>Open the required work area. Each process keeps its own workflow and business logic.</p></div></div><div className="forms-grid premium">{card("purchasing")}{card("servicing")}</div><section className="legacy-import-entry"><div><b>Bulk Old Service Forms</b><span>One-time migration: choose one folder containing old Service Forms + proof files. Duplicate-safe and no customer messages are sent during migration.</span></div><a className="btn primary" href={bulkUrl} target="_blank" rel="noreferrer">Open Bulk Import</a></section></main>
}
