"use client";
import {useEffect,useMemo,useState} from "react";
import {useSearchParams} from "next/navigation";
import Link from "next/link";
import {AlertTriangle,ArrowRight,CheckCircle2,Clock3,Search,Trash2,UserRound} from "lucide-react";
import {clearDataCache,companyFetch,getTasks,relativeTime} from "@/lib/data";
import type {TaskItem,TasksPayload} from "@/lib/types";

function taskCompleted(x:TaskItem){
 return Boolean((x as any).completed)||String(x.status||"").toUpperCase()==="CLOSED"||String(x.status||"").toUpperCase()==="DISPATCHED"||String(x.status||"").toLowerCase()==="completed";
}

export default function TasksClient(){
 const params=useSearchParams();
 const initial=params.get("source");
 const [source,setSource]=useState(initial==="purchasing"||initial==="servicing"?initial:"all");
 const [filter,setFilter]=useState<"active"|"waiting"|"attention"|"completed">("active");
 const [q,setQ]=useState("");
 const [data,setData]=useState<TasksPayload|null>(null);
 const [deleting,setDeleting]=useState("");
 const [completing,setCompleting]=useState("");
 const load=(force=false)=>getTasks(force).then(setData);
 useEffect(()=>{load(true);const t=setInterval(()=>load(true),30000);return()=>clearInterval(t)},[]);

 const remove=async(item:TaskItem)=>{
  const key=`${item.source}-${item.id}`;if(deleting||completing)return;
  const label=item.source==="purchasing"?"Purchasing form":"Servicing form";
  const ok=window.confirm(`Delete ${label} ${item.record_no} - ${item.customer}?\n\nUse this only for a wrong/test form. The main server creates a safety backup before deleting.`);
  if(!ok)return;
  setDeleting(key);
  try{
   const r=await companyFetch(`/api/data/records/${item.source}/${encodeURIComponent(String(item.id))}`,{method:"DELETE",headers:{"x-nunes-client":"staff-delete"}});
   let payload:any={};try{payload=await r.json()}catch{}
   if(!r.ok)throw new Error(payload?.error||`Delete failed (${r.status})`);
   clearDataCache();await load(true);
  }catch(e){window.alert(`Could not delete ${item.record_no}.\n${e instanceof Error?e.message:String(e)}`)}
  finally{setDeleting("")}
 };

 const complete=async(item:TaskItem)=>{
  if(item.source!=="servicing"||taskCompleted(item)||deleting||completing)return;
  const key=`${item.source}-${item.id}`;
  const ok=window.confirm(`Mark ${item.record_no} - ${item.customer} as COMPLETED?\n\nUse this only when the service job is actually finished. A recovery backup is created before the status is changed.`);
  if(!ok)return;
  setCompleting(key);
  try{
   const r=await companyFetch(`/api/data/records/servicing/${encodeURIComponent(String(item.id))}/complete`,{method:"POST",headers:{"x-nunes-client":"staff-complete"}});
   let payload:any={};try{payload=await r.json()}catch{}
   if(!r.ok)throw new Error(payload?.error||`Complete failed (${r.status})`);
   clearDataCache();await load(true);setFilter("completed");
  }catch(e){window.alert(`Could not mark ${item.record_no} completed.\n${e instanceof Error?e.message:String(e)}`)}
  finally{setCompleting("")}
 };

 const rows=useMemo(()=>{
  if(!data)return[];
  let a:TaskItem[]=[...(source!=="servicing"?data.purchasing:[]),...(source!=="purchasing"?data.servicing:[])];
  if(filter==="active")a=a.filter(x=>!taskCompleted(x));
  if(filter==="waiting")a=a.filter(x=>!taskCompleted(x)&&x.waiting_hours>=12);
  if(filter==="attention")a=a.filter(x=>!taskCompleted(x)&&x.needs_attention);
  if(filter==="completed")a=a.filter(taskCompleted);
  const s=q.trim().toLowerCase();
  if(s)a=a.filter(x=>JSON.stringify(x).toLowerCase().includes(s));
  return a.sort((a,b)=>filter==="completed"?String(b.updated_at||"").localeCompare(String(a.updated_at||"")):(b.needs_attention?1:0)-(a.needs_attention?1:0)||b.waiting_hours-a.waiting_hours);
 },[data,source,filter,q]);

 if(!data)return <main className="page"><div className="center"><div><div className="spinner"/>Loading work queue…</div></div></main>;

 return <main className="page">
  <div className="page-head"><div><div className="eyebrow">Tasks</div><h1>Work queue</h1><p>Workers can find the exact process waiting for action without searching through reports. Completed work stays available under the Completed tab.</p></div></div>
  <div className="task-summary"><div><Clock3/><span><b>{data.summary.active}</b>Active</span></div><div><Clock3/><span><b>{data.summary.waiting}</b>Waiting 12h+</span></div><div className="danger"><AlertTriangle/><span><b>{data.summary.needs_attention}</b>Needs attention</span></div><div className="good"><CheckCircle2/><span><b>{data.summary.completed_today}</b>Completed today</span></div></div>
  <div className="filter-toolbar"><div className="tabs"><button className={source==="all"?"active":""} onClick={()=>setSource("all")}>All</button><button className={source==="purchasing"?"active":""} onClick={()=>setSource("purchasing")}>Purchasing</button><button className={source==="servicing"?"active":""} onClick={()=>setSource("servicing")}>Servicing</button></div><div className="tabs"><button className={filter==="active"?"active":""} onClick={()=>setFilter("active")}>Active</button><button className={filter==="waiting"?"active":""} onClick={()=>setFilter("waiting")}>Waiting</button><button className={filter==="attention"?"active":""} onClick={()=>setFilter("attention")}>Needs attention</button><button className={filter==="completed"?"active":""} onClick={()=>setFilter("completed")}>Completed</button></div><label className="toolbar-search"><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search task, customer, worker, stage…"/></label></div>
  <div className="task-list">{rows.length?rows.map(x=><TaskCard key={`${x.source}-${x.id}`} item={x} deleting={deleting===`${x.source}-${x.id}`} completing={completing===`${x.source}-${x.id}`} onDelete={remove} onComplete={complete}/>):<div className="empty large-empty"><CheckCircle2/><b>No tasks match this view</b><span>Change the source or status filter.</span></div>}</div>
 </main>
}

