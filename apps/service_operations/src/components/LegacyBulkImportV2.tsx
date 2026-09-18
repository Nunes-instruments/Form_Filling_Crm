'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileText,
  FolderOpen, LoaderCircle, RotateCcw, ShieldCheck, Upload, XCircle
} from 'lucide-react';
import type { ServiceJob } from '@/types/service-job';

type DraftJob = Omit<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'>;
type ParseResult = { draft:DraftJob; detected:string[]; warnings:string[]; confidence:number; model?:string };
type ImportState = 'READY'|'READING'|'IMPORTED'|'DUPLICATE'|'NEEDS_REVIEW'|'FAILED'|'PARTIAL';

type LegacyGroup = {
  id:string;
  label:string;
  files:File[];
  form:File;
  proofs:File[];
  state:ImportState;
  detail:string;
  jobNo?:string;
  jobId?:string;
  duplicateReason?:string;
  confidence?:number;
};

type ImportResult = {
  group:string;
  state:ImportState;
  detail:string;
  jobNo?:string;
  jobId?:string;
  duplicateReason?:string;
};

const MAX_RAW_BYTES = 12 * 1024 * 1024;
const FORM_EXT = /\.(jpe?g|png|webp|pdf)$/i;

function readAsDataUrl(file:Blob) {
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function prepareForGemini(file:File) {
  if(file.size > MAX_RAW_BYTES) throw new Error(`${file.name} is larger than 12 MB. Compress this form scan and retry.`);
  const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
  if(isPdf) return readAsDataUrl(file);

  const bitmap=await createImageBitmap(file);
  try{
    const maxSide=1900;
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');
    if(!ctx) throw new Error('Unable to prepare the image.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL('image/jpeg',0.84);
    if(dataUrl.length>18_000_000) throw new Error(`${file.name} is still too large after compression.`);
    return dataUrl;
  } finally { bitmap.close(); }
}

function normalStem(name:string){
  return name
    .replace(/\.[^.]+$/,'')
    .toLowerCase()
    .replace(/\b(servicing|service|job\s*card|jobcard|job|form|proof|evidence|photo|image|img|scan|document|doc|whatsapp|email|mail|message)\b/g,' ')
    .replace(/\b(before|after|receipt|repair|customer|approval|dispatch)\b/g,' ')
    .replace(/[-_\s]+(?:form|proof|scan|photo|img|image)?[-_\s]*\d+$/i,' ')
    .replace(/[^a-z0-9]+/g,'')
    .trim();
}

function formRank(file:File){
  const n=file.name.toLowerCase();
  let score=0;
  if(/service|servicing|job.?card|\bform\b/.test(n)) score+=100;
  if(/\.pdf$/i.test(n)||file.type==='application/pdf') score+=24;
  if(/\.(jpe?g|png|webp)$/i.test(n)||file.type.startsWith('image/')) score+=14;
  if(/proof|evidence|before|after|whatsapp|email|message/.test(n)) score-=80;
  return score;
}

function groupSelectedFiles(files:File[]):LegacyGroup[]{
  const buckets=new Map<string,{label:string;files:File[]}>();
  for(const file of files){
    const rel=(file as File & {webkitRelativePath?:string}).webkitRelativePath||file.name;
    const parts=rel.split('/').filter(Boolean);
    const nestedParent=parts.length>=3?parts.slice(1,-1).join('/'):'';
    const stem=normalStem(file.name)||file.name.replace(/\.[^.]+$/,'').toLowerCase();
    const key=nestedParent?`dir:${nestedParent.toLowerCase()}`:`stem:${stem}`;
    const label=nestedParent||stem||file.name;
    const hit=buckets.get(key)||{label,files:[]};
    hit.files.push(file);buckets.set(key,hit);
  }
  const groups:LegacyGroup[]=[];
  for(const [key,b] of buckets){
    const candidates=b.files.filter(f=>FORM_EXT.test(f.name)||f.type.startsWith('image/')||f.type==='application/pdf');
    const form=[...(candidates.length?candidates:b.files)].sort((a,b)=>formRank(b)-formRank(a)||a.name.localeCompare(b.name))[0];
    if(!form) continue;
    groups.push({
      id:key,label:b.label,files:b.files,form,proofs:b.files.filter(f=>f!==form),state:'READY',detail:'Ready to read'
    });
  }
  return groups.sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
}

async function jsonFetch(url:string,init?:RequestInit){
  const res=await fetch(url,init);
  const data=await res.json().catch(()=>({}));
  if(!res.ok){const e:any=new Error(data.error||`Request failed with HTTP ${res.status}`);e.status=res.status;e.payload=data;throw e;}
  return data;
}

async function parseForm(file:File):Promise<ParseResult>{
  const dataUrl=await prepareForGemini(file);
  return jsonFetch('/api/forms/gemini-parse',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fileDataUrl:dataUrl,fileName:file.name})
  }) as Promise<ParseResult>;
}

