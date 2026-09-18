import type { Overview, ProcessPayload, TasksPayload, ActivityPayload, TeamPayload, SearchPayload, NotificationPayload } from "./types";

type CacheEntry={time:number,data:any};
type DashboardSnapshot={time:number,overview:Overview,tasks:TasksPayload,revision?:string};
type DashboardBootstrap={overview:Overview,tasks:TasksPayload,revision?:string,offline?:boolean,data_mode?:"cloud"|"local-bridge"|"saved-view"|"empty"};
const memoryCache=new Map<string,CacheEntry>();
const inflight=new Map<string,Promise<any>>();
const CACHE_NS="nunes:data:";
const DASHBOARD_SNAPSHOT_KEY="nunes:dashboard:last-good:v2";
const LOCAL_BRIDGE_KEY="nunes:local-data-bridge:v1";
let bridgePromise:Promise<string|null>|null=null;
let bridgeMemory="";

function now(){return Date.now()}
function readSession(path:string,ttl:number){
  if(typeof window==="undefined")return null;
  try{const raw=sessionStorage.getItem(CACHE_NS+path);if(!raw)return null;const v=JSON.parse(raw);if(!v||!v.time||now()-v.time>ttl)return null;return v.data}catch{return null}
}
function writeSession(path:string,data:any){
  if(typeof window==="undefined")return;
  try{sessionStorage.setItem(CACHE_NS+path,JSON.stringify({time:now(),data}))}catch{}
}
function emptyOverview():Overview{
  return {
    generated_at:new Date().toISOString(),
    forms:{total_orders:0,active_orders:0,completed_orders:0,this_month_orders:0,today_forms:0,this_month_forms:0,order_value:0,outstanding:0,statuses:{},monthly:[],daily:[],stage_completion:[],recent:[],latest_output:null},
    service:{open_jobs:0,total_jobs:0,ready:0,today_forms:0,this_month_forms:0,total_estimate:0,statuses:{},branches:[],monthly:[],daily:[],recent:[],latest_output:null},
    modules:{},
    system:{data_state:"offline"}
  } as Overview;
}
function emptyTasks():TasksPayload{return {generated_at:new Date().toISOString(),purchasing:[],servicing:[],summary:{active:0,waiting:0,needs_attention:0,completed_today:0}}}
function offlineFallback(path:string):any|null{
  const ts=new Date().toISOString();
  if(path==="/api/data/overview")return {...emptyOverview(),__offline:true};
  if(path==="/api/data/tasks")return {...emptyTasks(),__offline:true};
  if(path==="/api/data/process-status")return {generated_at:ts,purchasing:[],servicing:[],__offline:true} as ProcessPayload;
  if(path==="/api/data/activity")return {generated_at:ts,items:[],source_counts:{purchasing:0,servicing:0},__offline:true} as ActivityPayload;
  if(path==="/api/data/team")return {generated_at:ts,people:[],purchasing_users:[],summary:{people:0,purchasing_people:0,servicing_people:0},__offline:true} as TeamPayload;
  if(path==="/api/data/notifications")return {generated_at:ts,count:0,items:[],__offline:true} as NotificationPayload;
  if(path==="/api/data/modules")return {__offline:true};
  if(/^\/api\/data\/modules\/[^/]+$/.test(path))return {ready:false,starting:false,state:"offline",__offline:true};
  if(path.startsWith("/api/data/search")){const q=typeof window!=="undefined"?new URL(path,window.location.origin).searchParams.get("q")||"":"";return {query:q,results:[],__offline:true} as SearchPayload}
  return null;
}

type LocalNetworkFetchInit=RequestInit&{targetAddressSpace?:"local"|"loopback"|"public"};