function TaskCard({item:x,deleting,completing,onDelete,onComplete}:{item:TaskItem;deleting:boolean;completing:boolean;onDelete:(item:TaskItem)=>void;onComplete:(item:TaskItem)=>void}){
 const completed=taskCompleted(x);
 return <article title="Right-click this form for Delete" onContextMenu={e=>{e.preventDefault();onDelete(x)}} className={`task-card ${completed?"completed":x.needs_attention?"attention":""}`}><div className={`task-source ${x.source}`}>{x.source==="purchasing"?"P":"S"}</div><div className="task-main"><div className="task-title-row"><div><span className="source-badge-wrap"><span className={`source-badge ${x.source}`}>{x.source==="purchasing"?"Purchasing":"Servicing"}</span>{completed?<span className="priority completed">Completed</span>:<span className={`priority ${x.priority.toLowerCase()}`}>{x.priority} priority</span>}</span><h3>{x.record_no} · {x.customer}</h3>{x.product&&<p>{x.product}</p>}</div><div className="task-card-actions">{x.source==="servicing"&&!completed&&<button type="button" className="btn complete-action" disabled={deleting||completing} onClick={()=>onComplete(x)}><CheckCircle2/>{completing?"Completing…":"Mark Completed"}</button>}<button type="button" className="btn danger-action" disabled={deleting||completing} onClick={()=>onDelete(x)}><Trash2/>{deleting?"Deleting…":"Delete"}</button><Link href={x.action_path} className="btn primary">{completed?"View":"Continue"} <ArrowRight/></Link></div></div><div className="task-meta"><div><span>Current step</span><b>{completed?"Completed":x.current_stage}</b></div><div><span>Responsible team</span><b>{completed?"Completed":x.responsible_team||"Not recorded"}</b></div><div><span>Latest recorded person</span><b><UserRound/>{x.assigned_to||"Not recorded"}</b></div><div><span>Last update</span><b>{relativeTime(x.updated_at)}</b></div><div><span>{completed?"Status":"Waiting"}</span><b>{completed?"Completed":`${x.waiting_hours}h`}</b></div></div><div className="task-progress"><div><span>Progress</span><b>{completed?100:x.progress}%</b></div><div className="stage-track"><span className={completed?"complete":x.source==="servicing"?"teal":""} style={{width:`${completed?100:x.progress}%`}}/></div></div></div></article>
}
