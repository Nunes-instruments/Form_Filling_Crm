'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileImage, FileText, LoaderCircle, ScanText, Upload, X } from 'lucide-react';
import type { ServiceJob } from '@/types/service-job';

const DRAFT_KEY = 'servicejob-new-draft';
const MAX_RAW_BYTES = 12 * 1024 * 1024;

export type DraftJob = Omit<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'>;
type ParseResult = { draft:DraftJob; detected:string[]; warnings:string[]; confidence:number; method?:'GEMINI'; model?:string };
type GeminiStatus = { enabled:boolean; configured:boolean; model:string; provider?:string };

function money(value:number) { return Number(value || 0).toFixed(2); }

function readAsDataUrl(file:Blob) {
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function prepareForGemini(file:File,onProgress:(value:number,label:string)=>void) {
  if(file.size > MAX_RAW_BYTES) throw new Error('The selected form is too large. Use an image or PDF smaller than 12 MB.');
  const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
  if(isPdf){
    onProgress(18,'Preparing PDF for Gemini Vision…');
    const dataUrl=await readAsDataUrl(file);
    onProgress(30,'PDF ready…');
    return dataUrl;
  }

  onProgress(12,'Preparing image for Gemini Vision…');
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
    if(dataUrl.length>18_000_000) throw new Error('The prepared image is too large. Please use a smaller or compressed photo.');
    onProgress(30,'Image ready…');
    return dataUrl;
  } finally { bitmap.close(); }
}

async function runGemini(dataUrl:string,fileName:string,onProgress:(value:number,label:string)=>void):Promise<ParseResult>{
  onProgress(42,'Gemini Vision is reading the complete form…');
  const res=await fetch('/api/forms/gemini-parse',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fileDataUrl:dataUrl,fileName})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||'Gemini Vision could not read the form.');
  onProgress(96,'Validating extracted fields…');
  return {...data,method:'GEMINI'} as ParseResult;
}