function bridgeHintFromLocation():string{
  if(typeof window==="undefined")return "";
  try{
    const raw=new URLSearchParams(window.location.search).get("bridge")||"";
    const port=Number(raw);
    if(Number.isInteger(port)&&port>=1024&&port<=65535)return `http://127.0.0.1:${port}`;
  }catch{}
  return "";
}
function rememberBridge(base:string){
  bridgeMemory=base;
  if(typeof window!=="undefined"){
    try{localStorage.setItem(LOCAL_BRIDGE_KEY,base)}catch{}
    try{window.dispatchEvent(new CustomEvent("nunes:data-bridge-connected",{detail:{base}}))}catch{}
  }
}
async function timedFetch(input:string,init:RequestInit={},ms=1800,targetAddressSpace?:"local"|"loopback"){
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),ms);
  const requestInit:LocalNetworkFetchInit={...init,signal:controller.signal};
  if(targetAddressSpace)requestInit.targetAddressSpace=targetAddressSpace;
  try{return await fetch(input,requestInit as RequestInit)}finally{window.clearTimeout(timer)}
}
async function probeBridge(base:string,timeout=1800):Promise<string|null>{
  try{
    const r=await timedFetch(`${base}/api/health?bridge_probe=${Date.now()}`,{cache:"no-store",mode:"cors",credentials:"omit"},timeout,"loopback");
    if(!r.ok)return null;
    const h=await r.json();
    return h?.ok&&String(h?.product||"").includes("NUNES Company Data API")?base:null;
  }catch{return null}
}
export async function discoverLocalDataBridge(force=false):Promise<string|null>{
  if(typeof window==="undefined")return null;
  if(!force&&bridgeMemory)return bridgeMemory;
  if(!force&&bridgePromise)return bridgePromise;
  bridgePromise=(async()=>{
    const hinted=bridgeHintFromLocation();
    const saved=localStorage.getItem(LOCAL_BRIDGE_KEY)||"";
    const primaries=[hinted,saved,"http://127.0.0.1:8865"].filter((v,i,a)=>v&&a.indexOf(v)===i);
    // Chrome 142+ gates public-site -> loopback access behind Local Network Access.
    // Give the first known bridge enough time for the browser permission UI instead
    // of aborting in 300-550ms as older builds did.
    for(const base of primaries){
      const hit=await probeBridge(base,force?7000:2800);
      if(hit){rememberBridge(hit);return hit}
    }
    const candidates:string[]=[];
    for(let p=8866;p<=8875;p++)candidates.push(`http://127.0.0.1:${p}`);
    candidates.push("http://127.0.0.1:8766");
    const hits=await Promise.all(candidates.map(base=>probeBridge(base,force?2600:1400)));
    const hit=hits.find(Boolean)||null;
    if(hit)rememberBridge(hit);
    return hit;
  })().finally(()=>{bridgePromise=null});
  return bridgePromise;
}
export async function connectLocalDataBridge(){
  bridgeMemory="";
  const hit=await discoverLocalDataBridge(true);
  if(hit)return {ok:true,base:hit};
  return {ok:false,base:"",error:"The local data bridge is running, but Chrome has not allowed this Vercel site to reach this PC yet."};
}
function directBridgePath(path:string){return path.replace(/^\/api\/data(?=\/|$)/,"/api")}
function shouldTryLocalBridge(r:Response){return [404,502,503,504].includes(r.status)}

/**
 * Fetch company data through Vercel first. If Vercel has no cloud data URL,
 * transparently use the NUNES local data bridge on this same PC. This keeps the
 * Vercel UI usable without putting SQLite/jobs.json inside Vercel's temporary disk.
 */
export async function companyFetch(path:string,init:RequestInit={}):Promise<Response>{
  const first=await fetch(path,{cache:"no-store",...init});
  if(first.ok||typeof window==="undefined"||!path.startsWith("/api/data/")||!shouldTryLocalBridge(first))return first;
  const bridge=await discoverLocalDataBridge(false);
  if(!bridge)return first;
  try{
    const direct=directBridgePath(path);
    const local=await timedFetch(`${bridge}${direct}`,{...init,cache:"no-store",mode:"cors",credentials:"omit",headers:undefined},4200,"loopback");
    if(local.ok)return local;
    return first;
  }catch{return first}
}