async function uploadFiles(jobId:string,files:File[],prefix:string){
  const chunks:File[][]=[];
  for(let i=0;i<files.length;i+=8) chunks.push(files.slice(i,i+8));
  for(const chunk of chunks){
    const fd=new FormData();fd.append('category','OTHER');
    for(const file of chunk) fd.append('files',file,`${prefix} ${file.name}`);
    const res=await fetch(`/api/jobs/${encodeURIComponent(jobId)}/attachments`,{method:'POST',body:fd});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Proof upload failed.');
  }
}

function downloadJson(name:string,data:unknown){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1200);
}

export default function LegacyBulkImportV2(){
  const folderRef=useRef<HTMLInputElement>(null);
  const filesRef=useRef<HTMLInputElement>(null);
  const [groups,setGroups]=useState<LegacyGroup[]>([]);
  const [busy,setBusy]=useState(false);
  const [activeIndex,setActiveIndex]=useState(-1);
  const [defaultStatus,setDefaultStatus]=useState<ServiceJob['status']>('CLOSED');
  const [batchId,setBatchId]=useState('');
  const [results,setResults]=useState<ImportResult[]>([]);
  const [error,setError]=useState('');

  const summary=useMemo(()=>({
    total:groups.length,
    files:groups.reduce((n,g)=>n+g.files.length,0),
    proofs:groups.reduce((n,g)=>n+g.proofs.length,0),
    imported:groups.filter(g=>g.state==='IMPORTED'||g.state==='PARTIAL').length,
    duplicate:groups.filter(g=>g.state==='DUPLICATE').length,
    review:groups.filter(g=>g.state==='NEEDS_REVIEW'||g.state==='FAILED').length
  }),[groups]);

  function selectFiles(files:File[]){
    setError('');setResults([]);setActiveIndex(-1);
    const next=groupSelectedFiles(files);
    if(!next.length){setGroups([]);setError('No supported files were found. Use scanned JPG/PNG/WEBP/PDF forms and any proof files.');return;}
    setGroups(next);
  }

  function changeForm(id:string,fileName:string){
    setGroups(prev=>prev.map(g=>{
      if(g.id!==id)return g;
      const form=g.files.find(f=>f.name===fileName)||g.form;
      return {...g,form,proofs:g.files.filter(f=>f!==form),state:'READY',detail:'Ready to read'};
    }));
  }

  async function runImport(){
    if(busy||!groups.length)return;
    setBusy(true);setError('');setResults([]);
    const currentBatch=`LEGACY-V2-${new Date().toISOString().replace(/[:.]/g,'-')}`;setBatchId(currentBatch);
    const finalResults:ImportResult[]=[];

    for(let i=0;i<groups.length;i++){
      setActiveIndex(i);
      const group=groups[i];
      setGroups(prev=>prev.map((g,idx)=>idx===i?{...g,state:'READING',detail:'Gemini is reading the service form…'}:g));
      try{
        if(!FORM_EXT.test(group.form.name)&&!group.form.type.startsWith('image/')&&group.form.type!=='application/pdf'){
          throw new Error('This group has no readable service-form image/PDF. Choose the correct form file in the row.');
        }
        const parsed=await parseForm(group.form);
        const draft:DraftJob={...parsed.draft,status:defaultStatus,products:parsed.draft.products.map(p=>({...p,status:defaultStatus}))};
        const paper=String(draft.legacySerialNo||'').trim();
        const product=String(draft.products?.[0]?.productName||'').trim();
        if(!String(draft.customer?.name||'').trim()||!product){
          const missing=[!draft.customer.name?'customer name':'',!product?'product name':''].filter(Boolean).join(' + ');
          const detail=`Needs review: Gemini could not confidently read ${missing}. No record was stored.`;
          setGroups(prev=>prev.map((g,idx)=>idx===i?{...g,state:'NEEDS_REVIEW',detail,confidence:parsed.confidence}:g));
          finalResults.push({group:group.label,state:'NEEDS_REVIEW',detail});
          continue;
        }
        draft.notes=[
          draft.notes,
          `[LEGACY BULK IMPORT V2] Batch ${currentBatch}. Source group: ${group.label}. Original scanned service form and ${group.proofs.length} proof file(s) retained. Historical import: no new Email/WhatsApp message was sent.`
        ].filter(Boolean).join(' ');

        let committed:any;
        try{
          committed=await jsonFetch('/api/legacy-import/commit',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({draft,batchId:currentBatch,sourceGroup:group.label,formFileName:group.form.name,proofCount:group.proofs.length})
          });
        }catch(e:any){
          if(e?.status===409&&e?.payload?.duplicate){
            const reason=e.payload.reason||'Matching historical record already exists.';
            const existing=e.payload.job;
            setGroups(prev=>prev.map((g,idx)=>idx===i?{...g,state:'DUPLICATE',detail:`Skipped duplicate: ${reason}`,jobNo:existing?.jobNo,jobId:existing?.id,duplicateReason:reason,confidence:parsed.confidence}:g));
            finalResults.push({group:group.label,state:'DUPLICATE',detail:`Skipped duplicate: ${reason}`,jobNo:existing?.jobNo,jobId:existing?.id,duplicateReason:reason});
            continue;
          }
          throw e;
        }

        const job=committed.job;
        let attachmentError='';
        try{
          await uploadFiles(job.id,[group.form],'[LEGACY_FORM]');
          if(group.proofs.length) await uploadFiles(job.id,group.proofs,'[LEGACY_PROOF]');
        }catch(e){attachmentError=e instanceof Error?e.message:String(e);}

        const state:ImportState=attachmentError?'PARTIAL':'IMPORTED';
        const detail=attachmentError
          ? `Record ${job.jobNo} stored, but some scan/proof files need retry: ${attachmentError}`
          : `Stored as ${job.jobNo}${paper?` · Paper ${paper}`:''} · ${group.proofs.length} proof file(s)`;
        setGroups(prev=>prev.map((g,idx)=>idx===i?{...g,state,detail,jobNo:job.jobNo,jobId:job.id,confidence:parsed.confidence}:g));
        finalResults.push({group:group.label,state,detail,jobNo:job.jobNo,jobId:job.id});
      }catch(e){
        const detail=e instanceof Error?e.message:String(e);
        setGroups(prev=>prev.map((g,idx)=>idx===i?{...g,state:'FAILED',detail}:g));
        finalResults.push({group:group.label,state:'FAILED',detail});
      }
    }
    setResults(finalResults);setActiveIndex(-1);setBusy(false);
  }

  function openMainDashboard(){
    const url=`${window.location.protocol}//${window.location.hostname}:8795/`;
    window.open(url,'_blank','noopener,noreferrer');
  }

  return <div className="stack24 legacyImportPage">
    <section className="editorHeader legacyImportHeader">
      <div className="editorTitle"><Link href="/" className="iconButton"><ArrowLeft size={20}/></Link><div><p className="eyebrow">ONE-TIME OLD DATA TOOL · VERSION 2</p><h1>Legacy Servicing Bulk Import V2</h1><p className="muted">Select one folder containing many old Service Job Cards and their proof files. Records are read one-by-one, duplicate-checked, stored in the same live Servicing database, and then appear in the Main Dashboard.</p></div></div>
      <div className="legacyHeaderActions"><button className="button" type="button" onClick={openMainDashboard}>Open Main Dashboard</button><Link href="/" className="button">Normal Servicing</Link></div>
    </section>

    <section className="panel legacySafetyPanel">
      <div className="legacySafety"><ShieldCheck size={24}/><div><b>Historical import is safe by default</b><p>Old records are stored without sending a new Email or WhatsApp message. Screenshots, PDFs, photos, message proof, delivery proof and other files inside the same group are saved as proof. Your normal live “Upload Service Form” method remains unchanged.</p></div></div>
      <div className="legacyRules"><span><b>Duplicate rule 1:</b> same Paper / Service serial number = duplicate.</span><span><b>Duplicate rule 2:</b> same customer alone is allowed. Product + model/serial + same date are checked only when a paper number is missing.</span><span><b>Different paper number:</b> same customer can return again for the same product and is stored as a new job.</span></div>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><span className="step">01</span><div><h2>Select the old servicing folder once</h2><p>Best layout: one subfolder per old job with the service form + its proof files. Flat folders also work when names share the same number/prefix, for example <b>125_form.jpg</b> and <b>125_proof.jpg</b>.</p></div></div></div>
      <div className="legacyPickGrid">
        <button className="legacyFolderButton" type="button" disabled={busy} onClick={()=>folderRef.current?.click()}><FolderOpen size={34}/><div><b>Select One Legacy Folder</b><span>Recommended · keeps each form + proof grouped together</span></div></button>
        <button className="legacyFolderButton secondary" type="button" disabled={busy} onClick={()=>filesRef.current?.click()}><Upload size={30}/><div><b>Select Many Files</b><span>For one flat folder / manual batch selection</span></div></button>
        <input ref={folderRef} hidden type="file" multiple {...({webkitdirectory:'',directory:''} as any)} onChange={e=>{selectFiles(Array.from(e.target.files||[]));e.currentTarget.value='';}}/>
        <input ref={filesRef} hidden type="file" multiple onChange={e=>{selectFiles(Array.from(e.target.files||[]));e.currentTarget.value='';}}/>
      </div>
      {groups.length>0&&<div className="legacyBatchOptions"><label>Imported historical status<select value={defaultStatus} onChange={e=>setDefaultStatus(e.target.value as ServiceJob['status'])} disabled={busy}><option value="CLOSED">Closed / historical completed</option><option value="DISPATCHED">Dispatched</option><option value="READY">Ready</option><option value="RECEIVED">Received</option><option value="DRAFT">Draft / review later</option></select></label><div className="legacyQuickStats"><span><b>{summary.total}</b> records</span><span><b>{summary.files}</b> files</span><span><b>{summary.proofs}</b> proof files</span></div></div>}
    </section>

    {groups.length>0&&<section className="panel">
      <div className="sectionHead"><div><span className="step">02</span><div><h2>Check automatic pairing</h2><p>The system chooses the most likely service form in each group. If one row is wrong, use the Form File dropdown before starting.</p></div></div><button className="button primary large" type="button" onClick={()=>void runImport()} disabled={busy}>{busy?<><LoaderCircle className="spin" size={18}/> Importing {Math.max(1,activeIndex+1)} / {groups.length}</>:<><CheckCircle2 size={18}/> Start One-by-One Import</>}</button></div>
      <div className="legacyTableWrap"><table className="legacyTable"><thead><tr><th>#</th><th>Group / Paper Folder</th><th>Form File</th><th>Proof</th><th>Status</th></tr></thead><tbody>{groups.map((g,i)=><tr key={g.id} className={activeIndex===i?'active':''}><td>{i+1}</td><td><b>{g.label}</b><small>{g.files.length} file(s)</small></td><td><select value={g.form.name} disabled={busy} onChange={e=>changeForm(g.id,e.target.value)}>{g.files.map((f,idx)=><option key={`${f.name}-${idx}`} value={f.name}>{f.name}</option>)}</select></td><td><b>{g.proofs.length}</b><small>{g.proofs.slice(0,2).map(f=>f.name).join(', ')}{g.proofs.length>2?'…':''}</small></td><td><span className={`legacyState ${g.state.toLowerCase()}`}>{g.state.replaceAll('_',' ')}</span><small>{g.detail}</small>{g.confidence!==undefined&&<small>Gemini confidence: {g.confidence}%</small>}</td></tr>)}</tbody></table></div>
    </section>}

    {results.length>0&&<section className="panel legacyResultPanel">
      <div className="sectionHead"><div><span className="step">03</span><div><h2>Import finished</h2><p>Imported records are already in the same live Servicing data used by the dashboard. Duplicate rows were skipped, not overwritten.</p></div></div><div className="exportButtons"><button className="button" type="button" onClick={()=>downloadJson(`${batchId||'legacy-import-v2'}-report.json`,{batchId,createdAt:new Date().toISOString(),results})}><Download size={17}/> Download Import Report</button><button className="button primary" type="button" onClick={openMainDashboard}>Check Main Dashboard</button></div></div>
      <div className="legacyFinishStats"><div><CheckCircle2/><b>{summary.imported}</b><span>Stored</span></div><div><ShieldCheck/><b>{summary.duplicate}</b><span>Duplicates skipped</span></div><div><AlertTriangle/><b>{summary.review}</b><span>Needs review / failed</span></div></div>
      <div className="notice success"><CheckCircle2 size={18}/><span><b>Normal live scanning is still available.</b> Go back to Service Job Cards and continue using Upload Service Form for all new daily work.</span></div>
    </section>}

    {!groups.length&&<section className="legacyEmpty panel"><FileText size={42}/><div><h3>No legacy folder selected yet</h3><p>Select one folder. Nothing is written to the live database until you press <b>Start One-by-One Import</b>.</p></div></section>}
    {error&&<div className="notice error"><XCircle size={18}/>{error}</div>}
    {groups.length>0&&!busy&&<button className="button ghost legacyReset" type="button" onClick={()=>{setGroups([]);setResults([]);setBatchId('');setError('');}}><RotateCcw size={16}/> Clear this batch</button>}
  </div>;
}
