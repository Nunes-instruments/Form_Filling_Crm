import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_VERSION = "6.5.0";
type ServerCache={time:number,data:any};
let warmCache:ServerCache|null=null;

function upstream(): string | null {
  const configured=(process.env.NUNES_API_INTERNAL_URL||process.env.NUNES_API_URL||"").trim();
  if(configured)return configured.replace(/\/$/,"");
  if(!process.env.VERCEL)return "http://127.0.0.1:8766";
  return null;
}

async function pull(base:string,path:string,signal:AbortSignal){
  const headers:Record<string,string>={"x-nunes-platform-version":PLATFORM_VERSION};
  const token=(process.env.NUNES_DATA_API_TOKEN||"").trim();
  if(token)headers.authorization=`Bearer ${token}`;
  const res=await fetch(`${base}/api/${path}`,{cache:"no-store",headers,signal});
  if(!res.ok){let detail="";try{const d=await res.json();detail=d?.error||d?.detail||""}catch{}throw new Error(`${path} returned ${res.status}${detail?`: ${detail}`:""}`)}
  return res.json();
}

export async function GET(){
  const base=upstream();
  if(!base)return NextResponse.json({error:"Persistent company data service is not configured",code:"DATA_BACKEND_NOT_CONFIGURED",help:"Set NUNES_API_INTERNAL_URL and NUNES_DATA_API_TOKEN in the Vercel Production environment."},{status:503,headers:{"cache-control":"no-store"}});

  // Warm-instance micro-cache: prevents several users/tabs from hammering the same
  // office data service while keeping the dashboard practically live.
  if(warmCache&&Date.now()-warmCache.time<1800){
    return NextResponse.json(warmCache.data,{headers:{"cache-control":"private, no-store","x-nunes-cache":"warm"}});
  }

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),2800);
  try{
    const [overview,tasks,revision]=await Promise.all([
      pull(base,"overview",controller.signal),
      pull(base,"tasks",controller.signal),
      pull(base,"revision",controller.signal),
    ]);
    const data={overview,tasks,revision:revision?.revision||"",generated_at:new Date().toISOString()};
    warmCache={time:Date.now(),data};
    return NextResponse.json(data,{headers:{"cache-control":"private, no-store","x-nunes-data-backend":"persistent"}});
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    return NextResponse.json({error:"Company data service is unavailable",detail},{status:503,headers:{"cache-control":"no-store"}});
  }finally{clearTimeout(timeout)}
}