async function responseError(r:Response,path:string){
  let detail="";
  try{const d=await r.clone().json();detail=d?.detail||d?.error||d?.help||""}catch{try{detail=(await r.clone().text()).slice(0,240)}catch{}}
  const suffix=detail?`: ${detail}`:"";
  return new Error(`Could not load ${path} (${r.status})${suffix}`);
}
async function j<T>(path:string,ttl=5000,force=false):Promise<T>{
  if(!force){
    const cached=memoryCache.get(path);if(cached&&now()-cached.time<=ttl)return cached.data as T;
    const stored=readSession(path,ttl);if(stored!==null){memoryCache.set(path,{time:now(),data:stored});return stored as T}
    const current=inflight.get(path);if(current)return current as Promise<T>;
  }
  const request=companyFetch(path,{headers:{"x-nunes-client":"platform-web"}}).then(async r=>{
    if(!r.ok){const fallback=offlineFallback(path);if(fallback!==null)return fallback as T;throw await responseError(r,path)}
    const data=await r.json();memoryCache.set(path,{time:now(),data});writeSession(path,data);return data as T
  }).finally(()=>inflight.delete(path));
  inflight.set(path,request);return request;
}
export function clearDataCache(prefix=""){for(const key of memoryCache.keys())if(!prefix||key.includes(prefix))memoryCache.delete(key);if(typeof window!=="undefined"){try{for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k?.startsWith(CACHE_NS)&&(!prefix||k.includes(prefix)))sessionStorage.removeItem(k)}}catch{}}}

export function readDashboardSnapshot(maxAgeMs=30*24*60*60*1000):DashboardSnapshot|null{
  if(typeof window==="undefined")return null;
  try{const raw=localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);if(!raw)return null;const v=JSON.parse(raw) as DashboardSnapshot;if(!v?.time||!v.overview||!v.tasks||now()-v.time>maxAgeMs)return null;return v}catch{return null}
}
export function writeDashboardSnapshot(overview:Overview,tasks:TasksPayload,revision?:string){
  if(typeof window==="undefined")return;
  try{localStorage.setItem(DASHBOARD_SNAPSHOT_KEY,JSON.stringify({time:now(),overview,tasks,revision:revision||""}))}catch{}
}

export const getOverview=(force=false)=>j<Overview>("/api/data/overview",5000,force);
export const getProcessStatus=(force=false)=>j<ProcessPayload>("/api/data/process-status",5000,force);
export const getTasks=(force=false)=>j<TasksPayload>("/api/data/tasks",5000,force);
export const getActivity=(force=false)=>j<ActivityPayload>("/api/data/activity",10000,force);
export const getTeam=(force=false)=>j<TeamPayload>("/api/data/team",30000,force);
export const getNotifications=(force=false)=>j<NotificationPayload>("/api/data/notifications",30000,force);
export const getModules=(force=false)=>j<Record<string,any>>("/api/data/modules",10000,force);
export const getModuleStatus=(key:"order_forms"|"service_operations")=>j<any>(`/api/data/modules/${key}`,750);
export const getReport=(source:"purchasing"|"servicing",id:any)=>j<any>(`/api/data/reports/${source}/${encodeURIComponent(String(id))}`,2000);
export const searchCompany=(q:string)=>j<SearchPayload>(`/api/data/search?q=${encodeURIComponent(q)}`,2500);

