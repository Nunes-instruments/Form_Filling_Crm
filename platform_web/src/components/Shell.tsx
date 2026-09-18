"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, CheckCircle2, ClipboardCheck, FileText, Home, LayoutDashboard, Menu, Search, Settings, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getDataConnectionStatus, getNotifications, searchCompany } from "@/lib/data";
import type { NotificationItem, SearchResult } from "@/lib/types";

const nav=[
 {href:"/",label:"Dashboard",icon:Home},
 {href:"/forms",label:"Forms",icon:FileText},
 {href:"/tasks",label:"Tasks",icon:ClipboardCheck},
 {href:"/reports",label:"Reports",icon:FileText},
 {href:"/activity",label:"Activity",icon:Activity},
 {href:"/team",label:"Team",icon:Users},
 {href:"/settings",label:"Settings",icon:Settings},
];

function SearchBox(){
 const router=useRouter();const [q,setQ]=useState("");const [rows,setRows]=useState<SearchResult[]>([]);const [open,setOpen]=useState(false);const [loading,setLoading]=useState(false);const timer=useRef<any>(null);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const change=(value:string)=>{setQ(value);clearTimeout(timer.current);if(value.trim().length<2){setRows([]);setOpen(false);return}setLoading(true);timer.current=setTimeout(async()=>{try{const r=await searchCompany(value);setRows(r.results||[]);setOpen(true)}finally{setLoading(false)}},220)};
 const go=(r:SearchResult)=>{setOpen(false);setQ("");router.push(`/process/${r.source}/${encodeURIComponent(String(r.id))}`)};
 return <div className="global-search"><Search/><input value={q} onChange={e=>change(e.target.value)} onFocus={()=>rows.length&&setOpen(true)} placeholder="Search order, service job, customer, product, worker…" aria-label="Search company records"/><kbd>Ctrl K</kbd>{loading&&<span className="search-loader"/>}{open&&<div className="search-popover">{rows.length?rows.slice(0,10).map((r,i)=><button key={`${r.source}-${r.id}-${i}`} onClick={()=>go(r)}><span className={`source-mark ${r.source}`}>{r.source==="purchasing"?"P":"S"}</span><span className="search-copy"><b>{r.record_no} · {r.title}</b><small>{r.source==="purchasing"?"Purchasing":"Servicing"} · {r.stage} · {r.subtitle}</small></span><span className="search-status">{r.status}</span></button>):<div className="empty compact">No matching company records.</div>}</div>}</div>
}

function NotificationCenter(){
 const [open,setOpen]=useState(false);const [items,setItems]=useState<NotificationItem[]>([]);const [loaded,setLoaded]=useState(false);
 const load=()=>getNotifications().then(r=>{setItems(r.items||[]);setLoaded(true)}).catch(()=>setLoaded(true));
 useEffect(()=>{if(!open)return;load();const t=setInterval(load,60000);return()=>clearInterval(t)},[open]);
 return <div className="notify-wrap"><button className="icon-button" onClick={()=>setOpen(v=>!v)} aria-label="Notifications"><Bell/>{items.length>0&&<span className="notify-count">{Math.min(items.length,99)}</span>}</button>{open&&<div className="notify-popover"><div className="popover-title"><div><b>Needs attention</b><span>Operational alerts from live form records</span></div><button onClick={()=>setOpen(false)}><X/></button></div><div className="notify-list">{!loaded?<div className="empty compact">Loading alerts…</div>:items.length?items.slice(0,12).map(n=><Link prefetch={false} href={n.href||"/tasks"} key={n.id} onClick={()=>setOpen(false)} className={`notify-item ${n.severity}`}><span className="notify-dot"/><span><b>{n.title}</b><small>{n.detail}</small></span></Link>):<div className="empty compact"><CheckCircle2/> No process needs attention right now.</div>}</div><Link prefetch={false} href="/tasks" className="popover-footer" onClick={()=>setOpen(false)}>Open work queue</Link></div>}</div>
}

export default function Shell({children}:{children:ReactNode}){
 const path=usePathname();const [mobile,setMobile]=useState(false);const [dataState,setDataState]=useState<"checking"|"online"|"offline">("checking");const active=(href:string)=>href==="/"?path===href:path.startsWith(href);
 useEffect(()=>{const h=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();(document.querySelector('.global-search input') as HTMLInputElement|null)?.focus()}};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[]);
 useEffect(()=>{let cancelled=false;const check=async()=>{try{const s=await getDataConnectionStatus();if(!cancelled)setDataState(s.online?"online":"offline")}catch{if(!cancelled)setDataState("offline")}};const connected=()=>{if(!cancelled)setDataState("online")};const timer=window.setTimeout(check,120);const poll=window.setInterval(()=>{if(document.visibilityState==="visible")check()},15000);window.addEventListener("nunes:data-bridge-connected",connected as EventListener);window.addEventListener("focus",check);return()=>{cancelled=true;window.clearTimeout(timer);window.clearInterval(poll);window.removeEventListener("nunes:data-bridge-connected",connected as EventListener);window.removeEventListener("focus",check)}},[]);
 return <div className={`shell ${path==="/"?"dashboard-shell":""}`}>
  <aside className={`sidebar ${mobile?"mobile-open":""}`}><div className="brand"><div className="brandmark">N</div><div><b>NUNES</b><span>Operations Workspace</span></div><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div><nav className="nav">{nav.map(n=>{const I=n.href==="/"&&path==="/"?LayoutDashboard:n.icon;return <Link key={n.href} href={n.href} prefetch={false} onClick={()=>setMobile(false)} className={active(n.href)?"active":""}><I/><span>{n.label}</span></Link>})}</nav><div className="side-foot">{path==="/"?<><b>Management workspace</b><span>Live Purchasing and Servicing operations in one clear owner view.</span><em>NUNES · V6.6.8</em></>:<><b>Modular company platform</b><span>Purchasing and Servicing are the first two operational modules. New applications can be added through the module registry.</span><em>V6.6.8</em></>}</div></aside>
  {mobile&&<button className="mobile-overlay" aria-label="Close navigation" onClick={()=>setMobile(false)}/>} 
  <div className="main"><header className="topbar"><button className="mobile-menu" onClick={()=>setMobile(true)}><Menu/></button><SearchBox/><div className="top-actions"><div className={`live-pill ${dataState}`}><span className="dot"/>{dataState==="online"?"Data connected":dataState==="offline"?"Data offline":"Checking data"}</div><NotificationCenter/><div className="role-pill"><span>View</span><b>Management</b></div></div></header>{children}</div>
 </div>
}