export default function HandwrittenFormImport({ open, onClose, onApplyDraft }:{ open:boolean; onClose:()=>void; onApplyDraft?:(draft:DraftJob)=>void }) {
  const router=useRouter();
  const inputRef=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null);
  const [previewUrl,setPreviewUrl]=useState('');
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [progressLabel,setProgressLabel]=useState('');
  const [error,setError]=useState('');
  const [result,setResult]=useState<ParseResult|null>(null);
  const [geminiStatus,setGeminiStatus]=useState<GeminiStatus|null>(null);

  useEffect(()=>{
    if(!file||file.type==='application/pdf'){setPreviewUrl('');return;}
    const url=URL.createObjectURL(file);setPreviewUrl(url);return()=>URL.revokeObjectURL(url);
  },[file]);

  useEffect(()=>{
    if(!open){setFile(null);setResult(null);setError('');setProgress(0);setProgressLabel('');return;}
    void fetch('/api/forms/gemini-status',{cache:'no-store'}).then(r=>r.json()).then(setGeminiStatus).catch(()=>setGeminiStatus(null));
  },[open]);

  const firstProduct=result?.draft.products?.[0];
  const summary=useMemo(()=>result?[
    ['Customer',result.draft.customer.name||'Needs review'],
    ['Phone / WhatsApp',result.draft.customer.phone||'Not detected'],
    ['Email',result.draft.customer.email||'Not detected'],
    ['Product',firstProduct?.productName||'Needs review'],
    ['Make / Model',firstProduct?.makeModel||'Needs review'],
    ['Current / Product Price',firstProduct?.onlinePrice||firstProduct?.productValue?`INR ${money(firstProduct?.onlinePrice||firstProduct?.productValue||0)}`:'Needs review'],
    ['Repair Cost',firstProduct?.repairEstimate?`INR ${money(firstProduct.repairEstimate)}`:'Needs review'],
    ['Repair Plan',firstProduct?.repairCategory==='MAXIMUM_50'?'Maximum / 50%':'Minimum / 30%'],
    ['Discount',result.draft.totals.discount?`INR ${money(result.draft.totals.discount)}`:'INR 0.00'],
    ['Total Estimate',result.draft.totals.totalEstimate?`INR ${money(result.draft.totals.totalEstimate)}`:'Needs review']
  ]:[],[result,firstProduct]);

  if(!open)return null;

  async function parse(){
    if(!file){setError('Choose the handwritten service form image or PDF first.');return;}
    if(geminiStatus && (!geminiStatus.configured||!geminiStatus.enabled)){
      setError(!geminiStatus.configured?'Gemini API key is not configured. Open Settings → AI Handwritten Form Reader and add the key.':'Gemini form reader is disabled in Settings.');
      return;
    }
    setBusy(true);setError('');setResult(null);setProgress(4);setProgressLabel('Preparing form…');
    try{
      const dataUrl=await prepareForGemini(file,(value,label)=>{setProgress(value);setProgressLabel(label);});
      const parsed=await runGemini(dataUrl,file.name,(value,label)=>{setProgress(value);setProgressLabel(label);});
      setResult(parsed);setProgress(100);setProgressLabel('Form reading complete. Review the extracted values.');
    }catch(e){setError(e instanceof Error?e.message:String(e));setProgress(0);setProgressLabel('');}
    finally{setBusy(false);}
  }

  function useParsedForm(){
    if(!result)return;
    localStorage.setItem(DRAFT_KEY,JSON.stringify(result.draft));
    sessionStorage.setItem('servicejob-imported-form-name',file?.name||'handwritten service form');
    if(onApplyDraft){
      onApplyDraft(result.draft);
      onClose();
      return;
    }
    onClose();router.push('/jobs/new?imported=handwritten');
  }

  return <div className="modalBackdrop handwrittenImportModal" role="dialog" aria-modal="true">
    <div className="modalCard handwrittenImportCard">
      <div className="modalHead"><div><p className="eyebrow">GEMINI FORM READER</p><h2>Upload Service Form</h2><p className="muted">Upload the photographed or scanned Service Job Card. Gemini Vision reads the complete document once, extracts structured fields, and local validation fills the existing Service form for review.</p></div><button className="iconButton" type="button" onClick={onClose} disabled={busy}><X size={19}/></button></div>

      {!result&&<>
        <button type="button" className="handwrittenDrop" onClick={()=>inputRef.current?.click()} disabled={busy}>
          <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setError('');setResult(null);}}/>
          {previewUrl?<img src={previewUrl} alt="Uploaded handwritten service form"/>:file?.type==='application/pdf'||file?.name.toLowerCase().endsWith('.pdf')?<FileText size={42}/>:<FileImage size={42}/>} 
          <div><b>{file?file.name:'Choose handwritten service form'}</b><span>{file?`${(file.size/1024/1024).toFixed(2)} MB · click to replace`:'JPG, PNG, WEBP or PDF · clear full-page photos give the best result'}</span></div>
        </button>
        {busy&&<div className="importProgress"><div><LoaderCircle className="spin" size={17}/><b>{progressLabel}</b><span>{progress}%</span></div><progress max="100" value={progress}/></div>}
        {error&&<div className="notice error">{error}</div>}
        <div className="importHints"><ScanText size={18}/><div><b>Gemini Vision only</b><span>{geminiStatus?.configured&&geminiStatus?.enabled?`Ready with ${geminiStatus.model}. One Gemini request reads the complete Service Job Card.`:'Add your Gemini API key once in Settings to enable automatic form reading.'}</span></div></div>
        <div className="modalActions"><button className="button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary large" type="button" disabled={!file||busy} onClick={()=>void parse()}><Upload size={17}/>{busy?'Reading Form…':'Read & Fill Form'}</button></div>
      </>}

      {result&&<>
        <div className="parseResultHead"><div className="parseConfidence"><Check size={20}/><div><b>{result.confidence}% validated fields detected</b><span>Read with Gemini Vision{result.model?` · ${result.model}`:''}. Uncertain values are left for review instead of being guessed.</span></div></div></div>
        <div className="parsedGrid">{summary.map(([k,v])=><div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
        {result.warnings.length>0&&<div className="notice warning"><b>Review required:</b> {result.warnings.join(' ')}</div>}
        <div className="importSendNote"><Check size={18}/><span><b>Customer messaging stays automatic.</b> After review and Save & Preview, Email and WhatsApp are attempted independently. Missing contact details do not block the save.</span></div>
        <div className="modalActions"><button className="button" type="button" onClick={()=>setResult(null)}>Read Again</button><button className="button primary large" type="button" onClick={useParsedForm}><Check size={17}/> Fill Service Form</button></div>
      </>}
    </div>
  </div>;
}