export async function getDashboardBootstrap(force=false):Promise<DashboardBootstrap> {
  const buildFromLocal=async(forceBridge=false):Promise<DashboardBootstrap|null>=>{
    const bridge=bridgeMemory||bridgeHintFromLocation()||await discoverLocalDataBridge(forceBridge);
    if(!bridge)return null;
    try{
      const [or,tr,rr]=await Promise.all([
        timedFetch(`${bridge}/api/overview`,{cache:"no-store",mode:"cors",credentials:"omit"},5000,"loopback"),
        timedFetch(`${bridge}/api/tasks`,{cache:"no-store",mode:"cors",credentials:"omit"},5000,"loopback"),
        timedFetch(`${bridge}/api/revision`,{cache:"no-store",mode:"cors",credentials:"omit"},5000,"loopback")
      ]);
      if(!or.ok||!tr.ok||!rr.ok)return null;
      const [overview,tasks,revisionData]=await Promise.all([or.json(),tr.json(),rr.json()]);
      rememberBridge(bridge);
      writeDashboardSnapshot(overview,tasks,revisionData?.revision||"");
      return {overview,tasks,revision:revisionData?.revision||"",offline:false,data_mode:"local-bridge"};
    }catch{return null}
  };

  // START_VERCEL_DATA_BRIDGE opens the production URL with ?bridge=<port>.
  // When that hint exists, go straight to this PC rather than waiting for the
  // expected Vercel 503 first. This makes same-PC startup much faster.
  if(typeof window!=="undefined"&&(bridgeMemory||bridgeHintFromLocation())){
    const local=await buildFromLocal(force);
    if(local)return local;
  }
  try{
    const r=await companyFetch("/api/data/dashboard-bootstrap",{headers:{"x-nunes-client":"dashboard-bootstrap"}});
    if(!r.ok)throw await responseError(r,"/api/data/dashboard-bootstrap");
    const data=await r.json() as DashboardBootstrap;
    memoryCache.set("/api/data/dashboard-bootstrap",{time:now(),data});writeSession("/api/data/dashboard-bootstrap",data);
    writeDashboardSnapshot(data.overview,data.tasks,data.revision);
    return {...data,offline:false,data_mode:bridgeMemory?"local-bridge":"cloud"};
  }catch{
    const local=await buildFromLocal(force);
    if(local)return local;
    const snap=readDashboardSnapshot();
    if(snap)return {overview:snap.overview,tasks:snap.tasks,revision:snap.revision||"",offline:true,data_mode:"saved-view"};
    return {overview:emptyOverview(),tasks:emptyTasks(),revision:"",offline:true,data_mode:"empty"};
  }
}

export async function getRevision(){
  const r=await companyFetch("/api/data/revision",{headers:{"x-nunes-client":"revision-watch"}});
  if(!r.ok)throw await responseError(r,"/api/data/revision");
  return r.json() as Promise<{revision:string}>;
}
export async function getDataConnectionStatus(){
  try{const r=await companyFetch("/api/data/revision");if(r.ok)return {online:true,mode:bridgeMemory?"local-bridge":"cloud" as const}}catch{}
  return {online:false,mode:"offline" as const};
}
export function money(v:any){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(v||0))}
export function compactMoney(v:any){const n=Number(v||0);if(Math.abs(n)>=1e7)return `Γé╣${(n/1e7).toFixed(1)}Cr`;if(Math.abs(n)>=1e5)return `Γé╣${(n/1e5).toFixed(1)}L`;if(Math.abs(n)>=1e3)return `Γé╣${(n/1e3).toFixed(1)}K`;return `Γé╣${Math.round(n)}`}
export function pct(done:any,total:any){const d=Number(done||0),t=Number(total||0);return t?Math.round(d/t*100):0}
export function dateText(v:any){if(!v)return "ΓÇö";const d=new Date(v);return isNaN(d.getTime())?String(v):d.toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}
export function relativeTime(v:any){if(!v)return "ΓÇö";const d=new Date(v);if(isNaN(d.getTime()))return String(v);const s=Math.max(0,(Date.now()-d.getTime())/1000);if(s<60)return "Just now";if(s<3600)return `${Math.floor(s/60)}m ago`;if(s<86400)return `${Math.floor(s/3600)}h ago`;if(s<604800)return `${Math.floor(s/86400)}d ago`;return d.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}
export function moduleUrl(mod:any){
  if(!mod)return "";
  const path=String(mod.home_path||"/");
  const join=(base:string)=>`${base.replace(/\/$/,"")}${path.startsWith("/")?path:`/${path}`}`;
  if(mod.public_url)return join(String(mod.public_url));
  if(typeof window!=="undefined"){
    // When the Vercel UI is using the same-PC local bridge, module ports belong
    // to 127.0.0.1 on this PC, not to the *.vercel.app hostname.
    if(bridgeMemory){try{const b=new URL(bridgeMemory);return join(`${b.protocol}//${b.hostname}:${mod.public_port||mod.port}`)}catch{}}
    return join(`${window.location.protocol}//${window.location.hostname}:${mod.public_port||mod.port}`);
  }
  return "";
}
