"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {CheckCircle2,FileText,Server,Wrench} from "lucide-react";
import {getOverview} from "@/lib/data";
import {MODULE_REGISTRY} from "@/lib/module-registry";

export default function SettingsClient(){
 const [data,setData]=useState<any>(null);
 useEffect(()=>{getOverview(true).then(setData).catch(()=>setData({}))},[]);
 const purchasing=data?.modules?.order_forms;
 const servicing=data?.modules?.service_operations;
 const systemOnline=Boolean(data)&&data?.system?.data_state!=="offline"&&data?.system?.data_state!=="error";
 return <main className="page simple-settings-page">
  <div className="page-head"><div><div className="eyebrow">Settings</div><h1>Settings</h1><p>Simple system status and application access for NUNES Operations.</p></div></div>

  <section className="simple-settings-status">
   <article><span className="simple-settings-icon"><Server/></span><div><span>Company data</span><strong>{systemOnline?"Connected":"Checking"}</strong><p>Main operational data connection.</p></div><CheckCircle2 className={systemOnline?"status-ok":"status-wait"}/></article>
   <article><span className="simple-settings-icon purchasing"><FileText/></span><div><span>Purchasing</span><strong>{purchasing?.ready?"Ready":"Starts when opened"}</strong><p>Purchasing forms and workflow.</p></div><CheckCircle2 className={purchasing?.ready?"status-ok":"status-wait"}/></article>
   <article><span className="simple-settings-icon servicing"><Wrench/></span><div><span>Servicing</span><strong>{servicing?.ready?"Ready":"Starts when opened"}</strong><p>Servicing forms and job records.</p></div><CheckCircle2 className={servicing?.ready?"status-ok":"status-wait"}/></article>
  </section>

  <section className="section simple-settings-section">
   <div className="section-head"><div><h2>Applications</h2><p>Open the form you need. Technical configuration is kept out of this page.</p></div></div>
   <div className="section-body simple-settings-apps">{MODULE_REGISTRY.map(m=>{const state=data?.modules?.[m.engineKey];return <article key={m.id}><div><span>{m.name}</span><p>{m.id==="purchasing"?"Create and manage purchasing forms.":"Create and manage servicing forms."}</p></div><span className={`simple-settings-state ${state?.ready?"ready":"idle"}`}>{state?.ready?"Ready":"Available"}</span><Link className="btn primary" href={m.route}>Open</Link></article>})}</div>
  </section>
 </main>
}
