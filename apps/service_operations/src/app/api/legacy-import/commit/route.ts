import { NextResponse } from 'next/server';
import { createJob, listJobs, updateJob } from '@/lib/db';
import { jobInputSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function norm(value:unknown){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');}
function paper(value:unknown){return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');}
function digits(value:unknown){return String(value||'').replace(/\D/g,'');}

function duplicateReason(existing:any,incoming:any):string{
  const inPaper=paper(incoming.legacySerialNo);
  const exPaper=paper(existing.legacySerialNo);
  if(inPaper&&exPaper&&inPaper===exPaper) return `same Paper / Service serial number ${incoming.legacySerialNo}`;

  const inCustomer=norm(incoming.customer?.name);
  const exCustomer=norm(existing.customer?.name);
  if(!inCustomer||!exCustomer||inCustomer!==exCustomer) return '';

  const inDate=String(incoming.jobDate||'').slice(0,10);
  const exDate=String(existing.jobDate||'').slice(0,10);
  const inPhone=digits(incoming.customer?.phone);
  const exPhone=digits(existing.customer?.phone);

  // If both records have different paper numbers, they are explicitly different jobs.
  // Same customer + same product can therefore return again without being blocked.
  if(inPaper&&exPaper&&inPaper!==exPaper) return '';

  for(const ip of incoming.products||[]){
    const product=norm(ip.productName); if(!product) continue;
    const model=norm(ip.makeModel); const serial=paper(ip.serialNo);
    for(const ep of existing.products||[]){
      if(product!==norm(ep.productName)) continue;
      const exModel=norm(ep.makeModel); const exSerial=paper(ep.serialNo);
      if(serial&&exSerial&&serial===exSerial&&inDate&&exDate&&inDate===exDate){
        return `same customer + product + instrument serial on ${inDate}`;
      }
      if(!inPaper&&!exPaper&&model&&exModel&&model===exModel&&inDate&&exDate&&inDate===exDate&&inPhone&&exPhone&&inPhone===exPhone){
        return `same customer + product/model + phone + service date ${inDate} (paper number missing)`;
      }
    }
  }
  return '';
}

export async function POST(request:Request){
  try{
    const body=await request.json();
    const parsed=jobInputSchema.parse(body?.draft||{});
    const existing=await listJobs();
    for(const job of existing){
      const reason=duplicateReason(job,parsed);
      if(reason){
        return NextResponse.json({duplicate:true,reason,job},{status:409});
      }
    }

    const products=parsed.products.map((p:any)=>({...p,id:p.id||crypto.randomUUID()}));
    const created=await createJob({...parsed,products} as any);
    const updated=await updateJob(created.id,{
      communication:{
        emailStatus:'SKIPPED',
        emailDetail:'Historical Legacy Bulk Import V2 — no new customer email was sent.',
        whatsappStatus:'SKIPPED',
        whatsappDetail:'Historical Legacy Bulk Import V2 — no new WhatsApp message was sent.'
      }
    } as any);
    return NextResponse.json({job:updated||created,duplicate:false,batchId:String(body?.batchId||''),sourceGroup:String(body?.sourceGroup||'')},{status:201});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:400});
  }
}
